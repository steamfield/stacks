# Phase 3.1a: `show` and the brief preview

Status: EXECUTED 2026-10-27 (`show` and `ShowReport`; `validate --brief` renders `new`'s
canonical brief, with findings, fingerprint and sizes on a human's stderr; reviewed once and fixed)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | `stacks show <id>` prints one stack or fragment's metadata, origin, trust, full guidance, shipped files and last recorded run; `stacks validate --brief <stack>` prints the exact brief an agent would get, with word counts against the D5 caps and the composition's fingerprint, without scaffolding anything |
| Traces to | Job 3: "When I've settled on a stack I rebuild often, I want to write it down once, including the agent tooling, so every new project starts where the last one ended." The stack author: "the only proof a stack works is an end-to-end agent run, and nothing tells them when their prose has gone stale." |
| Depends on | 1.5 (`validate`, its canonical render and the D5 checks), 2.0a (`fingerprint`, `composeFiles`), 2.0c (the file-backed ledger) |
| Blocks | 3.1b (`create --from` shows `show`'s report before copying an untrusted entry), 3.1c (`new --dry-run` reuses the in-memory composition path). 3.2a uses `show`'s report as its interim trust report (soft) |
| Decisions needed | D5 (proposed): the caps the preview prints against; a different budget changes only the numbers. D19 (proposed): `show` reports `trusted` as 1.0 computes it |
| Settles | What `show` prints and which entries get a last run; how the preview picks its agent and personal defaults |

## Scope

In:

- `stacks show <id> [--kind stack|fragment] [--json]`.
- `stacks validate [path] --brief <stack> [--with a,b] [--without c] [--sandbox] [--json]`.
- `ShowReport` and `PreviewResult` schemas.

Out:

- `create`, the `preset` setting and the authoring guide (3.1b).
- A "fragments this project could still add" hint in `show`. 3.0's `missingRequired` covers the required case; the optional case can follow if authors ask.
- Any change to shadowing. The user and project origins and their `shadows` marks are 1.0's; `show` only reports them.
- Any CI wiring. The existing `ci.yml` runs these tests unchanged (D23).

## Design

### Where this fits

This sub-phase gives authors and reviewers a way to read an entry and its composed brief without running `new`. 3.1b then adds the commands that write entries (`create`) and the guide that tells authors how; it uses `show`'s report when copying an untrusted entry. 3.2a reuses the same report for `stacks trust` until 3.2b's allowlist report replaces it. Both commands here are read-only: they compose in memory and start no process ([Trust model](../../roadmap.md#trust-model) point 1).

### `show`

Looks the id up with 1.0's `Registry.get`, in origin precedence order. Ids are unique within a kind; a stack and a fragment may share an id ([roadmap, Contracts: Entry and its listing](../../roadmap.md#types-and-schemas)). When both kinds hold the id, `--kind` picks one; without it, that is `BadInput` naming both. An app is a fragment with `category: app`, so `show <app>` needs no kind of its own and prints its category.

Human output:

```
Go CLI (go-cli), stack, origin bundled, trusted
A Go command-line tool with ...
Fragments: required none; default agent-ops, git-hooks, ci-github; optional goreleaser
Verify: install, build, lint, test, smoke, readme-filled
Brief: 2,980 words with defaults (cap 6,000; 9,000 with an app)
Last run: green 2026-11-02, same content
--- guidance ---
<body, every conditional branch>
```

`show --json` decodes against `ShowReport` (`src/schemas/show.ts`):

| Field | Value |
|---|---|
| `id`, `kind`, `name`, `description`, `tags`, `deps`, `tools`, `decisions`, `env`, `commands` | From the entry's meta |
| `origin`, `trusted`, `shadows`, `path` | From `Entry` ([roadmap, Contracts: Entry and its listing](../../roadmap.md#types-and-schemas)) |
| `fragments` | Stack only: `{ required, default, optional }` |
| `category`, `appliesTo`, `requires`, `conflicts`, `requiresTools`, `needsOwnRepo`, `fits` | Fragment only, camelCase like every CLI output (the YAML keys are `applies_to`, `requires_tools`, `needs_own_repo`). `fits` lists stack ids whose id or tags match `appliesTo` |
| `verify` | Every step as written, every field |
| `files` | Every shipped file with its source path and its output path (dotfile names as stored, `.tmpl` stripped, adapters labeled by agent) |
| `body` | Unfiltered: every conditional branch, markers kept, so an author or reviewer sees all of it |
| `bodyWords`, `bodyCap` | Numbers: `countWords` of the entry's body, and its per-entry cap from D5 |
| `briefWords`, `briefCap` | `briefWords` is a number, the same quantity it is everywhere ([roadmap, Contracts: Word count](../../roadmap.md#types-and-schemas)): `countWords` of the composed brief on 1.5's canonical render (stack with required and default fragments). `null` for a fragment. `briefCap` is the composed cap |
| `lastRun` | See below |

`show` is the human-readable review of an entry: it prints everything an agent would follow (body, `commands`, verify `run`s) and every file the entry would write. That is why 3.1b and 3.2a use it as a review before trust is granted.

### `lastRun`

The ledger ([Contracts: Ledger](../../roadmap.md#types-and-schemas)) records runs of bundled content only, so `lastRun` comes from it only for `origin: "bundled"` entries. Every other origin gets `lastRun: null`, including a user copy that shadows a bundled id: its content is not what the ledger ran.

For a bundled stack, `lastRun` is the newest `LedgerRecord` for that stack: `{ date, result, fingerprint, sameContent }`. `sameContent` is whether that record's fingerprint equals the fingerprint of the stack's default composition rendered now, through `composeFiles` and `fingerprint` with the record's agent and preset. For a bundled fragment, it is the newest record whose fragments include it, with that record's stack named, and `sameContent` compares against the same composition rendered now. A ledger with no matching record gives `null`.

`sameContent: false` means the CLI's bundled content changed since the recorded run, typically in a development checkout. 2.2's "changed since last green" note is the `validate` view of the same comparison; `show` does not duplicate its rules.

### The brief preview

`validate --brief <stack>` composes through 1.1's `compose` and renders through the same brief renderer `new` uses, on 1.5's canonical render context (project name, year and environment facts fixed), so output is reproducible and its word count matches what `validate` budgets.

It deliberately renders the stack, not the author's personal setup:

- Adapters target one agent: `Settings.agents[0]`, or `claude` when `agents` is unset. A brief with several adapter targets differs only in its adapter list, and an author reads one brief.
- `Settings.always` is ignored. The preview shows what anyone else running the stack gets; `--with` adds fragments explicitly.
- The preset comes from `--sandbox` only.
- An app comes in only through `--with <app>`, and then the preview is 1.1's split brief
  (base, then application), with the app's cap from 1.5.

Human output prints the brief to stdout and the size report to stderr. `--json` returns `PreviewResult`:

```json
{
  "stack": "go-cli",
  "preset": "sandbox",
  "fragments": ["agent-ops", "git-hooks", "ci-github"],
  "app": null,
  "briefWords": 2980,
  "fixedWords": 750,
  "limit": 6000,
  "warnings": [],
  "brief": "# Build example: Go CLI\n...",
  "fingerprint": "sha256:...",
  "findings": []
}
```

The fields up to `brief` are 1.5's `BriefPreview` as shipped; `limit` is 6,000, or 9,000
when `app` is set (1.5's `BUDGET`). This phase adds `fingerprint` and `findings`.

`findings` are 1.5's findings for the composed entries, with 1.5's severities ([Other shared facts: validate severities](../../roadmap.md#other-shared-facts)). Any `error` (a composed brief over the cap among them) exits 2 with `ValidationFailed`, which keeps its result, so stdout still holds the brief and the author can read what to cut.

### Failure modes

| Case | Result | Exit |
|---|---|---|
| `show` or `--brief` unknown id | `NotFound` with the nearest ids | 2 |
| Id is both a stack and a fragment, no `--kind` | `BadInput` | 2 |
| `--brief` names a fragment | `BadInput`; preview takes a stack | 2 |
| Entry fails to decode | `EntryInvalid` with the file and first schema issue | 2 |
| Composition conflict (`--with`) | `ComposeConflict` | 2 |
| Preview has an error finding | `ValidationFailed`, result kept | 2 |
| Ledger unreadable | `lastRun: null` and one warning on stderr; `show` still succeeds | 0 |

No new error tags.

### Decided here

| Question | Decision | Why |
|---|---|---|
| Which entries get `lastRun` | Bundled only | The ledger only records bundled content; any other match would be a false claim |
| Preview agent | `Settings.agents[0]` | One readable brief; the agent list only changes adapters |
| Preview and `always` | Ignored | An author previews the stack as others get it |
| `show` body | Unfiltered | The filtered view is the preview |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/commands/show.ts` | New thin handler |
| `packages/cli/src/core/show.ts` | Builds `ShowReport` from registry, composition and ledger |
| `packages/cli/src/schemas/show.ts` | `ShowReport`, `PreviewResult` |
| `packages/cli/src/commands/validate.ts` | `--brief`, `--with`, `--without`, `--sandbox` |
| `packages/cli/src/cli.ts` | Register `show` |
| `packages/cli/tests/show.test.ts`, `preview.test.ts` | New |
| `packages/cli/README.md`, `AGENTS.md` | Document both commands |

## Acceptance tests

Through `tests/helpers/cli.ts` with the fixture registry. The tests write a fixture `runs.json` in the bundled registry root with `tests/helpers/ledger.ts`, as `tests/list-ledger.test.ts` does; `readLedger(registryDir)` reads it and `lastRun(records, stack)` selects the latest default-composition run. `Host` carries no ledger.

1. `show <bundled-stack> --json` decodes against `ShowReport`, with `lastRun` from the fixture ledger and `sameContent: true`.
2. Editing the fixture bundled stack's body between two `show` runs flips `sameContent` to false.
3. A user-directory copy of the same id shows `origin: "user"`, `shadows: ["bundled"]` and `lastRun: null`; a project-origin entry shows `trusted: false` and `lastRun: null`.
4. A bundled fragment's `lastRun` names the stack of the newest record that included it.
5. `show` lists every shipped file with its output path, including a dotfile (stored literally) at the same output path and a `.tmpl` shown without the suffix.
6. `validate --brief <stack> --sandbox --json` returns the same brief text `new <stack> --sandbox --no-launch` writes to `BRIEF.md` when run under 1.5's canonical context (directory named as that context's project, TestClock at its year, `agents` unset), and the same `fingerprint` `new --json` records.
7. With `Settings.always: ["ci-github"]` and `agents: ["codex", "claude"]`, the preview contains no `ci-github` body and renders `codex` adapters only.
8. A fixture stack over the composed cap: exit 2, stdout holds the brief, the last stderr line is the `ValidationFailed` envelope.
9. Neither command starts a process: executable shims on `PATH` leave a marker if git, tools, agents or entry commands run, and no marker appears.

### Realistic edge cases

10. An id shared by a stack and fragment requires `--kind`; an app reports fragment metadata and matching stack ids, and a fragment passed to `--brief` is `BadInput`.
11. Unknown ids in both commands return `NotFound` with nearby ids in the single error envelope.
12. Wrong-case YAML metadata in a user copy is `EntryInvalid`, without falling back to a hidden bundled copy.
13. A symlink inside shipped files is rejected without exposing its target's contents.
14. A malformed ledger or a directory at `runs.json` yields a null last run and one warning, preserving the report.
15. Entry text and unusual file names survive JSON unchanged; preview resolves a relative symlinked registry with spaces from another working directory.
16. Agent markers, inherited git variables, a parent repository and personal invocation do not change canonical preview output; `--without` excludes a default fragment.
17. Preview findings cover exactly the selected entries, warnings alone succeed, and an explicitly added app gets the split brief and 9,000-word cap.
18. Text `show` exposes every guidance branch, command and verify run; text preview puts only the brief on stdout and human size counts on stderr, respecting the agent audience's omitted in-budget counts.
19. Both commands preserve existing files, broken git state and partial run history on success and failure.
20. Conflicting `--with` fragments return `ComposeConflict`, with no result or writes.

## Exit criteria

- Acceptance tests pass; `bun run check` is green from the repo root.
- `AGENTS.md` and the CLI README document `show` and `validate --brief`.

## What this plan may get wrong

- 2026-10-27: preview checks are scoped to the selected composition, preset and fragment flags, rendered per shipped adapter; registry-wide `compose-each` is excluded and only selected entries' sources are read.
- `show` composes to count words and compare fingerprints, so it is slower than `list`. If it is slow on large stacks, `briefWords` and `sameContent` can move behind a flag.
- The preview's equivalence with `new` depends on 1.5's canonical context fixing every environment fact the brief mentions (missing tools, git state). If it misses one, test 6 will show it and the context, not the preview, should be fixed.
- Authors with several agents may want to preview each. An override flag for the preview's adapter agent is a small addition if asked.
- 2026-10-26: this plan assumed a separate `app` kind (3.5a adding it to `--kind`) and dotfiles stored under an escape that `show` would undo. The amended D18 makes an app a fragment with `category: app`, so `--kind` stays `stack|fragment` and only a stack and a fragment can share an id; dotfiles are literal, so `show` prints them as stored. `ShowReport` gained `category` and `requiresTools`, which the fragment schema has.
- 2026-10-26 (found executing 1.5): a basic `validate --brief` landed in 1.5 (`src/core/validate/preview.ts::previewBrief`, `BriefPreview`). It prints the brief and its counts on stdout, exits 0 even over the limit, uses 1.1's default agents rather than `Settings.agents[0]`, and treats a `--brief` fragment id as an unknown stack (`NotFound`). This phase now adds the fingerprint, the findings, exit 2 over the limit, the sizes on stderr and the fragment `BadInput`, extending `BriefPreview` rather than adding `PreviewResult` beside it.
- 2026-10-27: `EntryInvalid.details` already has a closed reason/file contract; schema issue text remains in registry rejection data. This phase preserves those details rather than adding the first schema issue promised in the failure table.
- 2026-10-27: preview findings reuse the validator's selected-entry checks and selected composition, excluding load checks (composition already loaded successfully) and git checks (checkout-dependent and process-starting). Registry validation keeps its full check matrix.
- 2026-10-27: brief parity exposed two renderer details: the CLI's own metadata file listing must count as fixed text, and a body consisting only of a title must retain that guidance. The renderer also retains trailing spaces in guidance so preview prose is not truncated.
- 2026-10-27: two more legacy assertions expect preview summaries on stdout: `tests/validate.test.ts` (the comma-list preview) and `e2e/binary.test.ts` (the compiled preview). Both conflict with brief-only stdout and need a test-contract update in addition to the original count assertion. They remain unchanged pending scope authorization.
