# Phase 3.1b: `create` and the authoring guide

Status: EXECUTED 2026-10-27 (`create stack|fragment`, `--from bundled|project`, the preset
setting and `new --preset`, `docs/authoring.md`; the personal-stack trial is the maintainers')
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | A developer can start a stack or fragment in their user directory from a skeleton that passes `validate`, or copy an existing entry there to edit, set a default preset for every `new`, and follow a shipped authoring guide from a project they trust to a stack that has reached a green `verify` |
| Traces to | Job 3: "When I've settled on a stack I rebuild often, I want to write it down once, including the agent tooling, so every new project starts where the last one ended." Success row 5: "Stacks and fragments in `~/.stacks` and third-party sources, not only the bundled registry." The stack author: someone who wants "to distill it into something reusable, for themselves, their team, or strangers" |
| Depends on | 3.1a (`show`'s report and the preview the guide tells authors to use), 2.2 (the rot checks the guide teaches authors to pass; D8 as revised puts authoring after local proof) |
| Blocks | Nothing |
| Decisions needed | D8 (proposed, revised): if authoring were allowed before phase 2, the 2.2 dependency would drop and the guide would omit the rot checks. D18 (proposed): the skeleton is written against entry format v1; a different format changes the skeleton, not the commands. D19 (proposed): if project entries were trusted by default, `create --from project` would need no review |
| Settles | What `create` scaffolds; what `--from <origin>` means; the `preset` setting |

## Scope

In:

- `stacks create stack <id> [--from <origin>] [--yes] [--json]` and `create fragment <id> [--category <c>] [--from <origin>] [--yes] [--json]`.
- `Settings.preset` and a `--preset <default|sandbox>` flag on `new`.
- `packages/cli/docs/authoring.md`, shipped in the package and printed by `create`.

Out:

- `always`, `agents` and `author`: they already exist (1.1 adds them; 1.2a and 1.4 read them, per [roadmap, Other shared facts: Settings fields](../../roadmap.md#other-shared-facts)).
- `package_scope`. It is already part of entry format v1 (D18 as amended): `Settings.package_scope` is added by 1.1, `new --scope` sets it for one run, and 1.2a renders `{{package_scope}}`. `create` skeletons gain no scope field; the authoring guide says when a `.tmpl` file should use the variable.
- Copying an entry under a new id, and partial inheritance. `--from` copies whole entries under the same id.
- An interactive wizard; editing existing entries; publishing or sharing (3.2a, 4.0c).
- Any CI wiring (D23).

## Design

### Where this fits

3.1a gave authors read-only tools: `show` and the preview. This sub-phase adds the two writes an author needs, a skeleton and a working copy, plus the guide and one personal default. Nothing later depends on it. Copying an untrusted entry is the one trust-sensitive path, governed by [Trust model](../../roadmap.md#trust-model) point 3.

### `create`

Writes to the user origin, `$XDG_CONFIG_HOME/stacks/{stacks,fragments}/<id>/` (1.0's `Paths.user`), then prints the entry's path and the guide's path. Refuses when the target directory exists (`BadInput`). Executes nothing and makes no network call (point 1).

A stack skeleton:

- `STACK.md` with every v1 frontmatter field present, `id` and `kind` filled in, a `stacks:fill` placeholder for the description, one decision in the "(default: ...)" form, verify steps covering the D7 layers that call project commands (`make install`, `make lint`, `make typecheck`, `make test`) plus a `readme` step (`phase: check`, `layer: docs`) whose `run` fails while `README.md` is empty or still holds a `stacks:fill` marker (v1 has no built-in checks, so it is a short command), and body headings Layout, Setup, Conventions, Tool configuration, Testing, Commands, Gotchas, each with one line saying what goes there.
- `files/.gitignore` (dotfiles are stored literally; [Other shared facts: Entry directories](../../roadmap.md#other-shared-facts)) and `files/README.md` containing `stacks:fill`.

Frontmatter keys are written snake_case, as authors write them. A fragment skeleton has the fragment fields (`category`, `applies_to`, `requires`, `conflicts`, `requires_tools`, `needs_own_repo`, `merge`) and headings What to add, Tool configuration, Verify, AGENTS.md. `--category app` writes an app: a fragment with `category: app`, whose body headings follow the application half of 1.1's split brief. An app's `applies_to` must name a stack, which `create` can't guess, so a fresh app skeleton has that one error until the author fills it.

`validate` on a fresh skeleton reports zero errors and only `stacks:fill` findings; a test enforces it so the skeleton can't drift from the format.

### `--from <origin>`

One meaning everywhere: `create <kind> <id> --from <origin>` copies the `<kind>` entry `<id>` as it resolves within `<origin>` into the user directory under the same id, so the copy shadows the entry it was copied from (1.0's precedence) and the author edits a working copy instead of a skeleton.

| `<origin>` | Allowed | Notes |
|---|---|---|
| `bundled` | Yes | The common case: customize a shipped stack |
| `project` | Yes, under the rule below | Project-origin entries are untrusted (point 2) |
| `user` | No, `BadInput` | It is the target |
| `source`, `index` | When 3.2a and 4.0d add those origins | The same rule as `project` applies to any untrusted entry. 3.2a adds a way to name the source when several hold the id |

The copy is byte for byte, `files/` and `adapters/` included. A copied entry is user-origin and therefore trusted (point 2), which is why copying an untrusted one is gated:

- When the entry is untrusted and `AppConfig.agent` is not `"none"` or `Host.stdinIsTTY` is false, `create` refuses with `PermissionDenied` (`details.reason` `agent` or `no-tty`) and writes nothing. Point 3 names the agent test; the TTY half is point 4's, because copying confers trust.
- Otherwise `create` first prints the trust report for the entry on stderr, then asks for confirmation; `--yes` skips the question but not the trust report. Until 3.2b lands, the trust report is `show`'s full human output (3.1a: body, `commands`, every verify step, every shipped file with its output path). 3.2b replaces it with its allowlist trust report (point 6) through the same call site.

### `preset`

`schemas/config.ts::Settings` gains one field, `preset: Schema.optional(Schema.Literals(["default", "sandbox"]))`. `Settings` keeps rejecting excess properties, so a typo fails loudly and `doctor` reports it.

`new` takes the preset from, highest first: `--preset`, `--sandbox` (same as `--preset sandbox`), `Settings.preset`, then `"default"`. `--preset default` is how a user with `preset: "sandbox"` gets a default build for one run. `--sandbox` together with `--preset default` is `Usage`, exit 2: every flag contradiction on `new` and `add` fails `Usage`, the rule 1.4 sets for `--launch` and `--no-launch`. `add` (3.0) never reads it; it uses the manifest's preset. The preview (3.1a) ignores it.

### The authoring guide

`packages/cli/docs/authoring.md`, listed in the package `files`. Written for an author starting from a project they trust. It covers:

- Sorting a project into frontmatter, prose and `files/`, and the rule that anything that would be wrong after the next major release goes in prose, with the three forms a stale fact can take instead: the durable rule, a discovery step, or a verify step that asks the tool.
- Setup as numbered steps that run generators non-interactively into a subdirectory.
- Verify steps that call project commands and cover the D7 layers; a `serve` step with `expect: { http, within }` for a dev server; a short command for a file check, since v1 has no built-in check kinds.
- The format details authors trip on: snake_case frontmatter keys, literal dotfiles under `files/`, `{{package_scope}}` and the other fixed template variables in `.tmpl` files, and `stacks:when` / `stacks:end` markers for conditional prose.
- Every decision stating its default; when something is a fragment.
- Staying within the D5 budget with `validate --brief`: move shared material to an optional fragment, reference material into a shipped doc the body points to, and cut what the agent would do anyway.
- What 2.2's rot checks flag and how to fix each.
- Running one sandbox build and reading `.stacks/NOTES.md`.
- `--from` and when a fragment is the better answer than a near-copy.

It is the companion to 1.0's format reference, not a copy of it.

### Failure modes

| Case | Result | Exit |
|---|---|---|
| Target exists | `BadInput` | 2 |
| `--from` unknown id in that origin | `NotFound` | 2 |
| `--from user` | `BadInput` | 2 |
| `--from` an untrusted entry under an agent or without a TTY | `PermissionDenied` | 6 |
| Confirmation declined | `BadInput`, nothing written | 2 |
| User directory not writable | `PermissionDenied` | 6 |
| `--sandbox` with `--preset default` | `Usage` | 2 |
| `config.json` has an unknown key | `InvalidConfig` for commands that read settings; `doctor` reports it | 3 |

No new error tags.

### Decided here

| Question | Decision | Why |
|---|---|---|
| `--from` value | An origin; the id is the positional argument | One meaning; the copy shadows by id |
| Copying under a new id | Not supported | `id` must equal the directory name; renaming a copy is two edits the guide describes |
| Preset precedence | Flag, then setting, then `"default"` | Flags always win for one run |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/commands/create.ts` | New handler |
| `packages/cli/src/core/create.ts` | Skeleton writer, copy, trust gate |
| `packages/cli/src/schemas/config.ts` | `preset` |
| `packages/cli/src/commands/new.ts` | `--preset`, preset precedence |
| `packages/cli/docs/authoring.md` | New shipped guide; `package.json` `files` updated |
| `packages/cli/src/cli.ts` | Register `create` |
| `packages/cli/tests/create.test.ts`, `config.test.ts` | New and extended |
| `packages/cli/README.md`, `AGENTS.md` | Document `create`, `--from`, `preset` |

## Acceptance tests

1. `create stack my-api`, then `validate <userdir>/stacks/my-api --json`: the exact finding set is empty (measured against the reference skeleton with the current validator, 2026-10-27: fill markers produce no finding). Same for `create fragment my-ci`. `create fragment my-app --category app` gives exactly one error, the empty `applies_to`, and after `applies_to` names a stack, zero.
2. `create stack go-cli --from bundled` copies the entry byte for byte; `list --json` then shows `go-cli` with `origin: "user"` and `shadows: ["bundled"]`; `new go-cli` uses the copy (a marker sentence added to its body appears in the brief).
3. `create stack x --from project` with `CLAUDECODE=1` exits 6 and writes nothing; with `stdinIsTTY: false` and no marker, exits 6; with a TTY, no marker and `--yes`, stderr holds the trust report and the copy exists and is trusted.
4. `create stack x --from user` exits 2.
5. `Settings.preset: "sandbox"`: `new` records `preset: "sandbox"`; `new --preset default` records `"default"`; `--sandbox --preset default` exits 2 with the `Usage` tag in the envelope.
6. `config.json` with an unknown key: `new` exits 3; `doctor` exits 0 and lists the config error.
7. `create` starts no process and makes no network call (2026-10-27: no recording `Processes` layer exists; git and common-tool shims on PATH leave no execution marker, and the HTTP boundary observes no request).
8. `packages/cli/docs/authoring.md` exists, and every command and flag it shows exists in the real command tree, as the skill test checks its commands. The packed-tarball assertion returns with 0.2 (maintainers, 2026-10-27).

### Realistic edge cases

9. An existing empty directory, partial scaffold or regular file at the target is `BadInput`, with its bytes preserved.
10. Ids containing traversal, uppercase, whitespace, non-ASCII or control characters are `BadInput` and create nothing.
11. A symlinked dotfiles user root works with paths containing spaces, a leading dash and non-ASCII, from a different cwd inside a real repository; exported git repository variables do not redirect the write.
12. File, directory and looping symlinks inside a copy source are `EntryInvalid`; no partial target or outside changes remain.
13. An unwritable destination is `PermissionDenied` and preserves existing siblings.
14. `--from` selects only the named origin despite higher-precedence entries; a missing id in that origin is `NotFound` without fallback.
15. Every accepted category is written as requested; wrong-case and unknown categories are `Usage` and write nothing.
16. A symlink at the target is `BadInput`; neither the link nor its destination is changed.
17. An unreadable source file is `PermissionDenied`, leaves no partial copy and preserves existing entries.
18. Interruption before filesystem I/O and after one, two or three output files exist for a skeleton or copy (bulk copies may expose them together) rolls back only that invocation's files and empty directories, after deterministically blocking at the filesystem boundary (including bulk copies and file handles).
19. Explicit sandbox, the compatible sandbox aliases, and the absent-setting default obey preset precedence in result, manifest, fragment selection, production-step skipping and decision instructions.
20. Wrong-case, unknown, null and numeric preset settings fail `new` with `InvalidConfig`; `doctor` reports them without failing.
21. `validate --brief` ignores a configured sandbox preset and uses its own default.

## Exit criteria

- Acceptance tests pass; `bun run check` is green from the repo root.
- One maintainer writes a personal stack from a project they trust using only `create`, the guide and the preview, takes it to a green `verify`, and records in a run note in [plans/runs/](../../runs/README.md) where the guide fell short.
- `AGENTS.md` and the CLI README document `create`, `--from` and `preset`.

## What this plan may get wrong

- Authors may want inheritance ("go-cli but with my lint rules") more than whole copies. If personal stacks turn out to be near-copies, the guide should push fragments harder; real inheritance is a format change.
- The skeleton's verify steps assume Make-style project commands. Stacks with package scripts will rewrite them every time; a `--scripts` flag may earn its place.
- The interim review before 3.2b is `show`'s plain output. It lists everything but marks nothing; a person may skim it. 3.2b's allowlist marks are the fix, and project-entry copies are rare enough to wait.
- 2026-10-26: this plan wrote camelCase skeleton keys, a `_dot_gitignore` file, a built-in `filled` check, and left `packageScope` to D28 and 3.3a. The amended D18 made keys snake_case, dotfiles literal, dropped built-in checks (the skeleton's README step is a command) and put `package_scope` in v1, so nothing about it is built here or in 3.3a. Apps became fragments with `category: app`, so `create` gets no `app` subcommand, only `--category app`, whose skeleton can't pass `validate` until the author names a stack.
- 2026-10-27: no packed tarball exists until 0.2 (maintainers). Acceptance item 8 checks the package-local authoring guide and its real command/flag references now; restore the packed-tarball assertion when 0.2 lands. The current validator accepts fill markers without emitting findings; the reference skeleton declares its Make commands and the `make` tag to avoid 2.2 rot warnings.

- 2026-10-27 implementation: no package `files` allowlist or shipped bench command exists yet. The guide is package-local and documents a local bench using `new`, `verify` and `runs`; package/tarball publication remains 0.2. Preview resolves its preset directly from its own sandbox flag and deliberately ignores `Settings.preset`, so it does not share new's settings precedence.
