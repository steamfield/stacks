# Phase 3.4c: The agent skill

Status: EXECUTED 2026-10-27 (`skill/SKILL.md`, `skill install`, `doctor`'s skill check;
reviewed once and fixed). The tarball's `files` entry waits for 0.2; the compiled binary finds
the skill beside it
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | The npm package ships one agent skill, `skill/SKILL.md`, that tells a coding agent when to reach for stacks and how to run the loop without help, and `stacks skill install` puts it where Claude Code finds it, so "ask your agent to start a project" works in a session that has never seen stacks |
| Traces to | Assumption "Handoff to whatever agent is on PATH is the right entry point ... Watch whether people use `new` from a terminal or ask their agent to run it" (D9 makes asking the agent an equal entry point); the coding agent's frustration with "ambiguity"; "Success is reaching a green `verify` without asking the user anything the brief could have answered" |
| Depends on | [1.1](phase-1.1-composition-and-brief-2026-10-30.md) (the brief's rules the skill repeats, `countWords`), [1.4](phase-1.4-handoff-and-entry-points-2026-10-30.md) (the no-argument guide's loop and rules, `Host.invocation`), [1.6c](phase-1.6c-first-release-2026-10-30.md) (the published package the skill ships in; it reaches users in the next release) |
| Blocks | [3.4b](phase-3.4b-native-agent-adapters-2026-10-30.md)'s plugin marketplace listing, which lists this skill |
| Decisions needed | D9 (both entry points). D14 shapes one rule in the skill ([open question 24](../../risks-and-open-questions.md#open-questions-for-the-maintainers)); if the maintainers choose "warn", that rule changes to "a changed-steps warning means stop and tell the user" and nothing else here moves |
| Settles | Where the skill lives in the package, its content and budget, the `skill install` command and its targets |

## Where this fits

1.4's no-argument guide reaches an agent that already decided to run `stacks`. The
skill reaches one earlier: a user says "start me a blog with tests" and the agent, which
has never heard of stacks, needs to know the CLI exists, when it fits, and that the
brief is the task. Claude Code loads skills from `.claude/skills/<name>/SKILL.md` in a
project and `~/.claude/skills/<name>/SKILL.md` for a user, choosing one by its
`description`. The skill text is fixed CLI text, like the brief's `text.ts` and the
guide's `guide.ts`; it reads no entry and runs nothing (Trust model point 1).

## Scope

In:

- `packages/cli/skill/SKILL.md`, shipped in the package next to `registry/`.
- `stacks skill install [--project] [--force] [--print] [--json]`.
- Tests that render the skill, budget it, and check every command it names against the
  real command tree.
- Packing: `skill/` added to the package `files` list and to 0.2's tarball file-list
  assertion (0.2 asserts only `dist/` and `registry/` until this lands).

Out:

- A plugin marketplace listing or plugin bundle for the skill (3.4b, with the other
  agents' native adapters).
- Skill formats for agents other than Claude Code. They read `AGENTS.md`, and 3.4b adds
  their native files. `skill install` takes no per-agent flag.
- Installing the skill from `new`. A user who wants it asks for it; `new` writes only into
  the project.

## Design

### Location and lookup

The skill is one file at `packages/cli/skill/SKILL.md`, found at runtime the way 0.2
finds the registry: `bin.ts` resolves `fileURLToPath(new URL("../skill/", import.meta.url))`
and passes it as `Host.skill` (roadmap, Contracts: Bundled registry in the repo, extended
to a second asset directory). Core code never computes the path. `doctor` reports
`skill: { path, found }` beside `registry`.

### Content

YAML frontmatter with `name: stacks` and a `description` under 1,024 characters that
says when to use it: starting a new project, setting up tests, lint, CI and agent config
in a new repo, or when the user mentions stacks or a stack. Then the body, in this
order:

1. **When to use it.** A new project from nothing, or a user asking for "a project set
   up properly". For an existing repo, `<cli> add <fragment>` when the installed CLI has
   `add` (3.0); if this lands before 3.0, the skill says stacks doesn't handle
   existing repos yet, and 3.0 updates that line.
2. **How to run it.** `stacks` if it is on PATH, otherwise
   `npx -y stacks@latest`. After `new`, use exactly the command the brief uses for
   `verify`, which is the same version that wrote the project.
3. **Pick a stack.** Run `<cli> list --json`. Pick the stack whose `description` and
   `tags` match the request; tell the user which one and why in one sentence, and name a
   close second when there is one. Never pick an entry marked `trusted: false` unless the
   user named it, and if they did, confirm with them before going on (Trust model
   point 3). If nothing fits, say so instead of forcing one.
4. **Start it.** `<cli> new <stack> <dir> --json` (add `--sandbox` when the user wants
   the fastest path to something running). Read `.stacks/BRIEF.md`. It is the whole
   task; follow it in order, and ask the user only what it tells you to ask.
5. **Loop to green.** Run `<cli> verify` from the project root with your longest shell
   timeout. On failure, fix the code or config the failing step exercises, never the
   step. Done is exit 0 with outcome `green`.
6. **Never weaken verify.** Don't edit `.stacks/manifest.json`; don't make commands
   pass without doing their job. If verify fails with `VerifyChanged`, stop: don't edit
   the steps back and forth, and don't run `verify --accept-changes` (it refuses agents).
   Tell the user what changed and that only they can accept it, from their own terminal,
   or undo it. This is the same rule as the brief's (1.1).
7. **Finish.** Follow the brief's after-green list, then summarize for the user: the
   stack and why, the decisions taken with their defaults, anything left undone, and
   where the brief's problems were noted (`.stacks/NOTES.md`).

The command forms are the same as the guide's (1.4) and the brief's (1.1). One unit test
checks the skill names the same subcommands and flags as the guide, so the three can't
drift apart.

Budget: the body is at most 600 words by `countWords` (1.1), a constant `SKILL_WORDS` in
`src/core/skill.ts` with the reason beside it: a skill is loaded whole whenever it
triggers, so it pays for itself only when it is short. 1.5's `validate` doesn't check
it; it isn't an entry. The skill's own test does.

### `skill install`

| Flag | Effect |
|---|---|
| none | Write to `$HOME/.claude/skills/stacks/SKILL.md` (Claude Code's user skills directory) |
| `--project` | Write to `.claude/skills/stacks/SKILL.md` under the git toplevel of `Host.cwd`, or `Host.cwd` when it isn't in a repo |
| `--force` | Overwrite a target whose content differs |
| `--print` | Write the skill to stdout and touch nothing (the documented copy path for any other location) |
| `--json` | `{ path, action: "written" \| "unchanged" \| "printed", text? }`; `text` holds the skill only for `--print`, and `path` is then `null`, so stdout stays one result |

The target directory is created when missing. A target with identical bytes is
`unchanged`, exit 0. A target with different bytes and no `--force` fails `TargetNotEmpty`
(1.2a's tag, `details: { path, entries: ["SKILL.md"] }`) with a human hint to rerun with
`--force` or `--print`, so a user's edited copy is never replaced silently. Writes use
1.2a's safe writer rooted at the skills directory, so a symlinked `stacks/` can't
redirect the write. An unwritable target is `PermissionDenied`, exit 6.

Installing is allowed under a detected agent: the content is the CLI's own fixed text,
not an entry, so it carries no trust decision (Trust model points 1 and 4 are about entry
content and confirmations). The README's quick start shows both ways in: run
`npx stacks new` yourself, or run `npx stacks skill install` once and ask your
agent.

### Failure modes

| Case | Error tag | Exit | What the caller sees |
|---|---|---|---|
| Target exists with different content | `TargetNotEmpty` | 2 | `details: { path, entries }`; hint names `--force` and `--print` |
| Target unwritable, or `$HOME` missing | `PermissionDenied` | 6 | `details: { path }` |
| `Host.skill` not found (broken install) | `NotFound` | 2 | `details: { path }`; `doctor` shows `skill.found: false` |
| A symlinked target directory resolves outside the skills root | `PermissionDenied` | 6 | `details: { path }`; nothing written |

No new error tag.

## Files and areas touched

| Path (under `packages/cli/`) | Change |
|---|---|
| `skill/SKILL.md` | The skill |
| `src/core/skill.ts` | `SKILL_WORDS`, install targets, the compare-then-write |
| `src/commands/skill.ts`, `src/cli.ts` | `skill install` subcommand |
| `src/bin.ts`, `src/services/host.ts` | `Host.skill` |
| `src/core/doctor.ts`, `src/schemas/` (doctor report) | `skill: { path, found }` |
| `package.json` | `files` gains `skill` |
| `tests/skill.test.ts` | New |
| `e2e/` (0.2's packed-tarball test) | The tarball contains `package/skill/SKILL.md` |
| `README.md` (package and repo) | The two ways in |

## Acceptance tests

Through `tests/helpers/cli.ts::runCli` with temporary HOME and XDG directories.

1. The skill's frontmatter decodes with exactly `name` and `description`, `name` is
   `stacks`, and `description` is under 1,024 characters.
2. `countWords` of the body is at most `SKILL_WORDS`.
3. Every `stacks <subcommand>` and `<cli> <subcommand> [--flag]` named in the body
   parses against the real command tree (each is run with `--help` through `runCli` and
   exits 0), and every flag it names is a flag of that subcommand. Renaming a flag in
   a later sub-phase without updating the skill fails this test.
4. The body contains the `VerifyChanged` rule (stop, don't edit steps, don't run
   `--accept-changes`, tell the user), the untrusted-entry rule, "the brief is the task",
   and the after-green summary; the guide (1.4) and the skill name
   the same subcommands.
5. `skill install` into an empty temp HOME writes the file byte-identical to
   `skill/SKILL.md`, `action: "written"`; a second run is `unchanged`; after editing the
   installed file, a third run fails `TargetNotEmpty` exit 2 and leaves the edit; with
   `--force` it is replaced.
6. `--project` inside a temp git repo's subdirectory writes under the repo's toplevel;
   outside a repo, under `Host.cwd`.
7. `--print` writes the skill to stdout and creates nothing; with `--json`, stdout is one
   result with `action: "printed"`, `path: null` and the skill in `text`.
8. A symlinked `~/.claude/skills/stacks` pointing outside the skills root fails
   `PermissionDenied` and writes nothing outside it; an unwritable target (mode 000,
   skipped as root) exits 6.
9. With `Host.skill` pointing at a missing directory, `skill install` fails `NotFound` and
   `doctor --json` reports `skill.found: false`.
10. Bun e2e: `bun run build` produces `packages/cli/dist/stacks`; the compiled
    binary finds `skill/` beside `dist/`, as it finds the bundled registry, and
    `./dist/stacks skill install --print` prints it, including after relocation.

### Realistic edge cases

11. Installation is allowed under a detected agent, with or without a terminal on stdout.
12. `--project` handles spaces, leading dashes and non-ASCII path names through a symlinked cwd.
13. `--force` refuses a final `SKILL.md` symlink outside the skills root without changing its referent.
14. A dotfiles symlink above the skills root is supported; installation stays under that root's real path.
15. A directory occupying `SKILL.md` fails `TargetNotEmpty`, even with `--force`, preserving its contents.
16. Inherited `GIT_DIR` and `GIT_WORK_TREE` cannot redirect `--project` to another repository.
17. Missing `HOME` refuses a user install with `PermissionDenied`, without falling back to another home.
18. `--print` bypasses HOME and target lookup, even with `--project --force` and a blocked target path.
19. A partial earlier install with unrelated files fills only `SKILL.md` and preserves those files.

## Exit criteria

- All tests pass; `bun run check` green from the repo root.
- The package README documents `skill install` and the two entry points.
- The HANDOFF notes that the skill ships in the next release.

## What this plan may get wrong

- 2026-10-27: The safe writer's `replace` only replaces files it created in the same
  scope. Forced skill installs instead stage a fresh file through that writer and rename
  it over the checked regular target, preserving the existing copy if staging fails.
  This retains the writer's documented path-based race limitation; it cannot provide
  `openat` guarantees against another process swapping directories during a write.
- 2026-10-27: `NotFoundDetails` requires `suggestions` and has no `path`; the skill
  adds optional `path` and retains `suggestions: []`. Permission failures keep the
  existing required `reason` alongside `path`. `TargetNotEmptyDetails` adds optional
  `blocker: "non-file"` for directory blockers so text output doesn't suggest a forced
  replacement that cannot work. No error tag changes.
- 2026-10-27: Checked the personal/project skill locations and `name`/`description`
  frontmatter against [Claude Code's skill docs](https://code.claude.com/docs/en/skills).

- 2026-10-27: Phase 0.2 and npm publication are deferred; work uses the dev build, so
  acceptance test 10 checks the compiled binary's adjacent skill lookup instead of a
  packed tarball. Packaging assertions wait for 0.2, and so does the package `files`
  list: the package has none yet, and 0.2 adds it with `skill` beside `dist` and
  `registry`.

- Claude Code's skill locations and frontmatter fields are assumed from its current docs.
  Check them when this is built; the install targets are one table in `skill.ts`.
- A skill that triggers too eagerly (on any "set up a project" request in an existing
  repo) annoys users more than it helps. The description names new projects only; 2.0b's
  bench can't test triggering, so watch for complaints after release.
- Repeating the brief's rules in the skill risks two wordings drifting. Acceptance test 4
  checks the rules are present, not that they read the same; if they drift, generate the
  skill's rule lines from `text.ts`.
- `npx -y stacks@latest` in the skill means an agent may run a newer CLI than the
  user installed. That is the point for a first run; after `new`, the brief's exact
  command takes over.
