# Phase 3.5b: App stage in verify

Status: EXECUTED 2026-10-27 (base then app stages in `verify`, stage lines, the app `Next:`
line; reviewed once and fixed). The bench proofs wait on 2.0b's real runs. Shrunk 2026-10-26 by the amended D18 (D26
superseded): 1.1 now writes one brief with "Definition of done: base" and "Then: the
application" sections, and app steps carry the reserved `app` tag, so there is no
separate app brief file, no `new <app>`, no `ManifestStep.stage` and no manifest version
2. What remains here: verify reports the `app`-tagged steps as their own stage and runs
them only after every base step passes, the per-stage run-record field, and a bench proof
for each bundled app with a stub provider. Body rewritten to match 2026-10-26
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | In a project composed with an app, `verify` runs the base steps first and the app's steps only once every base step passes, reports each stage's outcome, and records both in the run record; each bundled app is proved by a bench run whose tests need no model-provider key |
| Traces to | The developer who starts projects often: "I want it set up the way I'd set it up myself"; assumption 1 (brief size): splitting a brief into a base and an application is the other tool against brief growth besides the budget; the coding agent's frustration with "ambiguity" |
| Depends on | [1.1](phase-1.1-composition-and-brief-2026-10-30.md) (apps as `category: app` fragments, the `app` tag, the split brief), [1.2b](phase-1.2b-manifest-state-and-detection-2026-10-30.md) (the manifest and `digestSteps`, which covers tags), [1.3a](phase-1.3a-verify-runner-and-probes-2026-10-30.md) (the step runner, `VerifyResult`), [1.3b](phase-1.3b-tamper-detection-and-run-records-2026-10-30.md) (the tamper check and `RunRecord`), [1.5](phase-1.5-validate-and-brief-budget-2026-10-30.md) (app budgets and checks), [2.0b](phase-2.0b-bench-2026-10-30.md) (the bench run that proves each app), [2.0c](phase-2.0c-run-ledger-2026-10-30.md) (the ledger) |
| Blocks | Nothing. [3.3b](phase-3.3b-bundled-stack-expansion-2026-10-30.md) may move a stack's slice into an app when it won't fit D5 |
| Decisions needed | D18 as amended (apps are fragments). D5 as amended: an app body 3,000 words and a composed brief with an app 9,000, which 1.5 enforces (`budget.ts::BUDGET`). D14 unchanged: app steps and their `app` tag are in the digest |
| Settles | How verify orders and reports the two stages; the run record's `stages`; how app proofs are keyed in the ledger |

## Scope

In:

- `verify` stages in a project whose manifest has `app`-tagged steps: base first, app
  only after every base step passes, both reported.
- `VerifyResult.stages` and the optional `RunRecord.stages`.
- The human `Next:` line for "base green, app not yet".
- A bench proof for each bundled app, with tests that use a stub provider.

Out:

- Composing apps, the split brief, the `app` tag, `--sandbox` dropping apps and the
  one-app rule (1.1). App budgets and app checks in `validate` (1.5).
- Writing the bundled apps (1.6a).
- Model-provider credentials in any verify step. A bundled app's real-provider smoke step
  is tagged `prod`, skipped by default and under `--sandbox`.
- An app id on telemetry events. Events name the stack and its `with` list; a separate
  `app` field needs a metric that reads it and a telemetry schema version, so it waits
  until app usage is worth measuring.
- Any CI wiring (D23).

## Design

### Where this fits

1.1 composes an app as the last fragment, tags its steps `app`, and splits the brief:
the base section tells the agent to reach `verify --skip-tag app` with every base step
passing (a `partial` run), and the application section takes it to a full green. That
works today with 1.3a's runner, but a plain `verify` runs base and app steps together, so
an agent that starts the app early sees app failures mixed with base ones. This
sub-phase makes the ordering part of verify, so a broken app slice is never confused
with a broken base.

### Stages

A manifest step is in the `app` stage when its `tags` include `app`, and in the `base`
stage otherwise. The stage comes from the tag, which `digestSteps` already covers, so the
manifest needs no new field and stays at `schemaVersion: 1`; removing the tag from a step
is a changed step and fails `VerifyChanged` (1.3b).

A project without app steps behaves exactly as in 1.3a, and its result has no `stages`.

### Verify by stage

1. The base stage runs in 1.3a's phases (setup, check, serve, teardown).
2. If any base step fails, every app step is `skipped` (reason `base-failed`) and the
   outcome is `failed` as usual.
3. If every base step passes, the app stage runs its own setup, check, serve and teardown
   phases after the base teardown.
4. `green` needs both stages green and scope `full`. `--skip-tag app` still works and
   gives scope `partial`, which is what 1.1's base section asks for.

`VerifyResult` gains the optional
`stages: { base: Outcome, app: Outcome | null }`, present only when the manifest has app
steps; `app` is `null` when the app stage didn't run (base failed, or `--skip-tag app`).
Human mode prints one line per stage before the usual summary. When the base is green and
the app stage failed, the `Next:` line points at the application section of
`.stacks/BRIEF.md` rather than the generic failure line.

### Run records and the ledger

`RunRecord` gains the same optional `stages` field; new optional fields don't bump the run
record's version (roadmap, Schema versions). `firstGreenAt` keeps meaning the whole
project. Time to a green base is read from the first run record whose `stages.base` is
`green`; its reader is 2.0b's run note, which records it beside the whole run's
`minutesToGreen` (2.0c's ledger, `runs` and 4.1a's telemetry keep only the whole-run
outcome, and 4.0a moves `RunRecord` with the field). So the state record gains no field (it follows the manifest's version rule, and
1.2b declared no such optional field).

An app is selected with `--with`, so an app run's `LedgerKey` already names it in `with`;
the ledger key gains no `app` field. 2.0b proves an app with
`bench <stack> --with <app>`.

### Proving each bundled app

Under [3.3a's proof rule](phase-3.3a-release-and-deploy-fragments-2026-10-30.md#the-proof-rule-for-a-bundled-entry),
with these additions:

- The app's model-provider calls go through one provider interface with a stub
  implementation selected by environment. The app's tests and its `serve` step's
  `expect` use the stub, so verify needs no key and makes no network call.
- A `prod`-tagged smoke step calls the real provider when a key is present and is skipped
  by default and under `--sandbox`.
- The run note checks the proving slice by hand: send a message, see a streamed reply from
  the stub, and the app's own tests at each layer it declares.
- The record is a `pass` with `with` holding the app and `stages` green for both stages.

### Trust

Nothing changes in the trust model. The CLI still runs nothing it reads (point 1); verify
runs only manifest steps, in a different order. An untrusted app is reported like any
untrusted fragment (1.1).

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/core/verify/` | Stage ordering, `stages` in the result, the base-green `Next:` line |
| `packages/cli/src/schemas/verify.ts` | Optional `stages` on `VerifyResult` and `RunRecord` |
| `packages/cli/tests/verify-stages.test.ts`, fixtures | New |
| `packages/cli/registry/fragments/<app>/` for each bundled app | Fixes from bench runs |
| `packages/cli/registry/runs.json`, `plans/runs/` | One bench record and note per app |
| `packages/cli/README.md`, repo `AGENTS.md` | Stages in verify |

## Acceptance tests

1. A fixture project composed with an app fixture: base steps failing gives every app step
  `skipped` with reason `base-failed`, `stages.app: null`, outcome `failed`.
2. Base green and an app step failing: outcome `failed`, `stages.base: "green"`, and the
  human `Next:` line names the application section of `BRIEF.md`.
3. Both green: outcome `green`, `firstGreenAt` set, and the run record's `stages` holds
  both.
4. `verify --skip-tag app` with the base green: outcome `partial`, `stages.app: null`.
5. A project without app steps: the result and run record have no `stages`, and every
  existing 1.3a and 1.3b test passes unchanged.
6. Removing the `app` tag from an app step in the manifest fails `VerifyChanged` naming it.

### Realistic edge cases

7. Interleaved manifest steps run each stage's setup, checks, serve and teardown in order, with base teardown finished before app setup.
8. A failed base setup or teardown skips every app step with `base-failed`, while base teardown still runs and user files survive.
9. A failed app setup skips later app setup and checks, runs app teardown once, and preserves the base's green outcome.
10. A base-only run followed by an app failure and a successful rerun appends distinct stage records; only the full green sets `firstGreenAt`.
11. From a nested cwd through a symlink to a project with spaces and non-ASCII text in its path, both stages run in the project and record their outcomes there.
12. Under an agent marker, both stages receive the same captured environment with agent markers stripped, and the run record still names the detected agent.
13. Interrupting either stage stops its child, runs that stage's teardown once, preserves user files, and records the stage outcomes without starting the app after a base interruption.

**Proof (bench runs, not traced)**

Each bundled app's tests, run in its own verify, pass with no provider key in the
environment and no outbound network (the test layer blocks non-local hosts). The ledger
holds a `pass` record for each bundled app, `with` including it, from a 2.0b bench run.

## Exit criteria

- Acceptance tests pass; `bun run check` green from the repo root.
- One green bench run per bundled app recorded with its note, or this file's status line
  lists which aren't and why.
- The roadmap's Run record row says 3.5b adds `stages` only.

## What this plan may get wrong

- Agents may start the app before the base is green despite the brief. Stage ordering
  keeps the result honest; the bench notes show whether the brief's wording needs work.
- The stub-provider rule proves the app's plumbing, not the provider integration. The
  `prod` smoke step is where that lives, and it runs only by hand.
- Running app setup after the base teardown assumes app steps don't depend on a base
  server still running. If an app's `serve` step needs the base's server, the app has to
  start it in its own stage; if that is common, the base serve steps should stay up
  through the app stage instead.
- 2026-10-26: this plan first built on a separate `app` entry kind (3.5a), wrote a second
  brief file at `new <app>`, added `ManifestStep.stage` and `Manifest.app` (manifest
  version 2), keyed the ledger by an `app` field, recorded `firstStackGreenAt`, and added
  its own `app-budget` and `app-layers` checks around one bundled app. The amended D18
  made apps `category: app` fragments composed by 1.1, which also owns the split brief,
  and the `app` tag gives verify its stages without a manifest field. App checks are
  1.5's, the ledger's `with` already names the app, and time to a green base is read from
  run records instead of a new state field. "Stack stage" became "base stage", matching
  1.1's brief.
- 2026-10-27: stage outcomes need selection and tamper semantics too. A tamper-stopped
  run with app steps reports `{ base: "changed", app: null }`. Selection skips make the
  affected stage `partial`, while default skips still allow `green`, matching verify's
  existing preset behavior. The app starts only after a green base; selection that leaves
  the base partial skips app steps with the fixed reason "the base did not fully run; the
  app stage waits for a full verify". `base-failed` is reserved for a failed or interrupted
  base. A run interrupted in a stage (including during teardown) records that stage as
  `interrupted`, tears down only started stages, and leaves an unstarted app `null`.
