# Build: CLI readability refactor

Started: 2026-11-15 12:42 CST. Timebox: none. Landing branch: `refactor/cli-readability` (worktree `.claude/worktrees/cli-readability`), merged locally to `main` at the end, not pushed.
Gate: `rr check` from the landing worktree (about 30 s), then the behavior harness (below). Filtered tests: `bun run test:unit tests/<file>.test.ts` in `packages/cli`. Typecheck: `bun run typecheck` in `packages/cli`. Lint: `bun run lint` at the repo root.
Worktree setup: `bun install --frozen-lockfile` at the worktree root (must not change `bun.lock`).
Behavior harness: `$H/run.sh <worktree>/packages/cli <out dir>` after `bun run build` in `packages/cli`, then `diff -r $H/base <out dir>`, where `$H` is the session scratchpad's `harness/` directory (path given in each lane prompt). `base/` is the normalized output of 89 commands (help, list, show, search, schema, validate, new, add, verify, runs, create and 13 failure cases in agent, `--json` and human audiences) captured from `main` at 8a76a946; two baseline runs matched exactly.
Scaffold commits: phase 1 (this file).

## Spec

A pure readability refactor of `packages/cli/src`: simpler logic and JSDoc where intent isn't obvious, so a developer new to the codebase can follow it. The CLI's behavior must not change at all.

In scope: every file under `packages/cli/src/`.
Out of scope: `packages/cli/scripts/`, `tests/`, `e2e/`, `registry/`, `packages/format`, `packages/mcp`, AGENTS.md, behavior changes of any size, new features or options.
Assumptions (user can override): lanes are `ce:builder` agents on opus rather than Codex delegates (the user chose the build skill); `errors.ts` is done inline by the orchestrator; no timebox.
Error model: unchanged. Every typed failure, its tag, message, `details`, exit code and the place it is raised stay as they are.

### Ground rules (every lane)

Behavior is frozen:
- No change to any string a user, agent or test can see: messages, help and description text, brief text, `Next:` lines, JSON keys, log record fields. Brief and fingerprint digests are pinned by tests, so a text change goes red.
- No change to ordering: sort comparators stay as written (`<` comparisons are not swapped for `localeCompare`), and Set/Map iteration order is preserved.
- No change to Effect error semantics: which filesystem reasons count as absent versus `PermissionDenied`, where `mapError`/`catch` sit, defect versus failure, finalizer and rollback order, interruption handling, what runs concurrently.
- Exported symbols keep their names, signatures and modules (AGENTS.md cites them as `file::symbol`, tests import them, and lanes depend on each other's exports). Non-exported helpers may be renamed, split, merged or moved. A file over about 400 lines may be split into a sibling module in the same directory that holds internal helpers; every existing export stays exported from its current file.
- Tests are read-only for lanes.

What to do:
- Split long `Effect.gen` bodies and functions into named steps (AGENTS.md "Code structure"); flatten nesting with early returns; replace clever one-liners with plain code; lift inline helpers that don't close over state to module level; remove dead locals and redundant wrappers.
- JSDoc only where warranted: a one-to-three-line module header saying what the file owns, and `/** */` on exports or steps whose purpose, invariant or reason isn't obvious from the name and types. Cite trust-model points from `.claude/rules/architecture.md` by number where code enforces one. No comments restating the signature, no type braces in JSDoc. Typed failures live in the Effect error channel, so name a failure tag in a doc comment only when the reason it's raised isn't obvious. Turn cryptic references (design ids such as "(D4)", "see above") into plain sentences.
- `Effect.fn("module.name")` only for functions being rewritten anyway.
- Repo rules apply: Biome limits (cognitive complexity 15, at most four parameters), no `as` casts or `!`, no new dependencies, `.claude/rules/typescript.md`, `.claude/rules/cli/effect.md`.

### Test failures as findings

A good test survives a behavior-preserving refactor, so a test that goes red is a finding. If the harness diff is non-empty, or the test pins observable behavior (exit code, streams, decoded `--json`, files on disk, an exported function's result), the refactor changed behavior: fix the code. If the harness is clean and the test fails only because it pinned an internal (a private helper's shape, an intermediate structure, unobservable call order), the lane keeps the refactor, leaves the test untouched and reports file, test name and the internal it pinned. The orchestrator rewrites such tests at landing to assert the same behavior through `runCli` or the public function, revert-verifies each, and commits them separately as `test(cli): ...`. Weakening or deleting an assertion is never the fix. Lanes also report tests that pass only because an internal is exported.

## Contracts (scaffold commit)

No new types or stubs: the contracts are the existing exports, which are frozen. Layout stays as AGENTS.md "Architecture map" describes it. The scaffold commit is this plan.

## Phases

Each phase lands when its lanes merge, `rr check` is green and the harness diff is empty. Demo for every phase: `diff -r $H/base <phase output>` prints nothing, and `git diff phase-(N-1)..phase-N --stat` shows the area refactored. Lane briefs are the shared brief below plus the lane's row; every lane is opus, because keeping behavior identical depends on invariants (ordering, error mapping, finalizers) the tests only partly cover.

### Shared lane brief

- Goal: make the owned files as easy to follow as possible without changing behavior, following "Ground rules" above.
- Interface: every export of the owned files keeps its name, signature and module.
- Behavior: identical. The checks are the owned files' tests, lint, typecheck and the behavior harness.
- Out of scope: other lanes' files, tests, AGENTS.md, any user-visible change, new options or abstractions with one caller.
- Done when: (1) every test file that imports an owned module passes, found with `grep -rlE "src/(<owned paths as a regex>)" packages/cli/tests` and run with `bun run test:unit <files>` in `packages/cli`, or reported as brittle per "Test failures as findings"; (2) `bun run lint` at the root and `bun run typecheck` in `packages/cli` pass; (3) after `bun run build` in `packages/cli`, the harness diff against `base/` is empty; (4) committed on the lane branch as `refactor(cli): <area> readability`.

### Phase 1: the add and new path (calibration)

| Lane | Size | Owns files | Lines |
| --- | --- | --- | --- |
| a | SM | `core/add.ts`, `core/add/` | 844 |
| b | SM | `commands/add.ts`, `commands/handoff.ts`, `commands/new.ts`, `commands/telemetry-hooks.ts` | 762 |
| c | SM | `core/scaffold/` | 1,065 |
| d | SM | `core/handoff.ts`, `core/prompting.ts`, `core/create.ts`, `core/create-text.ts` | 815 |

Lane notes. a: `core/add/plan.ts::planAdd` is one 110-line generator with closures pushing into shared arrays; split it into named steps (walk incoming, reserve paths, classify, park) and replace "(D4)" with the reason. b: `commands/add.ts` wraps `Registry` in a needless `Effect.gen`; `commands/handoff.ts` is 370 lines. c: `scaffold/write.ts::openProject` owns rollback; finalizer order and the paths `rollbackIncomplete` records must not change. d: `core/handoff.ts::decideHandoff` is first-matching-rule-wins and enforces trust points 3 and 4; rule order is behavior.

### Phase 2: project state, verify, submit, the other commands

| Lane | Owns files | Lines |
| --- | --- | --- |
| a | `core/verify/` | 1,140 |
| b | `core/submit/` | 1,021 |
| c | `core/update/`, `core/project-state.ts`, `core/manifest.ts`, `core/replace-file.ts`, `core/runs.ts`, `core/ledger.ts`, `core/canonical-json.ts` | 985 |
| d | `cli.ts` and the remaining `commands/*.ts` (create, doctor, guide, list, root, runs, schema, search, show, skill, submit, telemetry, update, validate, verify) | 1,366 |

### Phase 3: registry and composition

| Lane | Owns files | Lines |
| --- | --- | --- |
| a | `core/registry/` | 1,101 |
| b | `core/compose/` | 1,270 |
| c | `core/brief/` | 979 |
| d | `core/search/`, `core/fingerprint.ts`, `core/template.ts`, `core/slug.ts`, `core/text.ts`, `core/suggest.ts`, `core/shell.ts` | 861 |

### Phase 4: validate

| Lane | Owns files (`core/validate/`) | Lines |
| --- | --- | --- |
| a | `index.ts`, `types.ts`, `view.ts`, `sources.ts`, `report.ts`, `format.ts`, `references.ts`, `reference-issue.ts`, `headings.ts`, `templates.ts`, `target.ts`, `git.ts` | 976 |
| b | `compositions.ts`, `composed.ts`, `add-compositions.ts`, `compose-each.ts`, `budget.ts`, `preview.ts`, `snapshot.ts` | 1,223 |
| c | `files.ts`, `shipped-refs.ts`, `native-config.ts`, `native-refs.ts`, `imports.ts`, `conditionals.ts`, `conditionals-reach.ts`, `commands.ts`, `patterns.ts` | 1,295 |
| d | `search.ts`, `search-examples.ts`, `deps.ts`, `ledger-notes.ts`, `dated.ts`, `version-sensitive.ts`, `submission.ts`, `authors.ts`, `verify-notes.ts` | 1,150 |

### Phase 5: entry, services, telemetry, schemas

| Lane | Owns files | Lines |
| --- | --- | --- |
| a | `main.ts`, `bin.ts`, `runtime.ts`, `logging.ts`, `invocation.ts`, `version.ts`, `project-layout.ts`, `config.ts` | 1,027 |
| b | `services/`, `platform/` | 1,257 |
| c | `telemetry/` | 1,123 |
| d | `schemas/`, `core/result-schemas.ts`, `core/doctor.ts`, `core/guide.ts` | 1,093 |

### Phase 6: show, list, remote data, the rest

| Lane | Owns files | Lines |
| --- | --- | --- |
| a | `core/show.ts`, `core/show-report.ts`, `core/list.ts`, `core/list-report.ts` | 932 |
| b | `core/remote-index.ts`, `core/remote-index/`, `core/cached-fetch.ts`, `core/allowlist.ts`, `core/stats.ts`, `core/stats-cache.ts`, `core/stats-text.ts` | 783 |
| c | `core/deps.ts`, `core/deps/`, `core/skill.ts`, `core/shown-path.ts`, `core/wrap.ts` | 598 |
| inline | `errors.ts` (orchestrator) | 1,161 |

Sizing check: lanes run 598 to 1,366 lines; the skill's four-file cap is stretched on purpose, since a readability pass over one directory is one capability and splitting further would multiply merge overhead for ~25k lines.

## Log

