# Phase 1.2a: `new`: scaffold and templates

Status: EXECUTED 2026-10-26; batch-reviewed, fixed, merged to main (PR #4)

Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | `stacks new <stack> [dir]` writes the composed files (single ownership, JSON merge, `*.tmpl` templates, literal dotfiles) and the brief into a new project through one safe writer that rolls back on failure, initializes git, reports missing tools, and returns a result an agent can act on, without running any command from any entry |
| Traces to | "The CLI writes a few files and a brief, then hands off" (README product summary); job 1, "the same well-tested setup I'd build by hand, without spending the afternoon"; job 2, "a running dev environment with tests in a few minutes"; What this is not, "never runs a command from a stack" |
| Depends on | [1.1](phase-1.1-composition-and-brief-2026-10-30.md) (composition, the brief, `renderBrief`'s `briefWords` and `fixedWords`, `Host.invocation`), [0.3b](phase-0.3b-processes-and-signals-2026-10-30.md) (`Processes.run` for git, `Processes.which` for missing tools), [0.3a](phase-0.3a-errors-and-output-2026-10-30.md) (error table, `Host.stdinIsTTY` and `Host.stdoutIsTTY`) |
| Blocks | [1.2b](phase-1.2b-manifest-state-and-detection-2026-10-30.md) (adds the manifest and state record to this write order), [1.4](phase-1.4-handoff-and-entry-points-2026-10-30.md) (hands off after `new`), [3.0](phase-3.0-add-fragments-to-repo-2026-10-30.md) (reuses the writer and `slug`), [3.1c](phase-3.1c-new-dry-run-and-naming-2026-10-30.md) (adds `--dry-run`, `--name`, `--author` and the Unicode slug rules) |
| Decisions needed | D19: `new` reports untrusted entries in its result; what that blocks is 1.4's. Nothing else; D14 is 1.2b's and 1.3b's |
| Settles | Target-directory rules; the safe writer and its rollback; the template variable set and tokenizer; the MVP slug rule; git behavior; the `new --json` shape |

## Scope

In:

- `new <stack> [dir]` with `--with`, `--without`, `--sandbox`, `--yes`, `--agents`,
  `--scope`, `--json`. `--launch` and `--no-launch` are 1.4's flags; until 1.4 lands, `new` never
  launches.
- Target directory checks; a writer that compares real paths so nothing escapes the
  project; `.tmpl` rendering; writing JSON merges; writing dotfiles, which entries store
  under their real names (1.0).
- `.stacks/` layout (roadmap, Other shared facts: Project metadata): `BRIEF.md`,
  `NOTES.md`, `.gitignore` and `state/`. The manifest and the state record are 1.2b's,
  written at their place in this file's write order.
- `git init` when the target is not inside a repository and git exists.
- Missing-tool detection with `Processes.which`.
- The `new` result for `--json` and human output.

Out:

- The manifest, the step digest, the project state record and agent detection
  ([1.2b](phase-1.2b-manifest-state-and-detection-2026-10-30.md)).
- The TTY fields: `Host.stdinIsTTY` and `Host.stdoutIsTTY` are 0.3a's; nothing here reads
  them.
- Launching an agent and deciding the handoff (1.4). 1.2a ends with the result; when 1.4
  lands, the handler calls handoff after writing.
- `--dry-run`, `--name`, `--author` and the Unicode slug table
  ([3.1c](phase-3.1c-new-dry-run-and-naming-2026-10-30.md)). The demo doesn't need them.
- Running verify (1.3a, 1.3b). `add` into an existing repo (3.0).

## Design

### CLI surface

```
stacks new <stack> [dir]
  --with a,b          add optional fragments
  --without a,b       remove default fragments
  --sandbox           every default, no deploy or release fragments, prod steps skipped
  --yes               take every decision's default without asking (implied by --sandbox)
  --agents claude,codex   adapter targets (default: Settings.agents, else claude; 1.1 targetAgents)
  --scope acme        npm scope for the package_scope template variable (default: Settings.package_scope, else empty)
  --json
```

`dir` defaults to `<stack>` under the current directory. `.` is allowed. `--agents`
values decode as `AgentId` (1.0) in the parser, so an unknown id is `Usage`, exit 2, like
every other flag contradiction or bad flag value (1.4 adds `--launch` and `--no-launch`
under the same rule). The same id in `--with` and `--without` is also `Usage`.

### Target directory

| State of `dir` | Behavior |
|---|---|
| Does not exist | Create it |
| Exists and empty | Use it |
| Exists, holds only `.git/` | Use it; git state is `fresh` if it has no commits, `parent` semantics otherwise |
| Exists, holds only OS litter (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `._*` AppleDouble files) | Treated as empty; the litter is left alone and never listed in `written` |
| Exists with other files, including `.stacks/manifest.json` | `TargetNotEmpty`, exit 2. `add` (3.0) is the path for existing repos; 1.2b adds `details.scaffold` for the manifest case |
| Inside an enclosing git repository | Allowed; git state `parent`. If any composed fragment has `needsOwnRepo`, refuse with `ComposeConflict` (reason `needs_own_repo`) before writing anything. `details.ids` names those fragments and `details.fix` lists the `--without <id>` flags that would avoid it (only for fragments that aren't required); when a required fragment needs its own repo, `fix` is empty and the human hint says to pick a directory outside `<toplevel>` |

### Writing

Every write goes through one function in `src/core/scaffold/write.ts` (roadmap, Types and
schemas: Safe writer). Once the target exists, it resolves the project root's real path
(`FileSystem.realPath`) and keeps it. For each file it creates the parent directories,
resolves the parent's real path, and refuses with `PermissionDenied`
(`details: { reason: "escape", path }`) unless that real path is the root's real path or
under it. Both sides are real paths: on macOS a temp target under `/var/...` resolves to
`/private/var/...`, and comparing a real path with a non-real one would reject every write
there (or, the other way round, accept an escape). On the way down, a symlinked directory is
resolved and each directory created is checked before anything is made beneath it, and
after each file is written its parent is checked again; a file whose parent moved out of
the project is removed and refused. That narrows a race without closing it: a process that
swaps a directory for a symlink between the last check and the write can land one
exclusively created file outside the project until the recheck removes it. Closing it
needs `openat`-style calls, which Effect's FileSystem doesn't have.

A path segment equal to `.git` or `.stacks` in any letter case (and the spellings git
itself treats as those on HFS+ and NTFS: ignorable code points, trailing dots or spaces,
`:` streams, `git~1`) is refused at compose time as `ComposeConflict` `reserved_path`, so
3.0's `add` gets the same check. So are two planned files whose paths differ only in case,
or where one is a directory prefix of the other (`docs` and `docs/x.md`): `file_owner`.

Files are written to the `PlannedFile.path` from 1.1, the output path (1.0, Dotfiles):
`files/.gitignore` lands as `.gitignore`, under the same name it has in the entry. Files
take the source's executable bit only
(hooks must stay executable), never ownership or other bits. `merge` files are written
from `PlannedFile.content`.

Only files whose name ends `.tmpl` are rendered, and the suffix is dropped from the
output name (`files/package.json.tmpl` lands as `package.json`). They are rendered with
exactly these variables (D18 as amended; an unknown name is an error, below):

| Variable | Value |
|---|---|
| `project_name` | The target directory's base name as given. A name with a control character is `BadInput` (flag `dir`) before anything is read or written |
| `project_slug` | `scaffold/slug.ts::slug(project_name)`, rule below |
| `env_prefix` | Slug upper-cased with `-` turned to `_`, prefixed `_` if it starts with a digit |
| `package_scope` | `new --scope <scope>`, else `Settings.package_scope` (1.1), else empty. Accepted with or without a leading `@` and stored without it; it must be a valid npm scope (lowercase, URL-safe, no `/`), or `new` fails `BadInput` for the flag and `InvalidConfig` for the setting before writing anything. Templates use it where a scope belongs, and entry prose says what to do when it is empty (publish unscoped); there are no template conditionals (D1) |
| `author` | `Settings.author` (1.1), else `git config user.name` (when git is on PATH; the CLI's own constant command, cwd the target's nearest existing parent, 10 s timeout), else empty. Either source loses `"`, `\`, CR and LF, so the value fits inside a JSON or TOML string; any other control character left makes the setting `InvalidConfig` and a git `user.name` unused (empty) |
| `year` | The current UTC year from `Clock` |

`package_scope` is in v1's set from the start, so no entry needs a newer
`schema_version` to use it. It is not a manifest field: it reaches the project only
through the rendered files.

`slug` is one function (roadmap, Types and schemas: Shared helpers), so two callers (this,
and 3.0's name inference) can't disagree. The MVP rule is ASCII only:

1. Lowercase.
2. Every run of characters outside `[a-z0-9]` becomes one `-`; trim `-` from both ends.
3. Empty result (for example `日本語` or `@@@`): `project`.

| Input | Slug |
|---|---|
| `My App` | `my-app` |
| `__init__` | `init` |
| `a--b__c` | `a-b-c` |
| `日本語` | `project` |
| `2048` | `2048` (and `env_prefix` `_2048`) |

3.1c replaces the rule with the full table (npm scopes, Unicode folding, camelCase
splits) in the same function.

#### Template syntax

`scaffold/template.ts` has one tokenizer rule: a token is `{{`, optional spaces or tabs,
an identifier matching `[A-Za-z_][A-Za-z0-9_]*`, optional spaces or tabs, `}}`, matched
leftmost-first and never across a line break. Everything else is literal text, copied as
is. So:

| In a `.tmpl` file | Result |
|---|---|
| `{{project_name}}`, `{{ project_name }}` | The value |
| `${{{project_slug}}}` | `${` + the slug + `}`: the first `{` can't start a token (`{{{` isn't followed by an identifier), so the scan moves one character on and finds `{{project_slug}}` |
| `${{ secrets.NPM_TOKEN }}` | Copied unchanged: `secrets.NPM_TOKEN` isn't an identifier |
| `${{ github }}` | `EntryInvalid` (reason `template`): an identifier that isn't a known variable |
| `{{` with no closing `}}` on the line | Copied unchanged |

An entry that needs a literal `{{ name }}` that matches the identifier rule ships that
file without the `.tmpl` suffix. A `validate` warning for a `.tmpl` file that contains a
GitHub Actions expression whose inner text is a bare identifier is a rot check
([2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md)), because that is the one case authors hit.

Every template is rendered in memory before the first write. An unknown `{{name}}` is
`EntryInvalid` (reason `template`, with the entry and file), so it never leaves a
half-written project. There are no conditionals or loops in templates (D1); anything
conditional is prose. Files that don't end in `.tmpl` are copied byte for byte, so
`${{ secrets.X }}` in a workflow file is safe.

The write order is: entry files, then `.stacks/` (with 1.2b's manifest), then 1.2b's
state record, then `git init`. If anything fails after the first write, the handler
removes the files it wrote (it tracks them), the state record if 1.2b wrote one, and the
directory if it created it, so a failed `new` leaves no half project. That cleanup runs
as an Effect finalizer, so it also runs on interrupt.

### `.stacks/` layout

The layout and what is committed are the roadmap contract (Other shared facts: Project
metadata), owned here. On top of it, `new` writes `NOTES.md` with empty `## Findings`
and `## Asked` sections (1.1, The NOTES.md rule) and creates an empty `state/`.

The brief and notes are ignored so a public repo doesn't publish the task text, and so
the agent's notes stay with the person who ran it. A user who wants them committed can
edit the ignore file; stacks preserves an existing one.

### Git

| Git state | `new` does | The brief says |
|---|---|---|
| git on PATH, target not in a repo | `git init` (the CLI's own command, not an entry's) | Fresh repo; skip generators' git setup; commit once verify is green |
| Target inside a repo | Nothing | Part of the repo at `<toplevel>`; don't commit without asking |
| Target is its own repo root, with commits | Nothing; `needs_own_repo` fragments are allowed | Same as inside a repo |
| Target is its own repo root, nothing committed | Nothing | Same as a fresh repo |
| git fails other than "not a git repository" | Nothing; `git_unusable` warning | Same as git missing |
| git missing | Nothing | No git; skip commits; say so in the final summary |
| `git init` fails (non-zero exit, timeout) | Nothing more; git state `none`, and a `git_init_failed` warning in the result with the exit code. The scaffold is kept: the files are fine without a repo | Same as git missing |

Git runs through `Processes.run` with a command string the CLI builds from constants only
(`git rev-parse --show-toplevel`, `git init --quiet`), `cwd` set to the target or its
nearest existing parent, the environment from `config.ts`, and a 10 second timeout. No
entry content reaches the command line. `Processes.which("git")` decides "git missing".

### Missing tools

The composition's `tools` and every fragment's `requiresTools` are looked up with
`Processes.which`, the only PATH search (roadmap, Types and schemas: PATH lookup). There
is no `core/tools.ts`. Missing ones go into the brief's ground rules and the result. They
never fail `new`: the agent may be able to install them. Each missing tool carries
`without`: the ids of the optional or default fragments that need it, which
`--without` would drop (a tool the stack itself or a required fragment needs has an empty
`without`). Human output prints it as `<tool> not found (needed by <fragment>; skip with
--without <fragment>)`.

### Invocation string

The `next` prompt and the brief use `Host.invocation` (roadmap, Types and schemas:
Invocation string). 1.1 stubs it as `stacks` until 0.2 lands; 0.2 fills in the
`_npx` rule. Nothing here sets it.

### Result

```ts
const NewResult = Schema.Struct({
  project: Schema.String,                 // absolute path
  stack: Schema.String,
  fragments: Schema.Array(Schema.String),
  preset, agents,
  written: Schema.Array(Schema.String),   // relative output paths
  brief: Schema.Literal(".stacks/BRIEF.md"),
  briefWords: Schema.Number,              // renderBrief (1.1), countWords of the whole brief
  fixedWords: Schema.Number,              // renderBrief (1.1), countWords of the text.ts segments
  missingTools: Schema.Array(Schema.Struct({ tool: Schema.String, owners: Schema.Array(Schema.String), without: Schema.Array(Schema.String) })),
  untrusted: Schema.Array(Schema.Struct({ id: Schema.String, origin: Schema.String, dir: Schema.String })),
  warnings: Schema.Array(Schema.Struct({ code: Schema.String, id: Schema.String })), // from 1.1, plus git_init_failed
  git: Schema.Literals(["fresh", "parent", "none"]),
  stateRecord: Schema.Boolean,            // 1.2b; false until 1.2b lands
  handoff: Schema.Struct({ kind: Schema.Literal("print"), next: Schema.String }), // 1.4 widens
})
```

`briefWords` and `fixedWords` are numbers, as the roadmap's Word count contract defines
them; 1.6b's run notes copy both from this result. 3.1c adds `dryRun`.

`next` is the prompt the agent or user should act on: "Read .stacks/BRIEF.md and
carry it out. It is your full task for this project; you're done when `<cli> verify`
passes." 1.4 replaces the `print`-only handoff with its full union.

Human output lists the stack, fragments, the written files collapsed by 1.1's
`collapsePaths`, warnings, missing tools with their `--without` hints, and the next step.

### Failure modes

| Situation | Error tag | Exit | What the agent sees |
|---|---|---|---|
| Unknown stack or fragment | `NotFound` | 2 | From 1.1, with known ids |
| Unknown `--agents` id; same id in `--with` and `--without` | `Usage` | 2 | The parser's usage error naming the flag |
| `--scope` isn't a valid npm scope | `BadInput` | 2 | `details: { id, flag: "scope" }`; nothing written |
| Project directory name has a control character | `BadInput` | 2 | `details: { id, flag: "dir" }`; nothing written |
| An entry file under `.git/` or `.stacks/`, any case | `ComposeConflict` | 2 | `reason: "reserved_path"`, `path`; nothing written |
| Two planned files differing only in case, or a file where another needs a directory | `ComposeConflict` | 2 | `reason: "file_owner"`, both owners, `path`; nothing written |
| `Settings.package_scope` isn't a valid npm scope (and no `--scope`) | `InvalidConfig` | 3 | Nothing written |
| Composition conflict, needs own repo | `ComposeConflict` | 2 | `details.reason`; for `needs_own_repo`, `ids` and `fix` |
| Unknown template variable | `EntryInvalid` | 2 | `details: { id, origin, reason: "template", path }`; nothing written |
| Target has files | `TargetNotEmpty` | 2 | `details: { path, entries: <first 10 names, litter excluded> }` (1.2b adds `scaffold`) |
| `git init` fails | none | 0 | `git_init_failed` warning; `git: "none"`; a partial `.git` it made is removed |
| git can't read the target's repository state (a broken `.git`, unsafe ownership, a timeout) | none | 0 | `git_unusable` warning; `git: "none"`; no `git init` |
| Target unwritable | `PermissionDenied` | 6 | `details: { reason: "unwritable", path }`; no files left behind |
| A write would escape the project | `PermissionDenied` | 6 | `details: { reason: "escape", path }` |
| Interrupted mid-write | `Interrupted` | 130 | Written files removed |

`TargetNotEmpty` is the roadmap's Error tags row; this file adds it.

### Settled here

| Question | Answer | Why |
|---|---|---|
| Brief and notes in git | Ignored by default | The brief is a one-shot task; notes are for the person who ran it |
| Non-empty target | Refused | `new` never overwrites; `add` is the path for an existing repo (D4) |
| Failed `new` | Rolls back its own writes | A half-written project looks finished to an agent |
| Escape check | Real path against real path | macOS temp paths are symlinked |
| Slug in the MVP | ASCII lowercase and dashes | Enough for directory names; the full table waits for 3.1c |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/commands/new.ts` | Thin handler |
| `packages/cli/src/core/scaffold/` | `target.ts` (litter list), `write.ts` (real-path writer with rollback), `template.ts` (tokenizer), `slug.ts`, `author.ts` |
| `packages/cli/src/schemas/new.ts` | `NewResult` |
| `packages/cli/src/errors.ts` | `TargetNotEmpty` and its row; `EntryInvalid` reason `template`; `PermissionDenied` reasons `escape` and `unwritable` |
| `packages/cli/src/cli.ts` | `newCommand` |
| `packages/cli/tests/new.test.ts`, `tests/scaffold-write.test.ts`, `tests/template.test.ts` | New |
| `packages/cli/e2e/` | One test against the built artifact for `new --sandbox --json` on the fixture registry |

## Acceptance tests

Through `runCli` with temp HOME, XDG dirs and a temp `cwd`; git is the real binary (tests
that need it skip with a message when it is absent).

1. `new fixture-stack app --sandbox --json` exits 0, prints one JSON result, and on disk
   has the stack's files, rendered templates with no `{{` and no `.tmpl` suffix,
   executable hooks, `.gitignore` from the fixture's literal `files/.gitignore`, `BRIEF.md` whose
   `countWords` equals `briefWords`, `fixedWords` equal to `renderBrief`'s value for the
   same composition, and `NOTES.md` with both headings.
2. A target with a file in it fails `TargetNotEmpty` and writes nothing.
3. A target inside a temp git repo is not re-initialized, and a `needsOwnRepo` fragment is
   refused before any write.
4. An entry with a symlinked `files/` target, and a planned path with `..`, both fail
   `PermissionDenied` with `reason: "escape"` without writing outside the temp root
   (assert the parent dir is unchanged). A target reached through a symlinked parent (the
   macOS `/var` case, reproduced with a temp symlink on Linux) writes normally.
5. An unknown `{{name}}` in a template fails `EntryInvalid` reason `template` and the
   target does not exist afterwards.
6. A failure injected after the first write (a later file's directory made read-only)
   leaves the target exactly as it was.
7. Interrupt via `runCli`'s `signal` while `new` runs, after its files are written (a
   `git` shim's `init` sleeping), exits 130 and leaves no files; the writer alone,
   interrupted after its first write, rolls that write back.
8. Missing tools (a temp `PATH` without the fixture's tool) are listed in the result and
   the brief; `new` still exits 0.
9. `--sandbox` implies `--yes` in the brief.
10. Under `--json`, no entry command ran: a fixture fragment whose verify step is
    `touch ran` leaves no `ran` file (the D2 check).
11. Slug: every row of the slug table, plus a property test (`@effect/vitest`) that `slug`
    output always matches `^[a-z0-9]+(-[a-z0-9]+)*$`.
12. `Settings.author` beats a temp repo's `git config user.name`; with neither, `author`
    renders empty. `project_name` is the directory's base name.
12a. `package_scope`: `--scope @acme` renders `acme`; `Settings.package_scope: "acme"`
    with no flag renders the same; the flag beats the setting; with neither it renders
    empty; `--scope Acme/x` fails `BadInput` and writes nothing. A file without the
    `.tmpl` suffix containing `{{package_scope}}` is copied unchanged.
13. Tokenizer: every row of the template syntax table, in one fixture file.
14. A target holding only `.DS_Store` and `Thumbs.db` is used, and both are still there
    afterwards and absent from `written`.
15. In a temp parent repo with an optional `needsOwnRepo` fragment selected,
    `ComposeConflict` has `details.fix: ["--without <id>"]`; with a required one, `fix`
    is empty.
16. A missing tool owned by a default fragment has `drop: [{ id: <id>, flag: "without" }]`;
    one owned by the stack has `drop: []`.
17. With a `git` shim on `PATH` whose `init` exits 1, `new` exits 0 with `git: "none"`
    and a `git_init_failed` warning, and every file is written.
18. `--agents nope` exits 2 with a `Usage` envelope and `--with x --without x` exits 2
    with `BadInput`; neither writes anything.

## Exit criteria

- Tests pass; `bun run check` green from the repo root, including the new e2e case
  against the built artifact.
- `AGENTS.md` documents `.stacks/` in its architecture map; `packages/cli/README.md`
  documents `new` and its flags.
- What was built matches the roadmap contracts this file owns (Safe writer, Project
  metadata, `slug` in Shared helpers) and the Word count row's `new --json` fields.

## What this plan may get wrong

- Rolling back by tracking written paths assumes nothing else writes into the target
  during `new`. True for the CLI alone; an editor watching the directory could add files,
  which the rollback must leave alone.
- `project_name` from the directory name may produce a slug some generators reject (a
  leading digit for Go modules). The stack's decisions own that; the variable set stays
  fixed.
- 3.1c's fuller slug rule changes the slug of some inputs (`myApp` becomes `my-app`
  instead of `myapp`). Projects already written keep their files; only later `new` and
  `add` runs see the new value.
- The `new` result's `handoff` field is a placeholder until 1.4; if 1.4 lands in
  parallel, merge the shapes by hand.
- 2026-10-26: this plan first wrote dotfiles from `_dot_` names and left
  `package_scope` to a later format version built in 3.3a (the old D28). The amended D18
  stores dotfiles literally and puts `package_scope` and `--scope` in v1, built here. If
  npm's packing drops a bundled `.gitignore`, that is 0.2's to fix, not this writer's.
- 2026-10-26, found while executing:
  - The same id in `--with` and `--without` stays `BadInput` with `details.id`, the
    contract 1.1 shipped and the roadmap records, not `Usage`. The exit is 2 either way;
    test 18 asserts `BadInput` for that case and `Usage` for `--agents nope`.
  - `NewResult.missingTools` is 1.1's `MissingTool` as shipped: `{ tool, owners: EntryRef[],
    drop: { id, flag }[] }`, not `owners: string[]` and `without: string[]`. A tool the
    stack or a required fragment needs has `drop: []`. `untrusted` items carry `kind`, as
    the Composition row says. `warnings` items take an optional `exitCode`, and
    `git_init_failed` uses the id `git`.
  - `needs_own_repo` puts the enclosing repository's root in `details.path`. `fix` lists
    `--without` flags only; when any of the fragments could only be dropped by changing a
    `--with`, or is required, `fix` is empty. The drop rule is `compose.ts::dropFlags`,
    shared with `missingTools`.
  - An entry file planned under `.stacks/` or `.git/` is refused before writing as
    `ComposeConflict` `file_owner`: the CLI owns both.
  - `Registry` gained `bytes`, so copies are byte for byte (binary files included) and
    still never follow a symlink. Roadmap Registry view row updated.
  - There is no `author.ts`: the `git config user.name` lookup is one constant command and
    lives in `scaffold/git.ts` with the other git commands.
  - When `git init` fails, the brief has already been written with a fresh repo in it, so
    `new` re-renders it with git `none` and replaces it; `briefWords` is the rewritten
    brief's.
  - An existing target that isn't a directory (a file, a dangling symlink) is
    `TargetNotEmpty` with `entries: []`. A write that finds its file already there
    (anything planted mid-run, or a symlink in the final segment) is also `TargetNotEmpty`;
    it is never written through. Any other write failure is `PermissionDenied` `unwritable`.
  - Rollback removes the files it wrote only while their parent still resolves inside the
    project, and removes the directories it made only when they are empty, so files some
    other process added during `new` survive. A target directory that held only `.git` gets
    its `.git` removed on rollback only if `new` itself ran `git init` in it.
  - Test 4's "symlinked `files/` target" is covered twice over: the registry already
    refuses any symlink inside an entry (1.0's tests), and `new.test.ts` plants a symlink in
    the target under an OS-litter name, which the emptiness check ignores, so the writer's
    own real-path check is what stops it.
  - Interruption is tested through `runCli`'s signal and through a real CLI process sent
    SIGINT, both while a `git` shim's `init` sleeps after every file is written.
  - The dev wrapper ran the CLI in `packages/cli`, so `new` wrote there. It now runs it with
    `cwd` set to the caller's directory and with Bun's dotenv and bunfig autoload disabled
    for that child. Bun 1.4 sets neither `INIT_CWD` nor the caller's `PWD` for a script, but
    it does set `npm_config_local_prefix` to the directory `bun run` started in, so the root
    `dev` script passes that on. Under `bun run --cwd <repo>` nothing carries the caller,
    so a run from outside the repository sets `INIT_CWD="$PWD"` itself.
  - Human `NotFound` for an entry id now ends with
    `Next: stacks list shows every stack and fragment.`, with or without suggestions;
    a far-off id used to print a bare "Not found.".
  - Manual runs used the realistic fixture registry: its stack in sandbox mode wrote nine
    files, a fresh repository and a brief of about 4,000 words (about 6,000 with its app
    fragment). Those entries show as untrusted because a non-default
    `STACKS_REGISTRY_DIR` is untrusted, while human output labels them by origin
    (`bundled`), which reads oddly next to "Untrusted".
- 2026-10-26, from the code review on feat/phase-1:
  - **The reserved-path check moved into `compose`** (`compose.ts::reservedSegment`), so
    3.0's `add` reuses it, and it folds case: on APFS `files/.GIT/config` used to land in
    `.git/config`. It is its own reason, `reserved_path`, instead of `file_owner` with
    empty `ids`. `compose` also refuses planned paths that collide under case folding
    (`README.md` and `readme.md`) or where one is a directory prefix of another, as
    `file_owner` naming both owners; they used to fail halfway through the write as
    `TargetNotEmpty`.
  - **Git probing distinguishes "no repository" from "git failed".** Only git's
    "not a git repository" (read with `LC_ALL=C`) makes the target fresh, and only when
    the target has no `.git` of its own; anything else (a broken `.git`, unsafe
    ownership, a timeout) is `none` with a `git_unusable` warning and no `git init`. A
    pre-existing `.git` used to be inited over and adopted, so an interrupt deleted it.
    `.git` is adopted for rollback only when it was absent right before `git init`, and a
    failed init's partial `.git` is removed before the brief is re-rendered.
  - **A target that is its own repository root** is fresh when nothing is committed and
    `parent` (don't commit without asking) once it has commits, but `needs_own_repo`
    fragments are no longer refused there: the repository is the project's own.
  - **The writer's rollback removes directories only when empty** (`rmdir` semantics)
    and only while their parent still resolves inside the project. Effect's FileSystem
    has no `rmdir` and its `remove` refuses a directory unless it recurses, so `write.ts`
    imports `rmdir` from `node:fs/promises`, its one Node API.
  - **Template values are checked.** See the variable table: `project_name` refuses
    control characters, `author` loses quotes, backslashes and line breaks.
  - **BadInput details gained a closed `flag`** (`scope`, `with_without`, `dir`,
    `brief`), so human mode names the flag and ends with a `Next:` line.
  - **Human report.** The `Project:` line is dropped when it repeats the `Created` path,
    and `git_init_failed` is shown once, on the git line, not again under Warnings.
  - **Test naming.** "SIGINT while new writes exits 130" interrupted `git init`, not a
    file write; it is now named for what it does. Every interrupt shim makes `.git`
    before it sleeps, so the rollback of a real partial `.git` is exercised.
  - **Not covered by a test:** the post-write recheck that removes a file whose parent
    moved outside the project. Reproducing it needs a swap timed between two system
    calls, and the writer has no test hook for that.
- 2026-10-26, when tagging the acceptance tests: items 7, 16 and 18 were reworded to what
  shipped, as the "found while executing" notes above record (interruption tested while
  `git init` runs, plus the writer's own rollback test; `missingTools` items carry
  `drop`, not `without`; the same id in `--with` and `--without` is `BadInput`).
