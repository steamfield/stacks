# Phase 1.3b: Tamper detection and run records

Status: EXECUTED 2026-10-26, reviewed once and fixed, merged to main 2026-10-27
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | `verify` fails with `VerifyChanged` (exit 5) when the verify steps were changed since `new` recorded them, a person (never an agent) can re-record them with `--accept-changes`, and every verify run appends a `RunRecord` to `.stacks/state/runs.jsonl` and sets `firstGreenAt` and `firstTestPassAt` in the project state record |
| Traces to | "That is why `verify` exists, why the brief refuses to let the agent weaken a step" (Jobs, the trust paragraph); assumption 3, "`verify` is enough of a definition of done to keep an agent honest"; the time-pressure user's measure, "time to first passing test"; success row "It's faster than by hand" |
| Depends on | [1.3a](phase-1.3a-verify-runner-and-probes-2026-10-30.md) (`runVerify`, `VerifyResult`, the `onFinished` seam); through 1.3a, [1.2b](phase-1.2b-manifest-state-and-detection-2026-10-30.md) (`Manifest`, `digestSteps`, `ProjectState`, `AppConfig.agent`, `DetectedAgent`); [0.3a](phase-0.3a-errors-and-output-2026-10-30.md) (`Host.stdinIsTTY`) |
| Blocks | [1.6b](phase-1.6b-mvp-gate-runs-2026-10-30.md) (the gate needs `tamperCheck: "full"` and the timing fields), [2.0c](phase-2.0c-run-ledger-2026-10-30.md) (the ledger imports `RunRecord` unchanged), [3.0](phase-3.0-add-fragments-to-repo-2026-10-30.md) (runs the same tamper check first), [4.1a](phase-4.1a-telemetry-cli-client-2026-10-30.md) (event shapes build on `RunRecord`) |
| Decisions needed | D14 (changed steps fail rather than warn). If the maintainers choose "warn", the check still runs, the steps run, the result carries `changed` and outcome `changed`, exit is 0 with a warning, and `changed` still never counts as green or as first test pass. Open question 9 (a determined agent can still accept changes): if the answer is "not acceptable", `--accept-changes` needs a confirmation the agent can't produce, which is out of reach for a local CLI; record that and keep this design. D20 only as a reader: the gate requires `tamperCheck: "full"` |
| Settles | The tamper check's order and lookup; `VerifyChanged` details; `--accept-changes` behavior; the complete `RunRecord` v1; when `firstGreenAt` and `firstTestPassAt` are written |

## Where this fits

[1.3a](phase-1.3a-verify-runner-and-probes-2026-10-30.md) built the runner: `runVerify` takes a
decoded manifest and produces a `VerifyResult`, calling `onFinished(result)` inside the
finalizer that runs teardown. 1.3b adds what goes in front of it and after it: the tamper
check runs before `runVerify` and, when the steps changed, returns a `changed` result
without running anything; `onFinished` writes the run record and the state record's timing
fields, so interrupted runs are recorded too. `RunRecord` is the contract 2.0c's ledger
wraps and 4.0a later moves to `packages/format`.

## Scope

In:

- The D14 check, per [roadmap, Trust model](../../roadmap.md#trust-model) point 5, with the
  lookup rule below.
- `verify --accept-changes`, guarded per Trust model point 4.
- `VerifyChanged` details; `tamperCheck`, `changed`, `firstGreen`, `stateRecord` and the
  `changed` outcome added to `VerifyResult`.
- `RunRecord` with `schemaVersion: 1`, appended per run; `firstGreenAt` and
  `firstTestPassAt` in `ProjectState`.

Out:

- Defining `digestSteps` or `ProjectState` (1.2b owns both; this sub-phase only reads,
  compares and updates fields that 1.2b declared).
- Reading or aggregating `runs.jsonl` (`stacks runs`, 2.0c). The ledger (2.0c).
- `add`'s use of the same check (3.0). Any CI change.

## Design

### The tamper check

The digest's coverage (every field verify reads from each step, with defaults applied and
keys sorted, plus the manifest's `env` and `preset`) is defined once, in Trust model point
5 and `digestSteps` (1.2b). Before running anything:

1. **Manifest copy.** Recompute `digestSteps` over the decoded manifest and compare it with
   the manifest's stored digest. A mismatch is `changed` with `against: "manifest"`.
2. **State record, by id.** Read `ProjectState` for the manifest's `projectId`
   ([roadmap, Contracts: Project state record](../../roadmap.md#types-and-schemas)). Found:
   compare its digest. A mismatch is `changed` with `against: "state-record"`. A match
   gives `tamperCheck: "full"`.
3. **State record, by path.** No record for that id: scan the state directory's records
   for one whose manifest real path equals this manifest's real path (real paths, so macOS
   `/var` and `/private/var` compare equal). A record found by path under a different id is
   `changed` with `reason: "project-id"`: the likely cause is an edited `projectId` that
   tried to escape its record.
4. **No record at all** (fresh clone, another machine, `new` reported `stateRecord: false`,
   or an unreadable record, which [Schema versions](../../roadmap.md#schema-versions) treats
   as missing): only step 1 applies, and the result says `tamperCheck: "manifest-only"`.
   That still runs, but never passes the MVP gate (D20).

A `changed` result has every step `skipped`, runs nothing (not even teardown, since no
setup ran), and exits 5 with `VerifyChanged`. A record with a higher `schemaVersion` than
this CLI reads fails `InvalidConfig` per Schema versions; it is not silently downgraded to
manifest-only.

What the check can't catch is stated in Trust model point 5 (a project command turned into
a no-op) and the trust model's opening paragraph (an agent that edits the state directory).

### `VerifyChanged` details

```ts
// src/errors.ts, details for VerifyChanged
Schema.Struct({
  against: Schema.Literals(["manifest", "state-record"]),
  reason: Schema.Literals(["digest", "project-id"]),
  removed: Schema.Array(Schema.String),   // step names
  added: Schema.Array(Schema.String),
  edited: Schema.Array(Schema.String),
  settings: Schema.Boolean,               // env or preset changed
})
```

Naming which steps changed uses the per-step digests and the `env` plus `preset` digest
that 1.2b writes into `ProjectState` (`stepDigests`, `settingsDigest`). With them,
`removed`, `added`, `edited` and `settings` are exact. When they aren't available
(`against: "manifest"`), the lists are empty and the fixed message
says the steps changed without naming them. The same diff is the result's `changed` field.

### `--accept-changes`

For a person who changed the steps on purpose. It refuses with `PermissionDenied` when
`AppConfig.agent` is not `"none"` or `Host.stdinIsTTY` is false (Trust model point 4),
with `details: { reason: "agent" | "no-tty" }` (the roadmap's `PermissionDenied` details, `{ reason, path? }`), and changes nothing. Otherwise it:

1. Prints the diff (the `changed` details, or "steps changed, not itemized") to stderr.
2. Writes the recomputed digest into the manifest and into the state record for the
   manifest's `projectId`, creating the record if none exists (so a fresh clone becomes
   `full` once a person accepts it there), with the per-step digests above. A record found
   only by path under another id is removed. `createdAt`, `firstGreenAt` and
   `firstTestPassAt` keep their values: the project's timing starts at `new`, not at the
   last accepted change.
3. Runs verify normally against the accepted steps.

If the state record can't be written, accept fails `PermissionDenied` with
`details: { reason: "state-unwritable", path }` (the state record's path) after leaving the manifest unchanged, so the two
copies never disagree because of a half-done accept.

### Run records

Every run that reaches the runner or the tamper check, including `changed`, `failed` and
`interrupted` ones, appends one line to `.stacks/state/runs.jsonl` (ignored by the
project's `.stacks/.gitignore`; [roadmap, Other shared facts: Project
metadata](../roadmap.md#other-shared-facts)). `NotFound` and `InvalidConfig` runs have no
project to record into and append nothing.

```ts
// src/schemas/verify.ts
export const RunStep = Schema.Struct({
  name: Schema.String,
  phase: Phase,
  layer: Schema.optional(Layer),
  status: Schema.Literals(["passed", "failed", "skipped"]),
  failureKind: Schema.optional(FailureKind),   // 1.3a: step | env | timeout | interrupted
  exitCode: Schema.optional(Schema.Number),
  durationMs: Schema.Number,
});

export const RunRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  at: Schema.String,                           // ISO start time, from Clock
  cli: Schema.String,                          // CLI version
  agent: DetectedAgent,                        // AppConfig.agent: AgentId | "other" | "none"
  outcome: Schema.Literals(["green", "partial", "failed", "changed", "interrupted"]),
  scope: Schema.Literals(["full", "partial"]),
  tamperCheck: Schema.Literals(["full", "manifest-only"]),
  acceptedChanges: Schema.Boolean,             // this run began with --accept-changes
  durationMs: Schema.Number,
  secondsSinceCreated: Schema.Number,
  steps: Schema.Array(RunStep),                // every step, skipped ones included
});
```

Rules, so 2.0c can import it unchanged:

- Green is `outcome: "green"`, which already implies `scope: "full"` and an unchanged
  digest. `partial` and `changed` never count as green. 2.0c decides how to treat
  `tamperCheck: "manifest-only"` greens; the gate (D20) rejects them.
- `layer` is carried so time to first passing test and D7 coverage can be computed from
  the record alone.
- No commands, output, paths, env values or reasons are recorded, so the file is safe to
  attach to a bug report and safe for 4.1a to build on.
- Readers skip and count a line with a higher `schemaVersion` or one that fails to decode
  ([roadmap, Schema versions](../../roadmap.md#schema-versions)). A new optional field doesn't
  bump the version.

Writing: `onFinished` encodes the record and appends it as one line with a single write.
If the state directory can't be created or the append fails, verify logs one warning and
its outcome and exit code are unchanged.

### Timing fields in the state record

After appending the run record, `onFinished` updates the `ProjectState` found in the
tamper check (so only when `tamperCheck` is `"full"`; a manifest-only project has no
record to update, and 1.6b's gate runs need a record anyway):

| Field | Written when | Never overwritten |
|---|---|---|
| `firstGreenAt` | The first run with outcome `green` | Yes |
| `firstTestPassAt` | The first run, of any scope, in which a step with `layer: "test"` passed, outcome not `changed` | Yes |

Time to first passing test counts partial-scope runs (decided here): a test that passed
under `--only test` is still the first passing test, which is the problem statement's
measure. Time to green stays the stricter target ([roadmap, Measurement and the
canary](../roadmap.md#measurement-and-the-canary), open question 22). The result's
`firstGreen` is true on the run that wrote `firstGreenAt`. The state record write follows
the same failure rule as the run record.

### Settled here

| Question | Answer | Why |
|---|---|---|
| A record found only by path | `changed` | An edited `projectId` is the cheapest way to dodge the second copy |
| Accept on a fresh clone | Creates the state record | A person at a terminal has confirmed the steps; later runs can be `full` |
| `firstTestPassAt` scope | Any scope | It records completion of the first run with a successful test-layer command. It cannot observe test counts or distinguish arbitrary no-ops; shipped conditional hook checks use the check layer (QA-09). |
| Reasons and output in records | Never | Records must be safe to share and to send later |

## Files and areas touched

| Path (under `packages/cli/`) | Change |
|---|---|
| `src/core/verify/tamper.ts` | Check, lookup by id then path, diff, accept |
| `src/core/verify/record.ts` | `onFinished`: run record append, timing fields |
| `src/core/project-state.ts` | Lookup by manifest real path; timing field updates (1.2b owns the schema) |
| `src/schemas/verify.ts` | `RunStep`, `RunRecord`; `VerifyResult` gains `tamperCheck`, `changed`, `firstGreen`, `stateRecord`, outcome `changed` |
| `src/errors.ts` | `VerifyChanged` `details` (tag and row are 0.3a's); `PermissionDenied` reasons |
| `src/commands/verify.ts` | `--accept-changes` |
| `tests/verify-tamper.test.ts`, `tests/verify-records.test.ts` | New |
| `e2e/verify.test.ts` | One tamper case against the built artifact |

## Acceptance tests

1. A fresh `new` fixture project: `verify` reports `tamperCheck: "full"`, and
   `runs.jsonl` gains one line that decodes as `RunRecord` and contains no command text.
   Run under `AI_AGENT=foo`, the line has `agent: "other"` and encodes without error.
2. Editing one step's `run` in the manifest fails `VerifyChanged`, exit 5, with that step
   in `edited`, no step run, and a `changed` run record.
3. Editing the step and the stored digest together still fails, `against: "state-record"`.
4. Editing a step's `timeout`, `skipByDefault`, `tags` or `expect` (its `http` URL or its
   `within`), the manifest `env`, or `preset` each fails `VerifyChanged` (digest coverage,
   checked end to end; removing the `app` tag from an app step is one of the `tags` cases).
5. Deleting the state record gives `tamperCheck: "manifest-only"` and a green run with no
   `firstGreenAt` written.
6. Changing `projectId` in the manifest (and its digest) while the old record exists
   fails `VerifyChanged` with `reason: "project-id"`.
7. A state record with `schemaVersion: 2` fails exit 3; a record with invalid JSON is
   treated as missing.
8. `--accept-changes` with any `AgentMarkers` entry set (including `AI_AGENT=foo`, which
   is `"other"`), or with `stdinIsTTY: false`, exits 6 with the right `reason` and changes
   neither file.
9. `--accept-changes` from a TTY with no agent: prints the diff, rewrites both digests,
   keeps `firstGreenAt`, runs the steps, and the run record has `acceptedChanges: true`;
   the next plain `verify` is `full`.
10. Interrupting a run during a `sleep` step appends a record with outcome `interrupted`.
11. First green writes `firstGreenAt` and the result says `firstGreen: true`; a later
    green leaves it unchanged.
12. A failing full run in which the `test`-layer step passed writes `firstTestPassAt`;
    `--only unit` passing does too on a fresh project; a `changed` run never does.
13. With `.stacks/state/` unwritable, verify's outcome and exit are unchanged and one
    warning is logged.
14. e2e: the built artifact fails `VerifyChanged` on a fixture manifest with an edited step.

## Exit criteria

- All tests above pass; `bun run check` green from the repo root.
- `AGENTS.md` documents `VerifyChanged`, `--accept-changes` and `.stacks/state/`;
  `packages/cli/README.md` documents the flag and the run record file.
- `RunRecord` matches the roadmap's Run record row and Schema versions row, and
  `RunRecord.agent` is the shared `DetectedAgent`.

## What this plan may get wrong

- `--accept-changes` keyed on a TTY assumes agents' shell tools don't allocate one. Some
  may; the agent-marker half is the stronger one and is checked against each supported
  agent in 1.6b's gate runs (open question 9).
- `XDG_STATE_HOME` may not be writable in the sandboxes where tamper detection matters
  most. If 1.6b's gate runs often end `manifest-only`, the second copy needs another home.
- Scanning every state record by path is linear in the number of projects. Fine for
  hundreds; an index file is the fix if it ever isn't.
- Counting partial runs for `firstTestPassAt` may flatter the measure when an agent runs
  one quick test early. The record keeps scope and step layers, so 2.0c can recompute a
  stricter version without a schema change.

Found while executing it (2026-10-26):

- **Itemizing against the manifest.** The plan empties `removed`/`added`/`edited` whenever
  `against: "manifest"`, but acceptance test 2 (edit one `run`, leave the digest) is exactly
  that case and expects the step in `edited`. The lists now come from the state record's
  per-step digests whenever a record was found, whichever copy disagreed; they are empty only
  with no record (manifest-only). `against` still names the copy that disagreed first.
- **`stateRecord` in `VerifyResult`** was named but not defined. It means the state record is
  current after the run: a record was found by id (or created by `--accept-changes`) and any
  timing field the run set was written. False for manifest-only, for a record found only by
  path, and when the timing write failed.
- **`changed` in the result** is present on a `changed` run and also on an
  `--accept-changes` run that accepted a change, so a JSON caller sees what it accepted.
- **The accept diff goes through `Output.progress`**, so it prints in text modes only;
  `--json` keeps stderr for the envelope, and the result's `changed` carries the same diff.
- **Accept order.** The state record is written first, then the manifest's `verifyDigest`
  (only when it differs). A manifest that can't be written fails `PermissionDenied`
  (`write`) and the previous record is put back (or the new one removed), so a half-done
  accept leaves both copies as they were. `--accept-changes` checks the agent and the TTY
  after the manifest is found and read, so outside a project it is still `NotFound`.
- **An unknown `--only` name** is checked before the tamper check, so it exits 2 and appends no
  run record, like `NotFound` and `InvalidConfig`.
- **The run record writer** appends with plain `FileSystem` rather than `scaffold/write.ts`
  (which creates files exclusively and has no append). It refuses to write when
  `.stacks/state/` resolves outside the project (a link), with one warning.
- **`runVerify`'s seam** now hands `onFinished` a `RunResult` (the result without the four
  tamper fields, never outcome `changed`); the command adds `tamperCheck`, `changed`,
  `firstGreen` and `stateRecord`. A `changed` result is built by `tamper.ts::changedResult`
  with every step skipped, its scope from the selection flags.
- **`RunStep.exitCode`** is present on passed steps too (exit 0), as in `StepResult`.
- **PermissionDenied wording** for `agent` and `no-tty` is generic ("This needs a person's
  confirmation"), since `stacks trust` and source confirmation (3.2a) share the reasons.

Found in review (2026-10-26):

- **Timing fields from a stale snapshot.** `recordRun` wrote the state record the tamper check
  had read before any step ran, so a concurrent `--accept-changes` had its digests put back
  (the next run a false `VerifyChanged`) and two concurrent runs could each set
  `firstGreenAt`. It now reads the record again right before saving: one whose `verifyDigest`
  differs from the one this run was checked against (or that is gone) is left alone, with
  `firstGreen` and `stateRecord` false, and each timing field is set only if still null in the
  fresh copy. A small window between that read and the rename remains; it would need a lock.
- **Run records through a link.** The writer checked only `.stacks/state/`'s real path, so
  a `runs.jsonl` that was itself a symlink (or a hard link) got the line appended to its
  target, and `state/` was created before the check, so a `.stacks/` linked out of the
  project got a `state/` directory outside it. `.stacks/` is now checked before anything
  is created, and an existing `runs.jsonl` must be a regular file with one link; either
  refusal is the same one warning. lstat-then-append is not atomic; this covers links left
  in place, not one swapped in during the run.
- **Half-done accept on interrupt.** The state record save, the manifest write and the
  rollback in `acceptChanges` now run uninterruptibly, so a Ctrl+C between the two writes
  takes effect after both (or the rollback) finish, never with the copies disagreeing.
