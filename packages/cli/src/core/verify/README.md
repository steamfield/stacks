# core/verify

This folder is everything behind `stacks verify`: it runs a project's verify steps, the
project's definition of done, and reports whether the project is green. A coding agent runs
`verify` in a loop until it is, so this is the code that decides when the agent's work counts as
finished.

## How it fits

`commands/verify.ts` is the only caller. It finds the manifest (`core/manifest.ts::locateManifest`),
then hands off to this folder in a fixed order and writes the result through `Output`. The folder
depends on `core/manifest.ts` (digests), `core/project-state.ts` (the state record),
`core/scaffold/write.ts::openProject` (the one rewrite of the manifest, on `--accept-changes`)
and on the services `Processes`, `Output`, `Tcp` and `HttpClient`.

Verify is the only command that executes anything it reads, and it executes only the steps in
the project's own manifest (`.claude/rules/architecture.md`, "Trust model", point 1). Every child
process starts through `services/processes.ts::Processes`, with an environment built by
`AppConfig.childEnv` that leaves out agent markers and the CLI's own `STACKS_*` settings. Like
the rest of `core/`, nothing here imports `platform/` or `commands/` or uses Node process APIs.

## The flow of one run

1. `plan.ts::planVerify` orders the steps (base then app, each by phase) and applies `--only`,
   `--skip-tag` and `--all`. A bad `--only` name fails here, before anything else happens.
2. `tamper.ts::checkTamper` compares the steps with the digests recorded when the project was
   made (Trust model, point 5). If they changed, nothing runs: `tamper.ts::changedResult` builds
   a report with every step skipped, `record.ts::recordRun` records it, and the command fails with
   `VerifyChanged`. With `--accept-changes` from a person at a terminal, `tamper.ts::acceptChanges`
   records the new steps first and the run goes ahead.
3. `run.ts::runVerify` runs the base stage, then the app stage if the base was green. Each step
   goes through `step.ts::runStep`, with `events.ts` reporting it as it starts and finishes.
4. When the run ends, including by Ctrl+C, the run's finalizer calls `record.ts::recordRun`,
   which appends a run record and sets the state record's first-green time.
5. `report.ts::renderVerify` prints the result, ending with the `Next:` line from
   `next.ts::verifyNext` when the run isn't green.

## Files

| File | What it owns |
| --- | --- |
| `plan.ts` | Run order, selection flags and their skip reasons, and the shared shape of a skipped step |
| `tamper.ts` | The tamper check, `--accept-changes`, and the result of a run the check stopped |
| `run.ts` | The stages, phase order, setup-failure skipping, teardown in finalizers and interruption |
| `step.ts` | One step: the `cwd` check, running it with its timeout, serve steps and their probe race |
| `probe.ts` | Probe URL expansion and the loopback-only rule, readiness polling and port checks |
| `events.ts` | The `step-started` and `step-finished` live events |
| `record.ts` | The run record appended to `.stacks/state/runs.jsonl` and the first-green timings |
| `report.ts` | The text report for the human and agent audiences |
| `next.ts` | The fixed next-action sentence shared by the report and the error envelope |

## Terms

- **Phase**: when a step runs within its stage. `setup` prepares (install, start a database),
  `check` tests, `serve` starts a server and probes a URL, `teardown` cleans up. Setup stops at
  its first failure; every check runs; teardown runs from the stage's finalizer however the stage
  ended. `--only` never leaves out setup or teardown, but `--skip-tag` and the default skips can.
- **Stage**: `base` holds every step not tagged `app`; `app` holds the steps an application
  fragment added. The app stage runs only after a green base, since its checks assume one.
- **Scope**: `full`, or `partial` when `--only` or `--skip-tag` left steps out. A partial run is
  never green.
- **Skipped by default**: `hygiene`-tagged steps (fill markers, harness doc, CI, hooks) and `prod`
  steps in a `--sandbox` project. They run with `--all` or by name with `--only`, and leaving them
  out still counts as green.
- **Failure kind**: why a step failed. `env` means the machine lacks something (a missing
  command, an unset variable, a port already taken), `step` means the command failed, `timeout`
  and `interrupted` say what stopped it. A run whose failures are all `env` tells the agent to fix
  the machine, not the code.
- **Tamper check**: `full` when a state record for the project exists on this machine,
  `manifest-only` when it doesn't (the run still happens but can't count as fully checked).
- **Run record**: one JSON line per run in `.stacks/state/runs.jsonl`, the `RunRecord` shape from
  `@steamfield/stacks-format`. `stacks runs` and telemetry read these.

Recording never changes a run's outcome: a write that fails or is refused is a logged warning.

## Where to start

Read `run.ts::runVerify` first; it shows the whole run in order and links out to each step. Then
`step.ts::runStep` for what happens to a single command, and `tamper.ts::checkTamper` for why a
run can be refused. AGENTS.md ("Architecture map", the `src/core/verify/` entry) has the same
facts in brief.

Tests, all in `packages/cli/tests/`:

- `verify.test.ts`: the command end to end in all three audiences, exit codes and the report.
- `verify-stages.test.ts`, `verify-stages-regressions.test.ts`, `verify-stage-edge-cases.test.ts`:
  base and app stages.
- `verify-tamper.test.ts`, `verify-accept-writer.test.ts`: the tamper check and `--accept-changes`.
- `verify-probe.test.ts`: serve steps and probes.
- `verify-signals.test.ts`, `verify-interrupted-defect.test.ts`, `verify-defect-record.test.ts`:
  interruption, defects and what gets recorded.
- `verify-records.test.ts`, `runs.test.ts`, `runs-edge-cases.test.ts`: run records and timings.
- `verify-hygiene.test.ts`, `verify-qa-regressions.test.ts`: default skips and past bugs.
