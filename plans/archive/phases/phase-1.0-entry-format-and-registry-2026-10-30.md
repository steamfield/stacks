# Phase 1.0: Entry format and registry

Status: EXECUTED 2026-10-26; reviewed, fixed, merged to main (PR #4). Format sections rewritten
2026-10-26 to the amended D18 (snake_case keys, literal dotfiles, apps as fragments,
`expect` steps), which the maintainers have not yet agreed; see "What this plan may get
wrong"
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | Define what a stack and a fragment are on disk (entry format v1, D18 as amended), define `AgentId` and `DetectedAgent`, load entries from the project, user and bundled origins with `origin` and `trusted` marks (D19), and ship `list [stacks\|fragments\|apps]` and `list --json` so an agent can pick a stack and, optionally, an app |
| Traces to | "It runs `list --json`, picks a stack, runs `new`" (Who has it, the coding agent); job 5, "I want a target I can verify against"; What this is not, "`files/` holds only what is the same across versions; everything else is prose" |
| Depends on | [0.3a](phase-0.3a-errors-and-output-2026-10-30.md) (the error table, closed `details`, and `Host.stdoutIsTTY` for the human layout). Soft: [0.2](phase-0.2-npm-distribution-artifact-2026-10-30.md) for the bundled registry path at runtime (`Host.registry`). While `bin.ts` runs on Bun, `Host.registry` is a stub path (`packages/cli/registry/` resolved from the repo) that tests override; the `import.meta.url` resolution that works inside the npm package waits for 0.2 |
| Blocks | [1.1](phase-1.1-composition-and-brief-2026-10-30.md), and through it the rest of phase 1. Stack prose for [1.6a](phase-1.6a-bundled-stack-content-2026-10-30.md) can be drafted once D18 is agreed |
| Decisions needed | D18 (entry format v1, proposed by this file). If the maintainers change the format, this file's schema changes before 1.1 starts, and 1.6a waits for the new version. D19 (project entries untrusted). If D19 is declined, project entries with a new id become trusted: one line in the trust computation and acceptance test 5 flip, nothing else changes. D6 only changes which entries ship (1.6a) |
| Settles | Frontmatter schema v1, `AgentId` and `DetectedAgent`; snake_case YAML keys decoded to camelCase fields; literal dotfiles; origin order; where the user directory lives; the `yaml` dependency; the `list --json` shape |

## Scope

In:

- The entry layout (roadmap, Other shared facts: Entry directories). Dotfiles are stored
  literally; there is no escape rule.
- Frontmatter schema v1 for both kinds (D18), decoded with Effect Schema, excess
  properties rejected, including `VerifyStep`, `Expect`, `AgentId` and `DetectedAgent`.
- Splitting a markdown file into frontmatter and body. No markdown parsing beyond that.
- Loading entries from three origins: project, user, bundled, with `origin`, `trusted`
  and `shadows` on every `Entry`, and `RejectedEntry` for one that failed to decode.
- `stacks list [stacks|fragments|apps] [--json]`.
- Two fixture registries used by this and later sub-phases:
  `packages/cli/tests/fixtures/registry/` (small, one case per rule) and
  `packages/cli/tests/fixtures/registry-real/` (five realistic entries, below).

Out:

- Composition, conditional prose and the brief (1.1). Running verify steps (1.3a).
- The trust store and `stacks trust`, which make a project entry trusted (3.2a).
  1.0 marks every project entry untrusted; see "Trust marks" below.
- `show` (3.1a). Git sources (3.2a). The remote index (4.0d).
- `lastRun` data in `list` beyond a `null` placeholder; the run ledger
  ([2.0c](phase-2.0c-run-ledger-2026-10-30.md)) fills it.
- Real bundled stack content (1.6a). 1.0 ships the fixture registry only, and
  `packages/cli/registry/` stays empty (roadmap, Other shared facts: Bundled registry in
  the repo).

## Design

### Entry layout

The layout is the roadmap contract (Other shared facts: Entry directories). This file
owns it:

```
<origin root>/
  stacks/<id>/
    STACK.md            required
    files/              optional, copied into the project for every agent
    adapters/<agent>/   optional, copied only when <agent> is a target
  fragments/<id>/
    FRAGMENT.md
    files/
    adapters/<agent>/
```

`<agent>` is an `AgentId` (below). AGENTS.md is the instruction file for every agent, so
an agent with no adapter directory still gets full guidance.

There is no third directory for apps: an app is a fragment with `category: app` (below),
stored under `fragments/<id>/FRAGMENT.md` like any other.

An entry directory must not contain symlinks anywhere. Reading one that does gives a
`RejectedEntry` in `list` and `EntryInvalid` (reason `symlink`) from `get` and `files`.
This keeps `new` from writing outside the project through a link an entry shipped.

### Dotfiles

Dotfiles in `files/` and `adapters/<agent>/` are stored literally: `files/.gitignore` is
written as `.gitignore`, `files/.github/workflows/ci.yml` as `.github/workflows/ci.yml`.
That is what an author expects to find when they open a `files/` tree, and what they get
when they copy files from a real project. `Registry.files` returns each file with
`source` (the entry-relative path on disk) and `path` (the output path: `source` without
the `files/` or `adapters/<agent>/` prefix), so 1.1 plans ownership and merges on output
paths and 1.2a writes to them.

npm drops `.gitignore` files when it packs a package, so a bundled entry's `.gitignore`
would vanish from the tarball. That is a packaging problem, not a format one, and 0.2
owns it (a pack-time escape that the installed CLI undoes, or a check that fails the
pack); see 0.2's "What this plan may get wrong". Until 0.2 lands nothing is packed, so
nothing is lost.

### Frontmatter schema v1 (D18)

The schema symbols are the roadmap contract (Types and schemas: Entry format v1), in
`src/schemas/entry.ts`. The versioning rule is the roadmap's Schema versions table (Entry
frontmatter row): this file implements it and doesn't restate it.

Keys are snake_case in YAML, because that is what authors write in frontmatter. The
schema decodes them to camelCase TypeScript fields (`applies_to` to `appliesTo`), the
spelling every CLI output (`list --json`, the manifest, results) already uses: snake_case
for what authors write, camelCase for what the CLI emits. One schema does the renaming
(Effect Schema's key mapping on the struct), so no other code sees a snake_case key.

Fields shared by both kinds:

| Field (YAML) | Type | Rule |
|---|---|---|
| `schema_version` | literal `1` | See Schema versions |
| `id` | kebab-case string | Must equal the directory name, so two entries of one kind in one origin can't share an id. Ids are unique per kind: a stack and a fragment may share an id (roadmap, Contracts: Entry and its listing) |
| `kind` | `"stack" \| "fragment"` | Must match the file name |
| `name` | string | Human title |
| `description` | string, one sentence | What an agent reads from `list --json` to choose. Say what the project is for |
| `tags` | string[], default `[]` | Runtime (`bun`, `node`, `go`, `python`), shape (`web`, `cli`, `api`, `monorepo`), entry style (`make` or `scripts`, exactly one on a stack) |
| `deps` | record of role to package names, default `{}` | Names only, never versions. A value that looks like a version (`@1.2`, `^`, `~`, `>=`) is rejected by `validate` (1.5) |
| `commands` | record of name to one-line purpose, default `{}` | The project commands this entry adds or redefines |
| `tools` | string[], default `[]` | CLIs the agent needs on PATH (`uv`, `bun`, `go`, `make`) |
| `decisions` | string[], default `[]` | Each states its default: "Package manager for the frontend (default: bun)" |
| `env` | record of string to string, default `{}` | Defaults copied to the manifest and passed to verify, used for ports (`PORT_WEB: "5173"`) |
| `verify` | `VerifyStep[]`, default `[]` | See below |
| `merge` | string[], default `[]` | Relative output paths this entry writes that are JSON and may be deep-merged with other writers (1.1) |

Stack only: `fragments: { required, default, optional }`, each a list of fragment ids,
each defaulting to `[]`.

Fragment only:

| Field (YAML) | Type | Rule |
|---|---|---|
| `category` | `agent-ops \| app \| ci \| deploy \| release \| service \| vendor \| tooling` | `app` marks an app (below) |
| `applies_to` | string[], default `[]` | Stack ids or tags; empty means anywhere. An app must name at least one |
| `needs_own_repo` | boolean, default `false` | 1.2a refuses to write it inside an enclosing repository |
| `requires` | string[], default `[]` | Fragment ids pulled in with it (1.1) |
| `conflicts` | string[], default `[]` | Fragment ids it can't be composed with |
| `requires_tools` | string[], default `[]` | CLIs this fragment needs on PATH beyond `tools` |

### Apps

An app is a fragment with `category: app`: a small application built on top of a stack,
selected with `--with` like any optional fragment. Making it a fragment keeps one entry
kind and one composition algorithm. What is special about an app is all in composition
(1.1): at most one per composition, ordered last, never required, dropped by `--sandbox`
unless asked for, and its verify steps get the reserved `app` tag. 1.0 enforces only what
the schema can see: an app's `applies_to` is non-empty, and no entry's own steps carry
the `app` tag.

### `AgentId`

`src/schemas/entry.ts::AgentId` is the roadmap contract (Types and schemas: Agent ids).
It lives here because the entry format names adapter directories by it, and 1.1
(`ComposeOptions.agents`, `Settings.agents`), 1.2b (the manifest, detection) and 1.4
(handoff) all import it from this file. No other file declares the set.

`src/schemas/entry.ts::DetectedAgent` is `AgentId | "other" | "none"`, declared next to
it: the agent the CLI is running under, where `"other"` is a generic marker that names
no known agent and `"none"` means no marker. It is the one type for `AppConfig.agent`
(1.2b), `RunRecord.agent` (1.3b), `HandoffDecision` (1.4) and `LastRun.agent` (4.0c).
1.0 declares it so all four import one schema; nothing in 1.0 detects an agent.

### Verify step schema

Part of the entry format; 1.3a runs it. The step shape, the duration pattern and the
reserved `app` tag are contract rules (Entry format v1); this is how they look in the
schema (every key is one word, so YAML and TypeScript spell them the same):

```ts
const Phase = Schema.Literals(["setup", "check", "serve", "teardown"])
const Layer = Schema.Literals(["install", "lint", "typecheck", "test", "build", "serve", "docs"])
const Duration = Schema.String.check(Schema.isPattern(/^\d+(ms|s|m)$/)) // "500ms", "90s", "10m"

const Expect = Schema.Struct({
  http: Schema.String,                     // a URL; ${VAR} is expanded from the verify env
  within: Schema.optional(Duration),       // default "60s"
})

const VerifyStep = Schema.Struct({
  name: Kebab,                             // unique within a composition (1.1)
  run: Schema.String,                      // a project command, run through the shell
  cwd: Schema.optional(Schema.String),     // relative, must stay inside the project
  phase: Schema.optional(Phase),           // default "check"
  tags: Schema.optional(Schema.Array(Schema.String)), // default []; "prod" is skipped under --sandbox
  expect: Schema.optional(Expect),         // required when phase is "serve"
  layer: Schema.optional(Layer),           // what D7 counts; 1.5 checks coverage
  timeout: Schema.optional(Duration),      // default "10m"; 1.3a reports failureKind "timeout"
})
```

`layer` and `timeout` are additive optional keys this plan keeps on top of the core step
(`name`, `run`, `cwd`, `phase`, `tags`, `expect`): `layer` because D7 and run records
read it, `timeout` because a hung step must not hold verify forever. A step written
without them decodes.

`timeout` bounds the whole step except a `serve` step, which ends at its `expect` probe
and is bounded by `within` (1.3a). Ten minutes covers a cold dependency install on a slow
network; a step that needs longer says so. Defaults (`phase: "check"`, `tags: []`,
`within: "60s"`, `timeout: "10m"`) are applied by one function,
`entry.ts::withStepDefaults`, which 1.2b's digest and 1.3a's runner both call, so the
digest and the runner never disagree about a default.

Cross-field rules are Schema filters on the struct, so a bad entry fails at decode with a
path to the offending step: a `serve` step has `expect`, and no step in an entry carries
the tag `app`, which the CLI adds to an app's steps (1.1). `expect` on a step that isn't
`serve` decodes; 1.3a doesn't read it there and 1.5 warns.

v1 has no built-in file checks: a step that checks a file runs a short command. The
earlier draft's `check` kinds (`filled`, `exists`) and its `probe` key are dropped from
1.0; 1.3a records built-in checks as an open additive item.

### Body

Everything after the closing `---` is guidance prose for the building agent. 1.1 copies it
into the brief. Recommended stack sections: `## Layout`, `## Setup` (numbered, generators
named with their target directory, "non-interactively", no flags), `## Conventions`,
`## Tool configuration` (intent, never a pasted config file), `## Testing`, `## Commands`,
`## Gotchas` (by symptom and durable fix, never a version). These are guidance for
authors; 1.0 does not enforce headings.

### Origins and precedence

`Origin` is the roadmap contract (Types and schemas: Entry and its listing):
`"project" | "user" | "bundled"` here, extended by `"source"` (3.2a) and `"index"`
(4.0d).

| Origin | Root | Default trust | Notes |
|---|---|---|---|
| `project` | `./.stacks/` in `Host.cwd` | Untrusted ([Trust model](../../roadmap.md#trust-model), point 2; D19) | A cloned repo can ship these |
| `user` | `$XDG_CONFIG_HOME/stacks/` (default `~/.config/stacks/`) | Trusted | The directory that holds `config.json`. The problem statement's `~/.stacks` |
| `bundled` | `packages/cli/registry/` in the repo, inside the npm package at runtime | Trusted | `Host.registry`, a stub repo path from `bin.ts` until 0.2 resolves it from `import.meta.url`; never computed by core code |

Lookup by id walks project, user, bundled and returns the first hit. `list` shows each id
once, from the winning origin, with `shadows: ["bundled"]` when it hides another copy.

An entry that fails to decode in a higher origin is not silently replaced: `list` shows a
`RejectedEntry` with its error, and `get` (used by 1.1 and 1.2a) fails `EntryInvalid`. The
exception is `schema_version` above 1, which falls through to the next origin with one
warning (Schema versions), so an older CLI keeps working against a newer user directory.

### Trust marks

Every `Entry` carries `trusted`, computed by one function,
`registry.ts::trustOf(origin, entry)`. In 1.0 it returns `true` for `bundled` and `user`
and `false` for `project`, with or without shadowing. 3.2a makes `project` entries whose
content digest is in the trust store return `true` and adds `source`; 4.0d adds `index`.
1.0 does not read the trust store or define the entry content digest: both are 3.2a's,
and 1.0 must not invent a format 3.2a then has to migrate. What an untrusted entry can do
is [Trust model](../../roadmap.md#trust-model), point 3; 1.1, 1.2a and 1.4 implement it.

### Services

`Entry`, `RejectedEntry` and `Origin` are the roadmap contract (Entry and its listing).

```ts
// src/core/registry/entry.ts
export type Entry = {
  id: string
  kind: "stack" | "fragment"
  origin: Origin
  dir: string                  // absolute
  trusted: boolean
  shadows: ReadonlyArray<Origin>
  meta: StackMeta | FragmentMeta
  body: string
}
export type RejectedEntry = {
  id: string                   // the directory name
  kind: "stack" | "fragment"
  origin: Origin
  dir: string
  error: string                // one line naming the field or rule
}
export type EntryFile = { source: string; path: string; mode: number } // see Dotfiles; literal names

// src/core/registry/registry.ts
export class Registry extends Context.Service<Registry, {
  readonly all: Effect.Effect<ReadonlyArray<Entry | RejectedEntry>, PermissionDenied>
  readonly get: (kind: Entry["kind"], id: string) =>
    Effect.Effect<Entry, NotFound | EntryInvalid>
  readonly files: (entry: Entry) =>
    Effect.Effect<ReadonlyArray<EntryFile>, EntryInvalid> // files/ and adapters/, relative
}>()("stacks/Registry") {
  static layer: (roots: RegistryRoots) => Layer.Layer<Registry, never, FileSystem | Path>
}
// ordered, highest precedence first; see roadmap, Contracts: Registry view
export type RegistryRoots = ReadonlyArray<{ origin: Origin; path: string }>
```

`Registry.layer` is built per invocation from `Host.cwd` (project root), `AppConfig.paths`
(user root) and `Host.registry`, in that order. Taking an ordered list rather than
three named fields lets 1.5 put the root it validates first, and lets 3.2a and 4.0d insert
their origins without changing the service. It reads lazily: `list` reads frontmatter only;
`files` walks a directory only when 1.1 asks. No cache crosses invocations (AGENTS.md: "No
globals/caches across runs").

`config.ts::Paths` gains `user: join(XDG_CONFIG_HOME, SLUG)`. Today `Paths.config` is the
path of `config.json` itself, so `user` is a separate field rather than a parent of it.
Doctor reports it.

### Frontmatter parsing

Split on a first line of exactly `---` and the next line of exactly `---`. Parse the YAML
between with the `yaml` package's `parse` in its default (YAML 1.2 core) mode, then decode
the unknown value with `Schema.decodeUnknownEffect(StackMeta, { onExcessProperty: "error" })`.
Excess keys are checked against the snake_case names, so a camelCase `appliesTo` in YAML
is an unknown key, not an alias.

`yaml` is the one new runtime dependency (roadmap, Other shared facts: New dependencies).
Effect has no YAML reader, frontmatter is YAML by convention in every markdown tool authors
already use, and a hand-written YAML subset parser is the kind of custom code AGENTS.md
says to avoid. It goes in the root workspace catalog and `packages/cli/package.json`.

### `list`

```
stacks list                 # stacks, fragments, apps
stacks list stacks          # one group: stacks, fragments (apps excluded) or apps
stacks list --json          # everything
```

```ts
const ListRow = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["stack", "fragment"]),
  name: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  category: Schema.optional(Category),               // fragments only; "app" for an app
  appliesTo: Schema.optional(Schema.Array(Schema.String)), // fragments only
  origin: Origin,
  trusted: Schema.Boolean,
  shadows: Schema.Array(Origin),
  lastRun: Schema.Null,                              // 2.0c widens it (roadmap, Entry and its listing)
})

const ListResult = Schema.Struct({
  entries: Schema.Array(ListRow),      // stacks first, then fragments; each sorted by id
  rejected: Schema.Array(Schema.Struct({
    id: Schema.String, kind: Schema.Literals(["stack", "fragment"]), origin: Origin,
    dir: Schema.String, error: Schema.String,
  })),
})
```

Output keys are camelCase (`appliesTo`, `lastRun`), like every other CLI result; the
snake_case spelling is only for what authors write in YAML. `list stacks`, `list
fragments` and `list apps` filter `entries` the same way the human view does. The row is
deliberately small: enough for an agent to choose and explain why. The full frontmatter
(fragment lists, tools, requires) is `show`'s (3.1a).

Rejected entries get their own array so an agent iterating `entries` never meets one it
can't use. `lastRun` is always `null` in 1.0; it is in the shape now so agents written
against the MVP don't break when 2.0c fills it. `briefWords` is not in `list`, because it
requires composing; it appears in `new --json` (1.2a) and `validate` (1.5).

The human view is grouped and ends with what to run next:

- A `Stacks` section, a `Fragments` section (every fragment except apps, with its
  category on the row) and an `Apps` section (each app with the stacks or tags in its
  `applies_to`, so the reader sees what it builds on). Empty sections are left out.
  `list stacks`, `list fragments` and `list apps` print only their section.
- Each row is the id, then an origin column only when the listed rows come from more
  than one origin, and an `untrusted` marker, then the description on the following line,
  indented four spaces and word-wrapped at 80 columns, or at the terminal width when
  `Host.stdoutIsTTY` is true and it is narrower. Words are never split; a single word
  longer than the width gets its own line.
- A final `Rejected` block with one line per rejected entry (id, origin, error).
- Then `Next:` lines with the exact commands to run, using `Host.invocation` (0.2; a fixed `stacks` until 0.2 lands) so a
  copy and paste works: `Next: <invocation> new <first-stack-id> <dir> --sandbox` and
  `Next: <invocation> list --json` (for an agent choosing). When there are no stacks, the
  only line is `Next: <invocation> doctor` (the registry path is wrong). `--json` has no
  `Next:` lines; the result shape is unchanged.

Output goes through
`services/output.ts::Output.result(value, human)`, the way
`commands/doctor.ts::doctorCommand` does it.

### Failure modes

| Situation | Error tag | Exit | What the agent sees |
|---|---|---|---|
| Unknown group argument (`list widgets`) | `Usage` | 2 | Fixed usage message |
| User or project root unreadable | `PermissionDenied` | 6 | `{ error: { tag, message, retryable: false, details: { reason: "read", path } } }` (the details shape is 0.3a's; 1.0 adds the reason `read`) |
| An entry fails to decode, has a symlink, or an `id` that differs from its directory | none for `list` | 0 | A `rejected` row with a one-line `error` |
| `get` or `files` on any of the above | `EntryInvalid` | 2 | `details: { id, origin, reason, path? }` |

`EntryInvalid` is the roadmap's Error tags row; its `details` schema is
`{ id, origin, reason: "decode" | "symlink" | "id_mismatch" | "conditional" |
"merge_json" | "merge_template" | "template" | "submodule", path?, line? }`. 1.0 adds the
tag and the first three reasons; 1.1 adds `conditional`, `merge_json` and
`merge_template`; 1.2a adds `template`; 3.2a adds `submodule` for a git source tree (a
local entry directory has no submodule to detect, so 1.0 doesn't need it). There is no duplicate-id reason: `id` must equal the directory name, so one origin can't hold
two entries of one kind with the same id.

### Settled here

| Question | Answer | Why |
|---|---|---|
| Frontmatter key style | snake_case in YAML, decoded to camelCase fields; CLI output stays camelCase | Authors write snake_case frontmatter; the CLI's JSON contract was already camelCase |
| Built-in file checks | Not in v1; a file check is a short `run` command | Keeps the step to one shape; 1.3a records built-in kinds as an open additive item |
| Default step timeout | 10 minutes | Covers a cold install; a hung step can't hold verify forever |
| Apps | A fragment with `category: app`, not a kind | One entry kind and one composition algorithm |
| User directory | `$XDG_CONFIG_HOME/stacks/{stacks,fragments}/` | User-authored entries are configuration; they sit beside `config.json`, which the base already resolves |
| Project-local entries | `./.stacks/{stacks,fragments}/`, all untrusted (D19) | Same directory as project metadata; a clone can ship any id |
| Invalid higher-origin entry | Shown as rejected, not replaced, so a broken user or project copy hides a working bundled one until it is fixed or removed. The rejected row's `error` names the origin it hid (`hides bundled copy`) so the fix is obvious. [Open question 27](../../risks-and-open-questions.md#open-questions-for-the-maintainers) asks the maintainers to confirm this over falling back | Silent fallback hides an author's mistake behind a bundled copy |
| Dotfiles | Stored literally in every origin | It is what authors expect in a `files/` tree; npm's packing gap is 0.2's to solve at pack time |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/schemas/entry.ts` | `AgentId`, `DetectedAgent`, `StackMeta`, `FragmentMeta` (snake_case keys mapped to camelCase fields), `VerifyStep`, `Expect`, `withStepDefaults` |
| `packages/cli/src/schemas/list.ts` | `ListResult` |
| `packages/cli/src/schemas/index.ts` | Exports |
| `packages/cli/src/core/registry/` | `entry.ts` (frontmatter split, decode, `Entry`, `RejectedEntry`), `registry.ts` (service, layer, `trustOf`) |
| `packages/cli/src/commands/list.ts` | Thin handler |
| `packages/cli/src/cli.ts` | Add `listCommand` to the subcommand list |
| `packages/cli/src/config.ts` | `Paths.user` |
| `packages/cli/src/errors.ts` | `EntryInvalid` and its row |
| `packages/cli/tests/fixtures/registry/` | Two stacks, four fragments (one with a literal `files/.gitignore`, one app), one invalid entry, one with `schema_version: 2` |
| `packages/cli/tests/fixtures/registry-real/` | Five realistic entries written in the v1 shape, so decode is tested on content like the bundled catalog rather than only on minimal fixtures: a TypeScript CLI stack with required and default fragments, a full body and `files/` holding literal dotfiles; three fragments it composes with: a tooling fragment with `requires_tools`, a library fragment with `deps` and decisions, and a schema fragment related to the library one by `requires`; and one app fragment (`category: app`, `applies_to` naming the stack, a `serve` step with `expect`). 1.1 and 1.2a reuse it |
| `packages/cli/tests/list.test.ts`, `tests/registry.test.ts`, `tests/entry-schema.test.ts` | New |
| `packages/cli/package.json`, root `package.json` catalog | `yaml` |

## Acceptance tests

All through `tests/helpers/cli.ts::runCli` with temporary HOME and XDG directories,
pointing `Host.cwd` at a temp project through the existing `host: { cwd }` option (no new
option is needed).

1. `list --json` with only the fixture bundled root returns both stacks first, then the
   four fragments, each group sorted by id, every row `origin: "bundled"`,
   `trusted: true`, `lastRun: null`, and an empty `rejected`; exit 0; stderr empty.
1a. Every entry under `tests/fixtures/registry-real/` decodes with no rejected rows, and
   its app row has `category: "app"` and a non-empty `appliesTo`.
2. A user-directory stack with a new id appears with `origin: "user"`, trusted.
3. A user-directory copy of a bundled id wins, with `shadows: ["bundled"]`, trusted.
4. A project-directory copy of a bundled id wins with `trusted: false`.
5. A project-directory entry with a new id appears with `origin: "project"`,
   `trusted: false` (D19).
6. Malformed frontmatter (unknown key, a camelCase key such as `appliesTo`, bad id, `id`
   different from the directory, missing `---`) gives a `rejected` row whose error names
   the field, and `list` still exits 0.
7. `schema_version: 2` in the user directory falls through to the bundled copy and logs
   one warning.
8. A symlink inside an entry rejects it; nothing outside the entry is read.
9. Decode failures: a `serve` step without `expect`; a step without `run`; a step whose
   `tags` include `app`; an app fragment with empty `applies_to`; `within: "90"`;
   `timeout: "1h"`; the dropped keys `check` and `probe`.
10. Decode successes: `expect: { http: "http://localhost:${PORT_WEB}/" }`,
    `within: "500ms"`, `timeout: "15m"`; a step with neither `layer` nor `timeout`;
    `applies_to` decodes to `appliesTo`; `withStepDefaults` fills `phase: "check"`,
    `tags: []`, `timeout: "10m"` and an `expect`'s `within: "60s"`.
11. `Registry.files` on the fixture fragment returns `{ source: "files/.gitignore",
    path: ".gitignore" }`, and `adapters/claude/.claude/settings.json` gives
    `path: ".claude/settings.json"`.
12. `list widgets` exits 2 with the usage envelope under `--json`.
12a. Human `list` over the fixtures prints `Stacks`, `Fragments` (without the app) and
    `Apps` (the app with its `applies_to`); with every row bundled there is no origin
    column, and with one user-directory row there is; a 200-character description wraps
    at 80 columns with no line longer than 80 and no split word; the last lines are
    `Next:` lines whose commands start with the fixture `Host.invocation`; with an empty
    registry the only `Next:` line names `doctor`; `list --json` output contains no
    `Next:`. `list apps --json` returns only the app; `list fragments --json` omits it.
12b. A user-directory copy of a bundled id that fails to decode is a `rejected` row whose
    error mentions the hidden bundled copy, and the bundled copy is not in `stacks`.
13. An unreadable user root (mode 000, skipped when running as root) exits 6 with
    `details: { reason: "read", path }`.
13a. A stack and a fragment with the same id both load and both appear in `list --json`.
14. A property test (`@effect/vitest`): for any generated valid frontmatter object,
    stringify with `yaml`, split, parse, decode and encode returns the same snake_case
    object.

## Exit criteria

- All tests above pass; `bun run check` green from the repo root.
- `bun run dev list --json` against the fixture registry prints parseable JSON.
- `AGENTS.md` architecture map lists `src/core/registry/` and `src/schemas/entry.ts`;
  `packages/cli/README.md` documents `list`, the user directory, the snake_case keys and
  literal dotfiles.
- What was built matches the roadmap contracts this file owns (Entry and its listing,
  Entry format v1, Agent ids and `DetectedAgent`, Entry directories). A mismatch is reported to the
  maintainers, not fixed by editing another sub-phase.

## What this plan may get wrong

- The `effect/cli` argument API for an optional positional with a fixed set of values may
  push `list [stacks|fragments|apps]` into subcommands. Check the installed exports first.
- `Schema.Literals`, `Schema.isPattern`, struct-level filters and the key mapping that
  turns `applies_to` into `appliesTo` are the Effect 4 names and APIs as far as this plan
  knows; confirm against the installed `effect` types, as the effect skill says. If key
  mapping can't keep excess-property errors pointing at the YAML name, decode a
  snake_case struct and map it in one function instead.
- Reading only frontmatter for `list` assumes bodies are large enough to matter; if not,
  reading whole files is simpler.
- 2026-10-26: this plan first proposed camelCase YAML keys, a `_dot_` escape for dotfiles
  (with `unescapeEntryPath` and an `EntryInvalid` reason `dotfile`), built-in `check`
  kinds in a single-key union, a `probe` key, and a `list --json` split into `stacks` and
  `fragments` arrays with a `valid` flag. The amended D18 replaced all of them: snake_case
  YAML because that is what authors write; literal dotfiles because that is what authors
  expect in a `files/` tree, with npm's packing gap moved to 0.2; `expect` in place of
  `probe`; no built-in checks in v1; apps as `category: app` fragments rather than a third
  kind (which also retired 3.5a); and one sorted `entries` array. The earlier draft also
  planned a `cwd` option for `runCli`, which already takes `host: { cwd }`. Whether
  dropping the built-in `filled` check weakens D7 (a README check now needs shell) is
  open; 1.3a records it.
- The `submodule` reason was listed for 1.0 in the roadmap's Error tags row but never
  used here. It belongs to 3.2a, which inspects a git tree; the roadmap now says so.
- 2026-10-26, from executing it:
  - **Pointing the CLI at a registry.** Nothing in the plan let the dev CLI or the binary
    read a registry other than the stub path, so 1.0 adds `STACKS_REGISTRY_DIR`,
    read by `config.ts` as `Paths.registry`; when set it replaces `Host.registry` as the
    bundled root (`registry.ts::defaultRoots`). `Host.registry` is still never computed
    by core code. 1.5 and 1.6b can use the same variable to validate or gate a catalog
    outside the package.
  - **Doctor.** `doctor` now reports `paths.user` and `registry: { path, found }` (the
    roadmap's Bundled registry row), so the `Next: stacks doctor` line leads
    somewhere useful.
  - **`Host` fields.** 1.0 declares `Host.invocation` (the constant `stacks` from
    `bin.ts`), because its `Next:` lines use it; the roadmap's Invocation string row now
    says so. It also adds `Host.stdoutColumns` (the terminal width when stdout is a TTY),
    which the 80-column wrap needs and `Host.stdoutIsTTY` alone can't give.
  - **The group argument.** `list [stacks|fragments|apps]` is a plain optional string
    argument checked in the handler, not `Argument.Literals` or subcommands, so an
    unknown group fails `Usage` with `details: { command, suggestions }` from `closest`
    (`list stack` suggests `stacks`). `Argument.Literals` gives effect/cli's
    `InvalidValue`, which carries no choices to suggest from.
  - **`get` can fail `PermissionDenied`.** It reads through `all`, which fails
    `PermissionDenied` on an unreadable root, so `get`'s error type includes it.
  - **The small fixture is split.** Acceptance test 1 needs an empty `rejected` for the
    bundled fixture, so the invalid entry and the `schema_version: 2` entry live in
    `tests/fixtures/registry-broken/`, and tests copy them into a user or project root.
    `tests/fixtures/registry/` holds only the two stacks and four fragments.
  - **`list` walks entry directories.** Rejecting an entry that contains a symlink means
    `list` lists every file in each entry (with `lstat`, never following a link), not
    only the frontmatter. It still reads only the markdown file's contents.
  - **The realistic fixture's `requires`.** In `registry-real/`, the library
    fragment requires the schema fragment (the testing fragment pulls in the schema
    fragment), the reverse of the Files table's description. References to fragments the
    fixture doesn't hold were trimmed rather than stubbed: the stack's required harness
    fragment, its CI and release fragments, and the app's provider and harness
    requirements. The stack now requires the schema fragment, defaults to the tooling and
    library fragments, and offers the app.
  - **A literal `.gitignore` ignores its own entry's files.** Git applies
    `files/.gitignore` to the `files/` tree it sits in, so an entry whose `.gitignore`
    lists `.env.*` can't commit its own `files/.env.example.tmpl`: it is silently missing
    from the repository while tests pass locally. The realistic fixture dropped that
    template for this reason. 1.5 should flag an entry whose shipped `.gitignore`
    matches one of its own files, and 1.6a should check for ignored files after porting;
    this is the in-repo counterpart of npm's packing gap that 0.2 owns.
  - **Extra human-output detail.** A row that hides lower copies says `shadows bundled`
    (or the origins it hides); a rejected entry's line is followed by its directory; an
    unknown key reads `unknown key`, with `(frontmatter keys are snake_case)` when it has
    a capital letter; and when no stack loaded but some entry was rejected, the `Next:`
    line points at the rejected entries instead of `doctor`.
  - **`EntryInvalid.details`** is `{ id, origin, reason, path? }` in 1.0; `line` is left
    for 1.1, which first has a line to report.
- 2026-10-26, from code review:
  - **`STACKS_REGISTRY_DIR` is untrusted.** A bundled root other than the shipped one
    gives `trusted: false`. Roots carry `overridden`, and `registry.ts::trustOf` takes the
    entry (without `trusted`) and its root, so 3.2a adds the digest lookup without a
    signature change. Config returns the variable as given; `registry.ts::bundledRoot`
    resolves it against `Host.cwd` for both `list` and `doctor`, and `scripts/dev.ts`
    resolves a relative value against the caller's directory (`INIT_CWD`, else `PWD`),
    since `bun run dev` runs from `packages/cli`. Set to anything but a directory, it is a
    warning on `list` and in `doctor`. `doctor`'s `found` now means "is a directory".
    The Trust model (point 2) and the Bundled registry row say so.
  - **Symlinks.** The entry walk is non-recursive `readDirectory` plus `lstat` per name: it
    descends only into real directories and stops at the first symlink, so a link to `/`
    or a `..` loop is rejected as `symlink` without reading anything behind it. `files`
    uses the same walk. Root rule: the project root and its `stacks/` and `fragments/`
    must be real directories (a symlinked one is skipped with a warning), because a
    checkout controls them; the user and bundled roots, and their `stacks/` and
    `fragments/`, may be symlinks (a dotfiles manager or a package install puts them
    there). An entry directory, and anything inside one, never may.
  - **Missing and unreadable are different.** A markdown file that doesn't exist is
    `EntryInvalid` with the new reason `missing` (roadmap Error tags row); one that exists
    but can't be read (or an unreadable entry directory) is listed as `<file> is
    unreadable` and `get` fails `PermissionDenied` with reason `read` and the path, since
    the next step is the human's (exit 6), not an edit to the entry.
  - **Control characters.** Every entry-derived field in human output and log messages
    goes through `core/text.ts::printable`, which escapes C0, C1 and DEL as `\u001b`;
    interpolated values in rejection messages (`kind`, ids) are JSON-quoted. JSON output
    is unchanged, since JSON escapes them already.
  - **YAML.** Frontmatter goes through `parseDocument` with `logLevel: "silent"`; any
    error or warning (an unknown `!tag`, a duplicate key) rejects the entry with its first
    line, and the library prints nothing to stderr.
  - **`Next:` lines suggest only trusted entries.** The plan said the first stack; `list`
    names the first trusted stack, and in the apps group `--with <app>` names the first
    trusted app that applies to a trusted stack. When stacks exist but none is trusted,
    the only line is `Next: stacks list --json`.
  - **Non-blank strings.** `name`, `description` and a step's `run` must hold a
    non-whitespace character (`id` and a step's `name` are kebab-case already).
  - **A rejected entry's directory** is printed whole on its own line, never wrapped.
  - **`Origin` and `Kind`** are declared once in `schemas/entry.ts`.
  - **Fixture guard.** `tests/registry.test.ts` fails when git ignores any file under the
    fixture registries or in `packages/cli/registry/` (the `.gitignore` finding above).
