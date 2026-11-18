# RFC: CLI structure and readability, second pass

Status: DRAFT 2026-11-17, revised after one devil's-advocate review (log at the end). Scope: `packages/cli/src` and what imports it. Behavior change: none.

## Summary

The CLI is about 31,600 lines in 215 files, and it is hard to follow. Effect's verbosity is a small part of that. Most of it comes from how the code is arranged:

- A value is set far from where it is used, and passed through several layers to get there.
- One rule is written in several places.
- Shared code lives in folders named after one command.
- Prose explains the same flows again and again.

It took the maintainer a long time to find where the hosted API URL is set. The index URL and the telemetry URL are set in the same file and reach their users by different routes:

- the API URL, through `Build` into `AppConfig`;
- the index URL, as a `RemoteIndex.layer` argument;
- the telemetry URL, as `main`'s third positional argument.

The same pattern shows up elsewhere. Tracing the output audience back to its sources takes 7 hops, the exit status 5 hops from 6 independent sources, whether an index entry is trusted 6, and where the handoff decision is written into the manifest 7.

This RFC proposes a second pass that changes structure: where values come from, which file owns which rule, the folder layout, and how much the comments say. Behavior stays identical. It is checked three ways: a test suite brought closer to behavior-driven before any refactor starts, a behavior snapshot harness, and a rule that refactor commits don't change test assertions.

## Why a second pass

`plans/build-cli-readability.md` (done 2026-11-15) refactored function bodies with every export, signature and module frozen. It also added a file header to every file, written to the standard "who calls it, what it hands off to, where to start", plus a glossary sentence wherever a term first appears, plus a README in every folder (1,574 lines).

That pass made individual functions readable. A survey of the current code (three read-only reviews, one per slice of `src/`) found what remains, and both of its causes come from the earlier pass:

1. **The structure problems it couldn't reach.** Values that cross several layers, rules written in several places and the flat `core/` all need exports and modules to move, which the freeze forbade.
2. **The commentary it added is now a large share of the reading.**
   - Comments are 21% of lines. There are 1,089 backticked file-path citations in `src/`.
   - The `new` flow is described five times. The tamper check is described five times.
   - "A fragment is a reusable addition (CI, git hooks, a database)" appears in 16 files.
   - Every citation is accurate today. The issue is volume, and that every file move now means editing hundreds of comment lines. That cost is part of why `core/` stayed flat.

So this pass lifts the freeze on exports and modules, and it shrinks the commentary.

## Goal and non-goals

The goal is that a reader can find where any value or rule comes from in one or two hops, using names and folders rather than prose.

The CLI's observable behavior must not change. That covers:

- stdout and stderr in every audience;
- `--json` results and error envelopes, including key order and `stacks schema` output;
- exit codes;
- files written into projects;
- on-disk state the CLI reads back (the state record, `runs.jsonl`, the telemetry spool and notice files including their `second:<uuid>` claim format, caches, backoff files);
- log record fields;
- network requests;
- the order in which failures are detected and writes happen.

Out of scope:

- `packages/format` and `packages/mcp` code;
- `registry/`;
- every wire contract, even where a name is poor (`BadInput.details.flag` names non-flags such as `branch_taken`; leave it);
- new features, flags or options;
- new exceptions to the boundary rules;
- performance work, except where a structural change happens to remove repeated work, such as `planVerify` running twice for one `verify`.

## How behavior is held

Three layers each cover what the others miss. The tests come first: stage 0b makes them a reliable signal before anything else changes.

### Behavior harness

The first pass's harness lived in a session scratchpad and is gone. Rebuild it as a tracked maintainer script, `packages/cli/scripts/behavior-snapshot.ts` (this is the second time a refactor has needed it).

**Main pass.** It runs a fixed list of commands against the built Node bundle, each in a throwaway HOME, with `STACKS_OFFLINE=1`. It records:

- exit code, stdout and stderr;
- files written;
- the JSONL log, with `STACKS_LOG_FILE` and `LOG_LEVEL=debug`, so successful commands write their `command` record (at the default `warn` they write none).

It normalizes paths, times, and defect stack frames. Frames come from the minified bundle, so any edit changes them.

**Commands.** Coverage starts from the first harness's 89 commands: help, list, show, search, schema (including `stacks schema error`), validate, new, add, verify, runs, create and 13 failure cases, in all three audiences. It adds:

- `new <stack> --dry-run` with a `preset` setting;
- an `add` with a conflict;
- `verify --only bogus` with changed steps;
- a `verify` interrupted at a fixed point: a step that signals the CLI's process group, never a timer.

**Human audience.** Human mode runs under a pseudo-terminal, which merges stderr into stdout. So the harness checks human-mode content but not which stream each line went to; the `runCli` tests cover that.

**Telemetry pass.** A second pass gives one shared HOME to a sequence of commands: `new`, `verify`, a failing `--json` command, then `verify` again. `STACKS_TELEMETRY_URL` points at a local sink, the notice is pre-accepted in one variant and not in another, and the run records normalized request paths and bodies plus the state directory's telemetry files.

**Not covered.**

- The release bundle always uses the production API URL (`scripts/build.ts` defines `STACKS_RELEASE_BUILD`), so search, stats and the allowlist are left out to keep runs deterministic.
- Their record of truth is the `runCli` tests that use `apiUrl` and `e2e/binary.test.ts`, which pins `no_endpoint` for the packed bundle.
- Signals beyond the fixed interrupt are covered by e2e only.

Two baseline runs of each pass must match exactly before the baseline is used.

### Tests

The test suite is mostly behavioral, but not entirely:

- **Behavioral:** 96 of the CLI's 213 test files go through `runCli`.
- **Internal-module tests:** the other 117 import internal modules directly. So do 32 files under `scripts/` and `e2e/`.

The `runCli` tests run through `tests/helpers/` (`cli.ts`, `remote-index.ts`, `telemetry.ts`, `bench.ts`), which call the very signatures stage 1 changes. A change to a helper is therefore a change to what every behavioral test exercises (see stage 0b).

The rule for every refactor commit in stages 1 to 6:

- A test file may change its imports and call sites only, never an assertion, a fixture or an expected value.
- **Path-fixture exception:** a fixture that names a moved file by path changes with the move. Examples: the allowlist rows in `tests/boundaries.test.ts` and `tests/hooks/guard-boundaries.test.ts`, the computed `import()` path in `tests/dependency-reader.test.ts`.
- A helper in `tests/helpers/` changes in its own commit, reviewed for one thing: the same tests still reach the same branches (telemetry tests still reach `enabled`, remote tests still see a trusted index).
- A failing assertion means behavior changed. Revert or fix the code, never the test.
- A test that pinned an internal which no longer exists, and that stage 0b missed, is rewritten through `runCli` or the public function in its own `test(cli):` commit and revert-verified.
- No assertion is weakened or deleted.

Typecheck doesn't see computed `import()` specifiers or paths inside strings. So each move commit also runs `grep -rn "<old path>"` over these locations:

- `packages/cli/{src,tests,scripts,e2e}`;
- the root `tests/`;
- `.claude/` and `AGENTS.md`.

The commit is done when the grep finds nothing.

### Commit kinds

| Kind | Contains | Reviewed by checking |
| --- | --- | --- |
| `test(cli): ...` | stage 0b work, or a pinned-internal test re-expressed through public behavior | revert-verify |
| `refactor(cli): move ...` | `git mv` plus import, path-fixture, guard and comment-path updates; no other change | the diff has only path lines; the old-path grep is empty; `git log --follow` works |
| `refactor(cli): ...` | rewrites inside files that stay put | harness diff empty, tests green |
| `docs(cli): ...` | comment and README changes only | typecheck and lint |

A stage lands when its commits are on the branch, the gate is green with the baseline's test counts plus any new tests, and both harness passes show no diff.

## Decisions for the maintainer

Each of these changes a repo rule. The plan is written assuming the recommendation. Stages that depend on one say so.

**R1. Comment policy (recommend: adopt).**

- Source comments cite symbols (`openProject`), not paths. Paths stay in AGENTS.md's architecture map only.
- A file header says what the file owns and the reason for any non-obvious shape, in one to three sentences. No caller lists, no "start at", no glossary.
- Terms are defined once, in `packages/cli/src/README.md`.
- Folder READMEs are deleted except `src/README.md`, which becomes the glossary plus a one-screen map. AGENTS.md's architecture map stays the single path index.
- Update `.claude/rules/`. `plans/build-cli-readability.md` records the old standards as history and is superseded.

**R2. Optional keys (recommend: adopt).**

- Add a `defined()` helper (`core/object.ts`) that drops `undefined`-valued keys and types them as optional. It must keep insertion order, because results, telemetry bodies and log annotations built without a Schema encoder serialize in that order.
- Update `.claude/rules/typescript.md` to name it as the way to build optional fields. It removes about 90 `...(x === undefined ? {} : { x })` spreads.

**R3. Reading the environment in config (recommend: adopt, with the stated exceptions).**

- `.claude/rules/cli/effect.md` requires a `ConfigProvider`, so `config.ts` reads the environment two ways in one function. The `ConfigProvider` route is wrapped in `orDie`, though it can never fail.
- Relax the rule to "`config.ts` is the only env reader". Use one blank-normalized `env(key)` lookup over the captured record.
- Two reads stay raw, each with a comment saying why:
  - `CI`, where presence alone counts (`CI=""` selects the agent audience and the `ci` consent reason; `tests/telemetry-consent.test.ts` pins the consent half);
  - `childEnv`'s source, which passes blank values through to children.

**R4. `Effect.fn` codemod (recommend: decline).**

- Converting every `(args) => Effect.gen(...)` in one pass would be more uniform, but it churns nearly every file for a small gain. Keep converting functions as they are rewritten.
- The logged defect frames change with any edit, so the harness normalizes them either way.

**Q1. The `--dry-run` preset in the picker (a question, not part of the refactor).**

- `new <stack> --dry-run` applies the `preset` setting (`scaffold/new.ts::scaffoldPreset`), so it previews what `new` would write.
- The interactive picker (`prompting.ts::pickPreset`) makes `default` its Enter choice for a dry run. So a picked dry run previews something other than the real run.
- AGENTS.md's "Preview ignores the setting" refers to `validate --brief` (`docs/authoring.md`, pinned by `tests/create-preset.test.ts`), not to `new --dry-run`.
- If the picker is wrong, fix it as a separate `fix(cli):` with a failing test; otherwise add a comment there saying why it differs.
- Resolved 2026-11-18: the picker was wrong. Its dry run now pre-selects the `preset` setting like the real run (`fix(cli):` with a regression test in `tests/prompting-new.test.ts`).

## Stages

Stages run in order. Within a stage the work units are independent unless noted.

### Stage 0: baseline

1. Land the behavior fix below, starting with a failing test, so the baseline already contains it.
2. Build the harness, capture both baselines from `main`, and confirm each matches a second run.
3. Record the gate's counts.

### Stage 0b: make the tests a behavior signal

The refactor is judged by its tests. A test that pins an internal goes red for a correct move and says nothing about whether behavior held. A behavior that only an internal test covers loses its coverage when that internal is reshaped. This stage fixes both before any production code changes.

This stage changes only tests; `src/` is untouched.

**Audit scope.** Every test file, and every file in `tests/helpers/`, that touches a module or signature stages 1, 3, 4, 5 or 6 reshape. That includes at least these:

| Stage | What changes | Tests and helpers to audit |
| --- | --- | --- |
| 1 | `main`, `AppLayer`, `Output.layer`, `RemoteIndex.layer` and `Telemetry.layer` signatures | `tests/helpers/cli.ts`, `remote-index.ts`, `telemetry.ts` and `bench.ts`; `remote-index`, `remote-origin-edge`, `search-api-index`, `show-dependency-rollup` and `telemetry-consent` tests |
| 1, R3 | config reads | `config` and `telemetry-consent` |
| 3 | moved files named by path | `boundaries`, `dependency-reader`, root `tests/hooks/guard-boundaries` |
| 4 | error table, exit status, verify planning, preset, flag replay | `errors`, `verify`, `verify-tamper`, `prompting-regressions`, `create-preset` |
| 5 | handoff steps, entry union, `Logging.records`, Output notice methods | `handoff`, `agent-picker`, `entry-schema`, `logging`, `output`, `telemetry-events` |
| 6 | `Tamper` union, `ComposeFailure` rename, pickers, telemetry storage helpers | `verify-tamper`, `agent-detection`, `validate-*` tests importing `ComposeFailure`, `agent-picker` |

A test that imports a module but already asserts only observable output, such as `handoff-rollback.test.ts`, which runs the real command tree, goes in the keep group without changes.

Sort each test into one of three groups:

| Group | What the test does | What happens to it |
| --- | --- | --- |
| Keep | Asserts observable output, or a pure function's result where the function survives with the same inputs and outputs (`decideHandoff`'s rules, schema decoding) | Nothing; at most its import changes later |
| Re-express | Pins a shape the refactor removes: a callback's arguments, an intermediate structure, a mutable array like `Logging.records`, `Parameters<...>` of a function that gets an options object | Rewritten to assert the same behavior through `runCli` or the public function the refactor keeps |
| Cover first | Is the only test of a behavior a person or agent can observe | A `runCli` or e2e test of that behavior is added first; the old test is then kept or re-expressed |

The audit's table goes in a section appended to this RFC, so the stage 1 to 6 contracts can name the tests that guard each unit.

**Gaps to close first.** The harness can't see these behaviors, or sees them only partly, and stages 1 to 6 touch them. Each gets a behavior-level test before the refactor reaches it, where none exists:

- **Handoff order** in `new` and `add`: the summary is flushed before the picker, the telemetry event is spooled before the launch, and `manifest.handoff` holds the final choice.
- **Rollback** after a failed or interrupted write in `new`, `add` and `create`: what is removed, and which `rollback.incomplete` paths are reported.
- **Telemetry state on disk** after `new`, `verify` and a notice run (spool files, the notice file and its `second:` claim, project links), plus one case: a `--json` command that fails after the notice was due leaves the notice undelivered, so the next run shows it again.
- **The `command` JSONL record** for a success, an expected failure and a defect.
- **Exit status** for each source `exitStatus` will gather:
  - an interrupted run gives 130;
  - BrokenPipe gives 0, but a keeps-result tag keeps its own exit;
  - a closed stdout;
  - a launched agent's status.
- **Verify failure order.**
  - `verify --only bogus` with changed steps exits 2 (`BadInput`), not 5.
  - `verify --only bogus --accept-changes` writes neither the state record nor the manifest.
- **Trust for each origin,** observed as whether `new` launches or refuses, and as the `untrusted` lists in `--json`:
  - project, user and bundled;
  - a bundled root overridden by `STACKS_REGISTRY_DIR`;
  - an index at a configured `STACKS_INDEX_URL`;
  - an index at the official URL, injected through the test helper. This is the only path that makes index entries trusted.
- **Stats on or off by index URL.** Stats are off under `STACKS_INDEX_URL` and on under the official index URL (see stage 1).
- **Preset precedence for `new`:** flag, then `--sandbox`, then setting, then default.
- **Preset precedence for `add`:** the recorded manifest preset, then `--sandbox`, then default; it never reads the setting.
- **The audience under `CI=""`:** agent audience even on a terminal (for R3).
- **`--json` key order** of every result that is built by hand rather than encoded through a Schema, for R2's `defined()`.

The packed bundle's `no_endpoint` telemetry state is already pinned by `e2e/binary.test.ts`; don't duplicate it.

**Rules for this stage:**

- **Prove each test catches a break.** Every new or re-expressed test is revert-verified (`.claude/rules/cli/verification.md`): break the behavior by hand in `src/`, see the test fail with the expected message, then restore it.
- **Replace before deleting.** An old test is deleted only after its replacement is green and revert-verified, and only when it pinned nothing observable. No assertion is weakened.
- **Commit as tests.** Each change is a `test(cli):` commit, and the gate count may only go up.

After this stage, a red test during stages 1 to 6 means one of three things: an import, a path fixture or a helper call that the move or signature change didn't update yet, or a behavior change.

### Stage 1: one place for build facts and endpoints

This is the change behind the maintainer's original question.

**`src/build.ts`.** It reads the Bun build-time defines once (`PACKAGED_ESCAPES`, `STACKS_RELEASE_BUILD`, `STACKS_PUBLISHED_TELEMETRY`) and holds the official URLs:

- `HOSTED_API_URL`;
- `OFFICIAL_INDEX_URL`, `undefined` until an index host exists;
- the official telemetry URL rule.

**`Build` and `AppConfig`.** `Build` carries all three official URLs. `AppConfig` keeps today's meaning of its existing fields and adds the resolved ones:

| Field | Value | Read by |
| --- | --- | --- |
| `apiUrl` | unchanged: `STACKS_DEV_API_URL` loopback override, else the official API URL | as today |
| `indexUrl` | unchanged: what the user configured in `STACKS_INDEX_URL`, else `undefined` | `core/stats.ts` and `core/doctor.ts::remoteIndexStatus`, whose rules depend on that meaning |
| `remoteIndexUrl` (new) | `indexUrl`, else the official index URL | `RemoteIndex` only |
| `telemetryUrl` (new) | `STACKS_TELEMETRY_URL`, else the official telemetry URL | `Telemetry` only |

Folding the official URL into `indexUrl` would switch stats off for everyone, and mislabel doctor's fallback, the day an official index host exists. Today's tests can't see that, because the official index URL is `undefined`.

**Signature changes.**

- `RemoteIndex.layer` loses `officialUrl`, and `RemoteIndex` exposes `trusted` directly. `registry/remote.ts` stops reading `status.isDefaultUrl` off the doctor report.
- `main` loses its `telemetryOptions` parameter.
- `AppLayer({ output, build, env? })` and `main({ args, program? })` replace the positional `undefined`s.
- `Output.layer({ jsonFlag, stdout, stderr })` names its boolean.
- `hasFlag` and `beforeSeparator` move to `argv.ts`, since `bin.ts` and `main.ts` both use them.

**Test helpers.** `tests/helpers/remote-index.ts` and `tests/helpers/telemetry.ts` pass their official URLs through `Build`, in one helper commit reviewed as "Tests" describes. The stats and trust gaps from stage 0b must stay green across it.

After this, every endpoint is two hops from its use: `AppConfig` field, then `build.ts`. The audience inputs are one hop from `resolveAudience`, which takes `{ jsonFlag, stdoutIsTTY, agent, ci }`.

### Stage 2: commentary (depends on R1)

This stage changes comments and docs only. It goes before the moves because it removes most of the path citations that stage 3 would otherwise have to rewrite.

- Shorten each file header to the R1 standard and remove the repeated glossary sentences.
- Turn path citations in comments into symbol citations.
- Delete the folder READMEs and write the new `src/README.md`.
- State each policy once, at the code that enforces it: keeps-result, the signal policy, the tamper check, trust points. Every other place names that symbol.

`errors.ts`'s header is already incomplete: it names five of the seven places a tag must be registered, leaving out `ErrorTag` and the envelope's details union.

A header deletion must keep every non-obvious why, every trust-point citation and every invariant comment. It removes only retellings, caller lists and glossary repeats. Measure the comment share before and after; expect it to roughly halve.

### Stage 3: layout (moves only)

These moves follow the reviews' proposed trees. Each bullet is its own move commit. In the same commit, update:

- the AGENTS.md map;
- `.claude/rules/` paths;
- the allowlists in both `biome-plugins/boundaries.grit` and `.claude/hooks/guard-boundaries.ts`, with their path fixtures;
- the old-path grep, until it comes back empty.

`core/` goes from 36 loose files to about 12:

- **`core/project/`** gets what `new`, `add`, `create`, `skill` and `verify` all use: `writer.ts` (was `scaffold/write.ts`), `manifest.ts`, `state.ts` (was `project-state.ts`), `git.ts` (was `scaffold/git.ts`) and `template-values.ts` (was `scaffold/values.ts`). `scaffold/` keeps only what `new` alone uses.
  - `manifest.ts`'s `node:crypto` allowance and `writer.ts`'s `node:fs/promises` allowance move with them. That is the same allowance at a new path, not a new exception.
- **`core/handoff/`** gets `decide.ts`, `launchers.ts` and `render.ts` (from `core/handoff.ts`), plus `run.ts` (harness discovery, picker and launch, from `commands/handoff.ts`). The shared flag parsing goes to `commands/project-flags.ts`. This leaves one module named `handoff`.
- **Same-named file and folder pairs** merge into the folder as `index.ts`: `add.ts` into `add/`, `deps.ts` into `deps/` (fix `tests/dependency-reader.test.ts`'s computed path in the same commit).
- **Prefix families** become folders: `show/`, `list/`, `create/`, `stats/`.
- **Pure helpers** get grouped: `core/text/` (text, wrap, shell, slug, shown-path, suggest) and `core/fs/` (absent, replace-file, canonical-json).
- **The remote index** goes into one folder, `core/registry/remote/` (`service.ts`, `merge.ts`, `files.ts`, `verification.ts`), from `core/remote-index.ts`, `core/remote-index/` and `registry/remote.ts`. It isn't named `index/`, which would collide with the `index.ts` entry-point convention above and with `scripts/index/`.
- **Root construction** moves from `registry.ts` to `registry/roots.ts`.
- **`core/validate/`** (37 flat files) splits into `checks/` and `compositions/`, with the shared plumbing left at the top.
- **`core/verify/result.ts`** collects result building: `skippedStep` and `secondsSinceCreated` (from `plan.ts`), `summarize` and `runOutcome` (from `run.ts`), and `changedResult` (from `tamper.ts`).

The runtime slice:

- `main.ts` loses its 130 lines of parser-error mapping to `cli-usage.ts`.
- `config.ts` loses the env-name catalogue (`CLI_ENV`, agent markers, `GIT_REPOSITORY_VARIABLES`) to `env-names.ts`.
- `errors.ts` (1,289 lines) splits: the contract stays (classes, `errorTable`, envelope); the 650 lines of user copy (`failureGuide` and helpers) move to `core/failure-guide.ts`. That also stops `errors.ts` importing `core/verify`, `core/template` and `core/shell`.
- The spinner and live-line code move from `services/output.ts` to `services/output-live.ts`.
- `telemetry/client.ts` becomes `deliver.ts`, and `telemetry/projects.ts` becomes `links.ts`.

Expected churn: about 150 import lines across tests, scripts and e2e, all mechanical, plus the path fixtures named above.

### Stage 4: one source per rule

These are rewrites. Each removes a rule's second, third or fourth copy.

**Error tags.**

- `errorTable` rows carry their `details` schema, and `ErrorTag` and `encodeDetails` are derived from it.
- The envelope's details union is derived in its current hand-written member order, kept as an explicit ordered list. That order is `stacks schema error`'s `anyOf` order, which MCP's `e2e/schema-drift.test.ts` compares against. Usage and BadInput overlap on `flag`, so member order also decides which one a mirror decoder matches.
- Constant-only guide switches (`permissionReason`) become lookup tables. `failureGuide` stays an exhaustive switch.

**Exit status.** One pure `exitStatus(outcome)` at the end of `main` lists every case in order. `EXIT_INTERRUPTED` comes from `errorTable` and is used by `runtime.ts` and `platform/signals.ts` in place of three literal `130`s.

**Flag sets.**

- `new`'s flags are listed four times today (`newFlags`, `flagOptions`, `newReplay`, `NewOptions`) and `add`'s three times.
- The options type is derived from the parsed flags.
- The replay line is derived from one table per command that records each flag's replay name, its position in the current order, and whether it is replayed at all. `--source`, `stack` and `dir` are excluded, and `dir` prints after `--`.
- `Running:` lines are human-only, so `tests/prompting-regressions.test.ts` is their guard.

**Preset.**

- `new` and `add` resolve the preset with opposite precedence: `add` reads the manifest, never the setting, and the manifest beats the flag.
- Two named pure functions, `newPreset` and `addPreset`, live in one module beside each other. `scaffoldPreset`, `pickPreset`'s copy and `add/prepare.ts`'s copy call them. Lean is derived once.
- Stage 0b pins both orders.

**Trust.**

- A `trusted` field on each `RegistryRoot` is computed in `registry/roots.ts` for every origin. Today trust point 2 is implemented separately for local and index entries.
- The root-remapping code duplicated between `commands/add.ts` and `commands/list.ts` becomes one `projectRoots(dir)`.

**Verify planning.**

- Step defaults are applied once.
- `planVerify` runs once, where `commands/verify.ts::prepareRun` runs it today: before `checkTamper` and `acceptChanges`. Its plan is passed into `runVerify` instead of recomputed there. Moving it later would turn `--only bogus` with changed steps from exit 2 into exit 5, and would let `--accept-changes` write before the flag error.
- The probe default becomes the named constant `DEFAULT_PROBE_WITHIN`.

**Paths.** Each path in `config.ts` becomes one flat line in resolution order, with its precedence on the `Paths` type (depends on R3). Telemetry's directory becomes a `Paths` field instead of a segment added where it's used.

**Validate and selection rules.**

- Validate's copy of the app and conflict rules (`validate/compositions.ts::replacementDefaults`) calls `compose/selection.ts`'s predicate.
- If the two disagree on any input, that is a behavior finding for "Behavior fixes", not a refactor. `tests/bundled-registry.test.ts` and validate's exact-finding tests decide which case applies.

### Stage 5: control flow a reader can follow

**Handoff.**

- `completeHandoff`'s `render`, `encode` and `beforeHandoff` callbacks are replaced with explicit steps in the `new` and `add` command bodies: settle the decision, record telemetry, print, launch. `scaffold` stops calling back into a closure from `commands/`.
- One `settleHandoff` does every rewrite of `manifest.handoff`; today there are four writers.
- The order of output, telemetry and launch is behavior, pinned by stage 0b. This unit gets a close review.

**Registry entries.**

- `Entry` and `RejectedEntry` become one discriminated union with one `isRejected`, replacing four kinds of membership test (`"rejected" in`, `"error" in`, `"meta" in`, ...). The `Stack` and `Fragment` aliases, redeclared in five files, are defined once.
- `Registry.get` keeps a rejection's reason instead of dropping it and searching for it again.
- The deep symlink walk stays lazy, cached per entry, and off the entry data object, as AGENTS.md describes. Only the side map's name and accessor get clearer. Computing it at load would change `list` and `catalog`; putting an Effect on `Entry` would leak into results that spread or stringify entries.
- The dormant index merge leaves the common `get` path when the index is off.

**Telemetry names.** These match what the code does, with no change to on-disk formats:

- `queue` becomes `record`;
- `sendEvent` and `emitEvent` become `spool`, because they write to the spool and send nothing;
- `enqueue` becomes `spool.write`;
- "send" is used only for real delivery;
- `noticeOutcome.shown` becomes `isNoticeRun`;
- the event builders `scaffold` and `verify` become `linkScaffold` and `verifyEventFor`.

**Logging.** `main`'s summary `command` record goes through a `Logging.command` method instead of pushing into the public `records` array. That removes `main`'s own `LEVEL_RANK` and `CommandLog`. Record fields and order are pinned by the harness's JSONL capture and stage 0b.

**Output.**

- `main` encodes details explicitly and chooses `Defect` itself, instead of recognizing an `orDie` from inside `Output.error`.
- The envelope is built from `ErrorEnvelope` instead of by hand.
- The telemetry notice methods (`notice`, `noticeDelivered`, `withNotice`) are replaced only if the replacement keeps all three of today's semantics:
  1. text modes write the notice to stderr at once and mark it delivered;
  2. JSON attaches it only to object results;
  3. JSON marks it delivered only after a successful flush, which `telemetry/notice.ts` reads to settle the claim.
- A generic `attach(field, value)` plus a delivered signal is the candidate. If it can't keep all three cleanly, leave the methods and rename them.
- This unit touches the failure path for every command. It goes last in the stage and gets a close review.

### Stage 6: small cleanups

**Named types.** Export named types instead of re-deriving 14 shapes with `Effect.Success<ReturnType<...>>` or `Parameters<...>`. Examples: `Scaffolded`, `VerifyProject`, `VerifyOptions`, `TelemetrySource`. `Tamper` becomes a union.

**Result builders.**

- Pure `newResult` and `addResult` builders replace the 20-field literals that end `scaffold` and `add`.
- `add` calls `renderAddBrief` directly.
- A `[...readonly]` copy is removed only when the commit says why no later mutation can reach the copied array. Arrays that end up in `details` stay copied, since mutating `details` after construction is the Defect path. Typecheck alone doesn't show this.

**Duplicate helpers that agree.**

- one "stacks first, then id" comparator, from four copies;
- distinct names for the two `checkOwnRepo`s;
- `isAbsent` instead of its inline copy in `add/plan.ts`;
- one `denied`;
- one staleness check and one `STALE_CLAIM_MS` in telemetry storage;
- root-relative paths for every `storage.ts` helper;
- no double manifest walk in `links.markDepsSent`;
- registry helpers take their file access the same way everywhere.

The two numbered pickers become two named functions sharing one renderer, not one function with a give-up option. That option would have one caller, which AGENTS.md "Code structure" rules out.

**Colliding names.**

- `ComposeFailure` means two different unions; rename one.
- `source.source.source` in four validate files.
- `bundled`, which means four different things.
- The config methods `get` and `settings` become `settings` and `readSettingsFile`.
- `ObservedExit.defect` becomes `defectTrace`.
- `failedWith(cause)` replaces five copies of the same cause probe in `main.ts`.

**Optional keys.** Apply `defined()` everywhere (depends on R2), with stage 0b's key-order tests as the guard.

**Dead code.** Delete `Logging.memory` (no callers) and the partial `schemas/index.ts` barrel.

**Not changed:**

- `stripAnsi` stays in `services/output.ts`. It is `node:util`'s `stripVTControlCharacters`, and `core/` may not import Node builtins.
- `step.ts::parseDuration` stays. Reusing the format package's `Duration` pattern would need a new `packages/format` export, which is out of scope.

## Behavior fixes found (not part of the refactor)

The reviews found duplicated code that has drifted into a real behavior difference. It lands in stage 0 as `fix(cli):`, with a failing test first.

1. **Repeatable flags trim differently.**
   - `--with "a, b"` on `new` and `add` trims each item (`commands/handoff.ts::splitValues`).
   - `verify --only "lint, test"` (`commands/verify.ts`) and `validate --with "a, b"` (`commands/validate.ts`) don't, so they look up `" test"` and `" b"`.
   - Make all three use `splitValues`.

Q1 above may add a second fix. Any drift found during stage 4, such as validate against selection, is added here, not folded into a refactor commit.

Fix 1 landed in stage 0 (`fix(cli): trim comma-separated items...`): blank items are now ignored too, so `verify --only ' '` runs the full plan where it used to fail with `BadInput`.

Found during execution, all pre-existing and left unchanged by the refactor commits. Items 3 and 4 were then fixed in their own `fix(cli):` commits with failing tests first; item 2 turned out not to be a bug:

2. **Not a bug: validate and selection on a rejected default.** With default fragment `ci` rejected and optional `old-ci` declaring `conflicts: [ci]`, composing with `--with old-ci` alone fails with `EntryInvalid` for `ci`, but validate's replacement planning means `--with old-ci --without ci`, and that composition succeeds in both `new` and `validate --brief` with the same fingerprint. A conflicting default always needs `--without` (a valid one gives `ComposeConflict`), so the two rules agree. The stage 4 consolidation was still skipped, since the two inputs differ.
3. **Verify stage outcome under `--only` plus `--skip-tag`.** A base check tagged `hygiene` and `slow`, run with `verify --only base,app-check --skip-tag slow --json`, is skipped by `--skip-tag`, yet both stages report `green` and the app check runs; expected is a partial base with the app check skipped. `selectionSkip` lifts the hygiene default for `--only` before applying `--skip-tag`, while `stageOutcome` still treats the omission as a default skip.
4. **A `null` JSON result marks the telemetry notice delivered.** In `Output.memory("json")`: `showNotice(...)`, `result(null, "")`, `flush` prints `null` without the notice, yet `didDeliverNotice` returns true. No command returns `null` today, so it is latent.

## Execution log (2026-11-17)

Landed on `refactor/cli-structure`, not merged or pushed. Each stage passed `rr check` (7/7) and an empty harness diff against the stage 0 baseline (`diff -r --strip-trailing-cr`; a stray terminal CR in human captures was fixed in the harness in stage 6). CLI tests went from 3,945 to 3,963 passed. Deviations from the plan: `errorTable` derives from static fields on each error class instead of rows carrying schemas; the `DEFAULT_PROBE_WITHIN` item was dropped because the default has one owner already, `withStepDefaults` in `packages/format`; `defined()` replaced 30 spreads, not about 90 (31 existed). A maintainer request added `src/constants.ts`, which now owns every config default and fallback; `build.ts` keeps only the Bun defines.

## Execution

- **Where:** a landing branch `refactor/cli-structure` in a worktree. Stages merge into it in order, and it merges to `main` locally at the end.
- **Who:** coding units go to Codex delegates under the repo default (`.claude/rules/agent-ops.md`, `.claude/delegate.md`). Each contract names:
  - its unit and the files it owns;
  - the stage 0b tests that guard it;
  - the test rule above;
  - the harness command.
- **Done inline by the orchestrator:** stage 0b's audit, stage 2's comment work, the `errors.ts` split, the test-helper commits and the R1/R2/R3 rule edits. These are harness or convention work, or need judgment across every file.
- **Close review:** the units marked for it in stage 5, the stage 1 helper commit, and `scaffold/write.ts`'s rollback wherever it moves.
- **Gate:** run once per stage, through `rr check` in an opted-in clone.

Done means:

- both harness passes show no diff against the stage 0 baselines;
- the gate shows the baseline counts plus the new tests;
- the traced values are re-measured, with each at two hops or fewer: the API, index and telemetry URLs, the output audience, the exit status, the state directory, index trust and the handoff record;
- `core/` holds about 12 loose files;
- no file or folder is named after one command while holding code another command uses.

## Risks

- **Search, stats and the allowlist are outside the harness.** They stay covered only by the `runCli` tests that use `apiUrl`, and stage 1 rewires the URLs they read. The stage 0b stats and trust gaps and the stage 1 helper review carry that weight.
- **Signals beyond the fixed interrupt are covered by e2e only.** So is human-mode stream separation.
- **Merge conflicts.** Any in-flight branch conflicts with the stage 3 moves. Land stage 3 quickly once it starts, and rebase other work after it.
- **Deleting commentary that carried a real fact.** Stage 2's keep-every-why rule is the guard, plus a review of each `docs(cli):` diff.
- **Churn for agents.** AGENTS.md, `.claude/rules/`, the boundary guard and delegate templates cite paths. A stale path sends an agent to a missing file, which is why each move commit runs the old-path grep.

## Review log

Devil's advocate (2026-11-17, on the first draft), every finding checked against the code:

1. **Applied: the first draft's "behavior fix 1" was wrong.** It called `new --dry-run` honoring the `preset` setting a bug. AGENTS.md's "Preview ignores the setting" refers to `validate --brief` (`docs/authoring.md`, `tests/create-preset.test.ts`). Fixing it would have changed behavior. Replaced by question Q1, which is about the picker.
2. **Applied: stage 1 keeps `indexUrl` as "configured".** It adds `remoteIndexUrl` for the resolved value, because `core/stats.ts` and `core/doctor.ts` depend on the configured meaning. Stats and trust gaps were added to stage 0b.
3. **Applied: the harness runs offline, with stated limits.** The release bundle hard-codes the production API, so search, stats and the allowlist are left out and their record of truth is named. A telemetry pass with a local sink was added, along with `LOG_LEVEL=debug` capture, defect-frame normalization and a deterministic interrupt.
4. **Applied: the test rule gained the path-fixture exception and the old-path grep.** Moves update `.claude/hooks/guard-boundaries.ts` and its test along with `boundaries.grit`. The computed `import()` in `tests/dependency-reader.test.ts` is named.
5. **Applied: stage 0b's audit now covers `tests/helpers/` and stage 6.** Helper changes get their own reviewed commit. `handoff-rollback.test.ts` is noted as already behavioral.
6. **Applied: `planVerify` stays in `prepareRun`,** with a stage 0b test of failure order and of no writes.
7. **Applied: smaller corrections.**
   - R3 keeps `CI` and `childEnv` raw. R4's reason is now churn.
   - `stripAnsi` and `parseDuration` were dropped from the plan, since each needed a rule or scope exception.
   - The envelope union keeps its order. Two named preset functions replace one. The replay table keeps order and exclusions.
   - `notice` is replaced only if delivery semantics hold. The deep walk stays lazy. `defined()` keeps key order, and copy removals need a stated reason.
   - The interrupt is deterministic, and human-mode stream merging is stated.
   - The remote index folder is `remote/`, not `index/`. The `errors.ts` header count is fixed (five of seven). The picker has no one-caller option.
