# Effect v4 code and guidance audit

Date: 2026-10-31. Revised the same day after a devil's-advocate review (see "Review revisions").

Status: F1–F6 and the local rule changes (G2, G4, G5) are implemented on `main` as of `d77db59`. The shared `ce` skill changes (G1–G4, G6) are committed in `ce` as `c413a9d` (5.1.1). The last open item, incomplete rollback from the Codex app fallback's ignored handoff write, now fails the command with its original error and `rollback.incomplete` (merged to `main` 2026-10-31).

Reviewed repository: the `stacks` checkout, confirmed with `git rev-parse --show-toplevel`.

Reviewed revision: implementation findings at `c20f6d24446832cc966418bcae61e7d55acc2740`; the guidance section is rebased on `94d0ace` ("load the shared ce:effect skill instead of a local Effect skill"). The implementation files cited are unchanged between the two.

Installed Effect: 4.0.6, resolved from `packages/cli`. This audit concerns this repository. It does not claim to audit the separate `stacks-api` or `ce` repositories' application code.

## Assessment

The architecture and most Effect conventions are sound. The CLI has explicit runtime and platform boundaries, invocation-owned layers and caches, schema-based input decoding, controlled public errors, and behavior-focused tests. A wholesale Effect refactor would add risk without addressing the failures found here.

There are six confirmed implementation findings. The most consequential is project discovery treating an inaccessible manifest as absent, so verify can report green for an ancestor project. The next is verification persisting a green result, a first-green timestamp and a telemetry event after an internal defect. The rest concern submit reporting ordinary filesystem failures as defects, defects relabeled as permission errors, silent rollback failure, and unreadable history reported as zero runs. Only F1 and F5 are reachable without a program defect or a permission change mid-transaction.

Two of the fixes needed a contract decision, both now made by the maintainer: F2 records nothing for a defected run (no change to the closed `Outcome` and `FailureKind` literals), and F3 reports incomplete rollback through an optional details field on the existing tags (closed per-tag details, quiet agent stderr). Both are recorded in their sections.

Against `ce:handling-errors`, the code follows the intended boundary and privacy architecture but does not consistently preserve failure meaning or make failed recovery visible. The skill explicitly gives repo rules precedence, so fixed public messages, sanitized logs, quiet broken pipes, best-effort telemetry and optional caches are not violations merely because the generic skill uses different examples.

## Audit method and coverage

The review started from the actual checkout and installed dependencies, rather than accepting the earlier assessment based on representative excerpts. It read the Effect guidance, scoped Effect and TypeScript rules, error-handling contract in `AGENTS.md`, testing rules, architecture and agent-operations guidance, the shared error-handling skill and its TypeScript reference, and hook wiring.

The harness review explicitly included `.claude/hooks/guard-commands.ts`. It enforces the selected test runner, delegate restrictions, shell-edit restrictions and package-manager policy. It is plain Node code, so Effect service and recovery conventions do not apply to it automatically. This audit found no error-handling change to recommend there; the focused verification used named test files rather than a whole-suite command.

A repository-wide inventory identified 361 non-test JavaScript, TypeScript and shell source/asset files. The scan included hidden harness files and `.tmpl` assets. It excluded dependencies, generated output, plans, tests and test fixtures from the production inventory; existing tests were inspected separately as evidence. Source definitions that deliberately throw, such as the format package's schema compiler, were examined separately from catch/recovery matches.

| Area | Non-test files | Files with error-handling candidates | Candidate matches |
| --- | ---: | ---: | ---: |
| CLI runtime | 195 | 104 | 362 |
| Portable format runtime | 23 | 0 | 0 |
| Maintainer scripts and configuration | 47 | 27 | 79 |
| Repository harness | 16 | 6 | 20 |
| Shipped registry code assets | 80 | 40 | 89 |
| Total | 361 | 177 | 550 |

These are syntactic inventory counts, not counts of defects, independent handlers or tested branches. A match includes such constructs as `mapError`, `result`, `option`, catches and ignore operators. It does not establish correctness by itself. The review traced relevant owners and callers, distinguished validation findings from swallowed failures, and checked broader Effect patterns: runners, layers, state, caches, forks, scopes, interruption, clocks, schema decoding and external adapters.

Eight temporary behavioral probes ran through Vitest on Node. Six reproduced the findings below; two checked plausible concerns that proved correct. Seven existing focused test files also passed, totaling 142 tests. No full gate, paid provider calls, release operation, external publication or dependency upgrade was run. This is a repository-wide static and targeted behavioral audit, not execution of every environment or failure combination.

## Absence rules

F1 and F6 both decide when a filesystem failure means "not there". The Node platform layer (`@effect/platform-node-shared`, `internal/utils.ts::handleErrnoException`) maps ENOENT to `NotFound` and ENOTDIR, EISDIR and ELOOP all to `BadResource`, so the right rule depends on the question being asked:

- Discovery walking up for `.stacks/manifest.json` (F1) treats `NotFound` and `BadResource` as absent, as `core/scaffold/write.ts::missing` already does. A regular file named `.stacks` in a subdirectory (ENOTDIR) must keep finding the parent project.
- Reading a known path whose absence has a correct default (F6) treats only `NotFound` as absent. A directory at the history path (EISDIR, `BadResource`) is unreadable history, not missing history, so F6 must not reuse `missing`.

In both, `PermissionDenied` and `Unknown` are failures to inspect, never absence.

## Confirmed implementation findings

### F1. P1: An inaccessible nearest manifest lets verify run the ancestor project

Source: `packages/cli/src/core/manifest.ts::locateManifest`. Callers: `commands/verify.ts`, `core/runs.ts`, and `telemetry/projects.ts` (which wraps it in `Effect.option` and should stay silent).

The discovery loop uses `Effect.option(fs.stat(candidate))`. That turns every typed filesystem failure into absence, including permission failures. The loop then continues upward and can select another project's manifest.

Reproduction used two real nested projects. The child had its own `.stacks/manifest.json`; its `.stacks` directory was made inaccessible. The parent manifest contained a distinguishable command that wrote a marker in the parent's root. Running `verify --json` from the child selected the parent, executed that command, created the marker and returned a green result with exit 0.

The parent's steps still passed `core/verify/tamper.ts::checkTamper` against the parent's own state record, so trust model point 5 holds: nothing ran that a person had not accepted for that project. What goes wrong is that the caller gets a green verify for a different project than the one they are in. Agents loop until verify is green, so a false green for the wrong project ends their work on the child early. Likelihood is low: it needs a `.stacks` directory the user cannot search, such as one created mode 700 by another user or a sandbox.

Recommendation: keep walking on `NotFound` and `BadResource` (see "Absence rules"). Fail on `PermissionDenied` and `Unknown` with the existing `PermissionDenied` tag, `details: { reason: "read", path }` (`errors.ts::PermissionDeniedDetails`, exit 6). Widen `locateManifest`'s error type and update the three callers rather than forcing it through the current `NotFound`-only signature.

Acceptance: an inaccessible child metadata directory produces `PermissionDenied`, does not execute either project's steps, and leaves the parent marker absent. A subdirectory without its own manifest still finds its parent project, and so does a subdirectory holding a regular file named `.stacks`.

Error-handling principle: a required lookup must not degrade into a different successful action when it cannot establish the original state.

### F2. P2: A verification defect can be persisted as a green run

Sources: `packages/cli/src/core/verify/run.ts::runVerify` (the outer `Effect.onExit` and `result`), `runStage` (its stage-level `onExit` and `stageOutcome`), and `core/verify/record.ts::recordRun`, called through `onFinished` from `commands/verify.ts`.

On an exceptional exit, the outer finalizer passes only `Cause.hasInterrupts(exit.cause)` into result construction. For a defect without interruption, that argument is false. The in-flight step never reached `results.set`, so it is filled in as `skipped` with the reason "the run was interrupted", which is also wrong. `runOutcome` counts recorded failed steps, sees zero, and returns green or partial. The stage-level `onExit` in `runStage` likewise calls `stageOutcome(steps, false)`, so `stages.base` is recorded as `"green"`.

The probe injected a filesystem-adapter `TypeError` while resolving the active step's working directory. It used the real runner and the real `recordRun` callback. The CLI correctly exited 1 with a Defect envelope, but `.stacks/state/runs.jsonl` contained a green run with a skipped step.

`recordRun` then sets `firstGreenAt` in a trusted state record and calls `telemetry.recordVerify`. The invocation dies before `telemetry.flush`, but the event is spooled and sent on a later run, so a CLI bug can raise a stack's published `greenRate`.

Reachability: only a program defect triggers this. `core/verify/step.ts::runStep` turns `SpawnFailed` into an `env` failure, and `platform/process.ts` catches synchronous `spawn` throws (NUL bytes in arguments, for example). That is why this is P2 rather than P1: the consequence is serious (false stats and a false first-green), the trigger is a bug that has not been observed outside the probe.

Decision (made 2026-10-31: option 1). `packages/format/src/run-record.ts::Outcome` is `green | partial | failed | changed | interrupted` and `FailureKind` is `step | env | timeout | interrupted`; neither has a value for an internal error, and stacks-api consumes both (telemetry v3, `greenRate`). The options:

1. On a non-interruption exceptional exit, call no `onFinished`: no run record, no state timings, no telemetry. The defect envelope is the only report. No contract change.
2. Record `failed` with the in-flight step `failed` and no `failureKind`. Counts CLI bugs as project failures in stats.
3. Add an internal-error value to `Outcome` and `FailureKind`, an additive change to the format contract, `stacks-api` and the stats definitions.

Chosen: option 1. It is the smallest change, keeps the published stats meaning intact, and a defect is already logged once at the `main` boundary. Both `result` and `runStage`'s `stageOutcome` must stop deriving green from an exceptional exit; teardown behavior and interrupted-run recording stay as they are.

Acceptance: a defect during setup, check or teardown still fails the invocation with exit 1, appends no record to `runs.jsonl`, sets no `firstGreenAt`/`firstTestPassAt`, spools no verify telemetry event, and leaves the defect visible to `main`. Interrupted runs are still recorded as `interrupted`.

Error-handling principle: preserving the exception at the outer boundary is insufficient if recovery or reporting side effects record a contradictory success.

### F3. P3: Failed rollback can leave changed bytes without a recovery diagnostic

Sources: `packages/cli/src/core/scaffold/write.ts::openProject` (`restoreBackups`, which wraps `atomicReplace` in `Effect.ignore`, and the following `fs.remove` cleanup), and the release of `core/project-state.ts::replaceProjectState`.

The writer ignores typed failures while restoring original bytes. The state-record transaction similarly ignores failed restoration or removal. The original error survives, but the caller cannot tell that rollback was incomplete.

The probe rewrote an existing file, made its containing directory read-only, and then failed the operation with `BadInput`. The writer could not stage its restoration. The command returned only the original input error; even with debug logging enabled in human mode there was no rollback warning. The file retained the replacement bytes.

Severity is P3 because both variants need a permission change in the middle of a transaction, and the state-record variant fails closed: a leftover new digest makes the next `verify` report `VerifyChanged` (`tamper.ts::acceptChanges`) rather than run anything unaccepted. The project-file variant is the one with user impact, since `add` and `new` document rollback with original bytes retained.

Decision on visibility (made 2026-10-31: option 1). A warning through logging reaches only human mode: in agent and JSON mode, logs go only to `STACKS_LOG_FILE` (off by default), and stderr carries the fixed message, the `failureGuide` lines and `Next:`. The primary error's message is fixed and its `details` are closed per tag. So surfacing incomplete rollback to an agent needs one of:

1. An optional `rollback: { incomplete: string[] }` field on the details of the tags `openProject` can fail with, with `encodeDetails` and `failureGuide` cases. Keeps the primary error and tag.
2. A new tag for incomplete rollback that replaces the primary error, with its `errorClasses` entry, `errorTable` row, exit code and next action. Loses the primary error.

Chosen: option 1, since the finding's point is that the primary failure must survive. Refined at implementation (2026-10-31): per-tag details can't carry it, because `openProject`'s rollback runs in a scope finalizer after the primary error is constructed, and that error can be any tag. Instead the writer records the CLI-owned paths whose restore failed in the per-invocation `Invocation` service, and `main` adds an optional `rollback: { incomplete: string[] }` to the envelope's `error` struct (one additive `errors.ts::ErrorEnvelope` change); text modes print a rollback line before `Next:`. The primary tag, message and exit are unchanged.

Recommendation for the code: keep attempting each restore after an individual failure, collect the CLI-owned paths whose restore failed, and attach them as above; also log them for human mode. Do not write a separate recovery copy of the original bytes: in the probe's scenario the directory is read-only, and a copy outside the project would put user file contents in CLI state. Leaving a foreign nonempty directory alone stays intentional and is not reported.

Gap fixed alongside: `replaceProjectState`'s release restores with `fs.writeFile(target, old)` and `fs.remove(target)`. That follows a link planted at the record path and is not atomic, contradicting `saveProjectState`'s guarantee that nothing planted there is followed. Restore through `core/replace-file.ts::replaceFile`.

Acceptance: simulate a failed backup restore and a failed state-record restore. The original failure and tag remain, cleanup continues for the other files, the envelope's details name the paths whose restore failed, and no raw platform error or file contents enter public output. A symlink planted at the state-record path is not followed during restore.

Error-handling principle: required recovery is not a disposable optional feature. Its failure needs visibility even when it cannot replace the primary error.

### F4. P3: The exclusive writer turns unexpected defects into permission errors

Source: `packages/cli/src/core/scaffold/write.ts::openProject`, its `writeExclusive` step and the `alreadyExists` helper.

The writer captures a complete `Exit` from `fs.writeFile`, checks whether any failure is `AlreadyExists`, and maps every other failed exit to `PermissionDenied` through `unwritable`. That includes Die and Interrupt causes. The same `.some(...)` check means a cause holding both `AlreadyExists` and a Die becomes `TargetNotEmpty` and loses the defect.

The probe supplied a filesystem adapter whose `writeFile` died with a `TypeError`. A write through the real project writer returned PermissionDenied with exit 6 instead of Defect with exit 1. The private exception was not leaked, but the defect category and trace were lost. A defect from `NodeFileSystem.writeFile` is close to unreachable in production, hence P3.

Recommendation: replace the `Effect.exit` branch with `Effect.mapError` (`AlreadyExists` to `TargetNotEmpty`, anything else to `unwritable`) and keep the existing `onExit` tracking and partial-write cleanup. In 4.0.6 `mapError` is `catchCause(self, cause => failCause(causeMap(cause, f)))`: it maps only Fail reasons and keeps Die and Interrupt reasons, so no hand-written cause inspection is needed.

Acceptance: EEXIST remains `TargetNotEmpty`; ordinary write denial remains `PermissionDenied`; an adapter defect remains a defect and is logged once at the boundary; cancellation still follows the invocation's interruption policy.

Error-handling principle: never turn an unexpected failure into a handled category merely to simplify an error signature.

### F5. P2: Submit treats ordinary filesystem failures as defects

Sources: the `Effect.orDie` calls in `packages/cli/src/core/submit/assemble.ts` (`copyEntry`, `copyCard`, `assemble`) and `packages/cli/src/core/submit/submit.ts::submit` (`makeTempDirectoryScoped`, `bodyFile`).

Creating temporary storage, preparing the outgoing entry and card directories, writing cards and authors, and writing the pull-request body all end in `Effect.orDie`. Permission denial, missing storage or a full filesystem are operational failures, not broken program invariants. Separately, `copyEntry` maps a destination `fs.copy` failure to `PermissionDenied{ reason: "read", path: entry.dir }`, blaming the author's source directory for a write failure.

The realistic trigger is `makeTempDirectoryScoped` failing because TMPDIR is unwritable or full, which agent sandboxes do cause. The probe used a read-only assembly directory, which is contrived (the directory is inside a temporary clone the CLI just made) but exercises the same `orDie` path: the CLI returned the generic Defect envelope with exit 1 and no path or category.

Recommendation, per errno class, choosing tags by the next action (`rules/cli/cli.md`):

- EACCES, EPERM, EROFS (`PermissionDenied` reason): `PermissionDenied{ reason: "write", path }`, exit 6. For `copyEntry`, use `reason: "read", path: entry.dir` only when the read side failed.
- ENOSPC and other `Unknown` reasons: no existing tag fits, so they stay defects (decided 2026-10-31). No new tag.
- Anything that is not a `PlatformError` stays a defect.

Acceptance: an unwritable TMPDIR, an unwritable card or authors path, and an unwritable body file each produce `PermissionDenied` with the write path, exit 6. Corrupt internal data or an implementation defect remains exit 1. (No PR is opened in any of these cases today, since `publish` runs after `assemble`; that must stay true.)

Error-handling principle: typed errors should retain the distinction that lets the caller decide whether to repair permissions/storage or report a program bug.

### F6. P3: An unreadable history file is reported as zero runs

Source: `packages/cli/src/core/runs.ts::projectRuns`, which reads `.stacks/state/runs.jsonl` with `Effect.orElseSucceed(() => "")`.

Every typed error becomes an empty string. Missing history and history that exists but cannot be read produce the same successful result: zero runs, no last outcome and zero skipped lines.

The probe made `runs.jsonl` a directory (EISDIR, `BadResource`). `runs --json` returned exit 0, empty stderr, `verifyRuns: 0`, `lastOutcome: null` and `skippedLines: 0`. `runs` is a reporting command and runs nothing, hence P3.

Recommendation: default to empty history only on `NotFound` (see "Absence rules"; do not reuse `write.ts::missing`). Fail every other read error with `PermissionDenied{ reason: "read", path }`. An explicit "unavailable" field in the result is the alternative, but it is an additive change to `schemas/runs.ts::ProjectRuns` and its `RESULT_SCHEMAS` entry, which this report does not recommend. The existing null fallback for optional NOTES is intentional and unchanged.

Acceptance: missing history still reports zero runs; an unreadable file or a directory at the history path produces `PermissionDenied` with the path. Malformed individual JSONL records retain the existing skipped-line behavior.

Error-handling principle: a default must be a correct substitute, not a plausible-looking value that hides unavailable evidence.

### Same pattern, failing safe

Two other `Effect.option` uses in the same area treat inability to inspect as absence but fail closed, and need no fix. `core/verify/step.ts::runStep` uses `Effect.option(fs.realPath(dir))`, so an inaccessible step `cwd` is reported as "not found"; the step still fails as `env`, so only the wording is wrong. `core/scaffold/target.ts::inspectTarget` does the same with `lstat`, and `openProject`'s exclusive `makeDirectory` then fails with `TargetNotEmpty`. These are the "fine" examples for G4.

## Broader Effect patterns

### Patterns to retain

Runtime execution is confined to the CLI boundary and explicit scripts. The production source scan found `Effect.runPromiseExit` in `runtime.ts`, not runners scattered through domain services. The custom signal and output-settlement boundary is intentional; replacing it with an upstream `runMain` example would discard application behavior.

Service and mutable-state ownership are clear. Layer constructors capture stable dependencies and allocate invocation-owned arrays, maps and caches. The module-level sets found in logging and process classification are fixed lookup data, not mutable cross-invocation service state. There is no basis here for converting every closure variable to a Ref.

The registry's caches are built at the intended layer lifetime. `Effect.cached` is used for the invocation snapshot and lazy lookups. Cached failure is not automatically a bug: a deterministic invalid config can remain invalid for one invocation. In `cached-fetch`, typed initialization read failures are deliberately recovered before memoization. A shared memoization rule needs to distinguish these cases rather than prohibit cached failures globally.

Time-dependent runtime behavior generally uses Clock and Effect time operators. The `Date.now` uses found in application source belong to the synchronous platform adapters. `new Date` elsewhere usually formats an already supplied or Clock-derived timestamp. Those are not ambient clock reads and should not be flagged merely by searching for `Date`.

The one unbounded-concurrency search operation runs a fixed pair of branches: local ranking and remote search. It is not an input-sized fan-out. Most file/registry traversals are sequential. No general concurrency rewrite is justified by that keyword alone.

Schema decoding is used for external contracts. The format package's explicit throws are schema-construction errors for unsupported or ambiguous columnar definitions, not ordinary decoded wire failures. A probe checked malformed stats dates, including impossible dates: these returned typed schema failures rather than throwing.

### Failure boundaries that are behaving correctly

The main boundary receives a typed-error catch before it observes the command's Exit. That matters for mixed causes in this release. A probe combined BadInput with a finalizer TypeError; the invocation returned Defect with exit 1 and did not expose the private message. A superficial reading of only `failureError`'s first-failure lookup would have produced a false finding.

Expected errors have a central exit/retryability/result-retention table. Output owns the public envelope, details encoding and broken-pipe behavior. Logging owns its record shape and safe defect projection. Existing focused tests passed for those contracts.

The optional remote metadata and statistics paths intentionally degrade. `cached-fetch` retains status information about fetch outcomes and can fall back to previously usable data. Its `io` helper dropping disposable cache I/O failures is not, by itself, a defect. It should not be reused as the policy for authoritative project history or required rollback.

Telemetry explicitly owns a best-effort cause-level boundary, emits sanitized debug information and must not change the user's command outcome. Progress, redraws, events and log sinks also have explicit nonfatal policies. These exceptions do not justify adding a warning for every cache miss or making every failed progress write fatal.

The repo's contract deliberately permits unreadable external project-state records to be treated as missing, while newer records receive specific handling. That is a local policy exception, not an audit discovery of an accidental generic fallback. Changing the trust policy requires a separate product decision.

Maintainer scripts and shipped plain-JavaScript assets have different owners from the CLI runtime. Their top-level failures, per-entry skips, advisory status hooks, log parsing and missing-process handling were checked in that context. This report does not propose porting every script to Effect or applying CLI envelopes to generated projects.

## Guidance audit

As of `94d0ace`, the local Effect skill is gone: `.claude/skills/` holds only `delegate`, `stack-authoring` and `fragment-authoring`. `.claude/rules/cli/effect.md` routes to the shared `ce:effect` skill (claude-essentials `ce` plugin 5.1.0) and keeps this CLI's policy on top, and the delegate contract templates (`.claude/skills/delegate/contract.md`, `contract-tests.md`) point delegates at the shared skill. Earlier drafts of this section cited the removed local skill; those items are dropped, and what remains targets the shared skill's references and the scoped rule.

The shared skill's entrypoint, errors and resources references were inspected for these points; this is not a full audit of the CE repository. Skill discovery in Codex was not tested; the instruction that both clients install the plugin is not discovery evidence.

### G1. Separate lifecycle from failure observation

The scoped rule and the shared resources reference now distinguish lifetime from failure observation. Keep this wording, or its equivalent, in shared `references/resources-concurrency.md`:

> Assign both a lifetime owner and a failure owner to background work. A scope prevents a fiber from leaking; it does not make its failure propagate to its parent. Join when the result is required, inspect the Exit when handling the result explicitly, or handle/report failure at the background worker's owner. Do not join a continuing worker merely to satisfy a rule when that would block the owning operation.

Keep the repo's prohibition on detached fibers local. The process progress sink already joins its delivery fiber; watchers whose effects have no expected failure do not need an invented typed failure just to satisfy the documentation.

### G2. Make failed required recovery explicit

The scoped rule and shared resources reference already explain registering release after successful acquisition and staged cleanup. Add the missing sentence on failed rollback to the shared resources reference:

> A failed rollback must preserve the original failure and make incomplete required recovery visible.

Put the project writer's reporting requirement (F3's outcome) in `.claude/rules/cli/effect.md` once F3's visibility decision is made. Do not rewrite `openProject` as one large acquisition: it already registers its rollback before subsequent mutations.

### G3. Teach cause preservation at manual Exit boundaries

The shared errors reference says to classify cause reasons and re-raise unmatched causes. Add the common case first, with F4 as the example:

> To translate typed failures, use `mapError`: in 4.0.6 it maps only Fail reasons and keeps Die and Interrupt reasons unchanged. Reach for a manual `Effect.exit` or `catchCause` only when the boundary owns defects or interruption too; then distinguish expected failure, defects and interruption, including mixed causes, and propagate unmatched causes through `Effect.failCause`. A record, warning or fallback produced during failure handling must not claim success for a failed operation.

Destination: shared `references/errors.md`. Use F2 and F4 as behavioral evaluation scenarios rather than adding a rule against all uses of `Effect.exit`.

### G4. Distinguish optional degradation from authoritative unknown state

The skills do not give a decision rule for `option`, `orElseSucceed` and `ignore`. Some uses here are correct and others drive F1, F3 and F6.

> Recover only when the substitute is semantically correct. For discovery, convert genuine absence to an empty result and propagate inability to inspect. For reports, keep unavailable distinct from zero. For required recovery, expose failure while preserving the primary error. Disposable optional caches and telemetry may use the repo's explicit fallback policy.

Destination: shared errors and state/caching references, with the repo's "Absence rules" (above) and missing-state policy in `.claude/rules/cli/effect.md`. Use `runStep`'s and `inspectTarget`'s fail-closed `Effect.option` as the acceptable example and `locateManifest` as the unacceptable one.

### G5. Narrow the restriction on cause-level handlers

`.claude/rules/cli/effect.md`, "Errors", limits `catchCause` and `ignoreCause` to best-effort writes "as `main.ts` and `logging.ts` do". Intentional code already goes beyond that: `telemetry/index.ts` (`catchCause` around reads, schema work and delivery), `services/output.ts` and `core/search/remote.ts` (`ignoreCause`), and `commands/telemetry-hooks.ts`. The shared reference permits cause classification at owning boundaries, so the local rule now conflicts with both the code and the shared guidance.

Replace the local sentence with:

> Use cause-level handling only at a boundary that owns the policy for typed failure, defects and interruption: `main.ts`, `logging.ts`, `services/output.ts`, `telemetry/` and `core/search/remote.ts`. Handle the cases the boundary owns and preserve unmatched causes. Ordinary application work does not swallow defects to appear successful.

Retain the instruction that operational filesystem failures are not made defects; F5 is a code violation of that rule, not a reason to weaken it.

### G6. Correct the shared reference's `catchDefect` description

The shared `references/errors.md`, under "Recovering", says "`catchCause`, `ignoreCause` and `catchDefect` also see defects and interruption". In 4.0.6 `catchDefect` is `catchCauseFilter(self, findDefect, f)`: a pure interruption passes through, and a probe of `Effect.interrupt.pipe(Effect.catchDefect(...))` returned an Exit containing only the interruption.

Replace the grouped sentence with:

> In 4.0.6, typed handlers (`catch`, `catchTag`, `catchIf`, `option`, `orElseSucceed`, `ignore`, `match`) go through `findRecoverableError`: if the cause holds any defect they re-raise only the defects, so a mixed Fail+Die cause is never recovered by a typed handler. `mapError` maps Fail reasons and keeps Die and Interrupt reasons. `catchDefect` recovers the first defect and drops any Fail or Interrupt reasons alongside it; a pure interruption passes through untouched. `catchCause` receives the full cause; `ignoreCause` discards it, defects and interruption included. Choose the operator by the outcomes the boundary owns.

Acceptance: examples distinguish a typed failure, a defect, pure interruption and a mixed cause; no example teaches `catchDefect` as a way to recover cancellation.

### Progressive disclosure and duplication

The shared skill has direct read triggers and substantive references. Its entrypoint is approximately 1,062 words, including lookup commands and the rename table. Move detailed version lookup and rename material into a directly linked reference so ordinary tasks can load a shorter routing guide.

Its resources reference combines acquisition, fibers, streams, mutable state, caching, retries and clocks. Separate state/caching and retries/time when that lets an agent load the relevant decision rules without unrelated sections. Keep direct routes for functions/interop, services/layers, errors, resources/concurrency, schemas, config/observability, testing, HTTP, SQL and CLI work; combined references are reasonable where their tasks usually overlap.

Keep repo-specific config, logger, output, trust and test contracts in the scoped rules. Do not import the separate API repo's conventions into this CLI; the inaccurate promise-rejection instruction found in earlier cross-repo research belongs to that API guidance and is not a stacks finding. The installed package's declarations and source remain the authority for release-sensitive behavior.

## Recommended work order

1. F1: discovery policy per "Absence rules", with real nested-project regressions for the permission case and the `.stacks`-is-a-file case.
2. F2: no record on a defect (decided), fixing `result` and `runStage`, verifying the persisted record, state timings and telemetry spool, not only the exit.
3. F5: per-errno mapping in submit, after settling what ENOSPC/`Unknown` become.
4. F4 and F6: the `mapError` replacement and the `NotFound`-only history default. Both are small.
5. F3: optional rollback details on the existing tags (decided), fixing both rollbacks, including `replaceProjectState` restoring through `replaceFile`.
6. Guidance: amend `.claude/rules/cli/effect.md` (G5, G4's absence rules, G2's writer requirement once F3 lands) and send G1–G4 and G6 to the `ce` repo as shared-reference changes. Keep code repairs and documentation changes as separate commits.

F2 option 3 and F3 option 2 would change shared contracts (`packages/format` and `errors.ts::errorTable`/`errorClasses` respectively); neither was chosen. F3 option 1 changes the closed details of existing tags in `errors.ts` and lands with the F3 fix.

Avoid broad conversion of existing generator wrappers to `Effect.fn`, indiscriminate Ref adoption, retries on commands whose contract specifies one request, or new error abstractions. Those changes would not repair the confirmed behaviors.

## Verification evidence

The temporary probe suite ran twice as evidence developed. The final run passed all eight checks on Vitest 5.0.5 under Node:

| Probe | Observed result |
| --- | --- |
| Typed failure plus finalizer defect through main | Correct Defect, exit 1; private message absent |
| Verification step adapter defects | CLI exit 1, but persisted history outcome green with the step skipped |
| Exclusive-write adapter defects | Incorrect PermissionDenied, exit 6 |
| Restore original bytes after directory becomes read-only | Replacement bytes remain; original input error only; no recovery warning |
| Submit writes into read-only assembly directory | Incorrect Defect, exit 1 |
| History path exists as a directory | Successful zero-run report |
| Nearest nested project's metadata is inaccessible | Ancestor verify command executes and returns green |
| Invalid stats dates | Correct typed schema failures |

Two probes injected a defect at the FileSystem adapter boundary to exercise unexpected-failure behavior. The permission, nested-project and history cases used real filesystem operations in temporary directories. The verification probe called the real `recordRun` and read the resulting JSONL file. No service implementation was changed to make a probe pass.

The focused existing suite passed 7 files and 142 tests:

```text
tests/errors.test.ts
tests/output.test.ts
tests/logging.test.ts
tests/cli.test.ts
tests/scaffold-write.test.ts
tests/runs.test.ts
tests/verify-stages-regressions.test.ts
```

Passing these tests establishes the current tested contracts; it does not negate the newly reproduced gaps. The probe suite intentionally asserted the observed faulty behavior to establish the audit evidence. Future regression tests must instead assert the corrected behavior and go red against the current implementation.

Temporary probes were removed after execution. Only this report is retained from the audit. No implementation fixes are included, and no full-gate result is claimed.

Two additional installed-API checks confirmed that `catchDefect` leaves pure interruption unhandled and that `Effect.cached` retains a defect across two evaluations of the same allocated cache. The review revision also read `effect@4.0.6`'s `internal/effect.ts` for `mapError`, `catchDefect`, `findRecoverableError` and `option`, and `@effect/platform-node-shared@4.0.6`'s `internal/utils.ts::handleErrnoException` for the errno mapping in "Absence rules".

## Review revisions

A devil's-advocate pass checked every finding and recommendation against the code and installed Effect source. All six findings held. Changes made from it: F2, F3, F4 and F6 severities lowered (F2 to P2, the rest to P3) with reachability stated; F1's fix changed to keep walking on `BadResource` so a `.stacks` file doesn't break discovery, and its trust-model framing corrected; F2's missed stage-level green, wrong skip reason and spooled telemetry added, with the recording decision made explicit; F3's visibility channel shown not to reach agents and turned into an explicit contract decision, the recovery-artifact idea dropped, and the `replaceProjectState` symlink-following restore added; F4's fix simplified to `mapError`; F5's realistic trigger and per-errno tags specified; F6's absence definition pinned to `NotFound`; the guidance section rebased on `94d0ace`, with line-number citations replaced by symbols and G3, G5 and G6 made concrete.

## Primary references

The inspected local `ce:handling-errors` entrypoint says repository-specific rules take precedence. The comparisons above use its principles of meaningful failures, deliberate degradation, single-owner logging and visible unexpected errors, rather than transplanting its generic examples literally.

Effect behavior was checked against the installed 4.0.6 package and release-matched source, supplemented by the previous primary-source research:

- [Effect constructors and combinators, 4.0.6](https://github.com/Effect-TS/effect/blob/effect%404.0.6/packages/effect/src/Effect.ts): typed failure, cause handling, resources, memoization and cancellation.
- [Release-matched agent guide](https://github.com/Effect-TS/effect/blob/effect%404.0.6/LLMS.md): Effect functions, services and topic-specific examples.
- [Error handling migration guide](https://github.com/Effect-TS/effect/blob/main/migration/error-handling.md): mixed causes and the distinction between recovery and mapping. This is moving documentation; the actual main-boundary behavior was also probed locally.
- [Forking migration guide](https://github.com/Effect-TS/effect/blob/main/migration/forking.md): lifecycle and result observation.
- [Layer memoization guide](https://github.com/Effect-TS/effect/blob/main/migration/layer-memoization.md): nested reuse, sibling builds and deliberate isolation.
- [Effect test examples, 4.0.6](https://github.com/Effect-TS/effect/blob/effect%404.0.6/ai-docs/src/09_testing/10_effect-tests.ts) and [shared-layer examples](https://github.com/Effect-TS/effect/blob/effect%404.0.6/ai-docs/src/09_testing/20_layer-tests.ts): virtual time and fixture lifetimes.
- [Agent Skills specification](https://agentskills.io/specification) and [authoring recommendations](https://agentskills.io/skill-creation/best-practices): direct reference routing and omission of generic material.
