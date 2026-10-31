# stacks — demo preparation

Status: DRAFT 2026-10-28 — rehearsal checklist for discovery to a verified local starter. Unchecked items are tasks, not completed capabilities.

## Finish line

One request leads to an explained stack choice, an inspectable brief, an agent-built local starter, full green verification, and a useful example. The website explains the same choice with qualified evidence.

Use [PITCH.md](PITCH.md) for messaging and [DEMO_OUTLINE.md](DEMO_OUTLINE.md) for the 4:45 recording. Rho is an optional minimal read-only sandbox connection. Transaction-review features and application deployment are outside scope.

## 1. Freeze the release and scope

- [ ] Read [product constraints](PROBLEM_STATEMENT.md) and the [quick start](../packages/cli/docs/quickstart.md).
- [ ] Record the CLI version, source revision, OS, agent/model, and exact commands.
- [ ] Confirm Node 22+ and the selected stack's tools. Python + React currently names uv, bun, make, git, and jq.
- [ ] Choose an installed release or source build deliberately; do not mix their behavior.
- [ ] Use the current name `stacks`, package `@steamfield/stacks`, and generated path `.stacks/`.
- [ ] Make the local starter the required result and time-box the optional Rho example.

## 2. Rehearse discovery

The handoff identifies an API/format 0.4.0 transition and API evidence still needing work. Features on main are not automatically published or deployed.

- [ ] Run `stacks search "Python API and React dashboard" --kind stack --limit 3 --json`.
- [ ] Record ranking source, remote status, matched fields, caveats, and available evidence.
- [ ] Confirm the installed client decodes the deployed response; recognize local fallback.
- [ ] Check that the selected match fits the request. Do not silently substitute a weak match.
- [ ] Run `stacks show python-react --json` and inspect requirements, tools, fragments, and checks.
- [ ] Capture the agent's actual evidence reads and explanation, including one tradeoff.
- [ ] Distinguish historical ledger passes, current-fingerprint evidence, and seeded outcome statistics.
- [ ] If remote evidence is missing, say so and use inspectable metadata rather than invented confidence.

Fit determines relevance. Project counts do not raise search scores. Evidence can distinguish near-ties; a person viewing a chart is not proof the agent read it.

## 3. Confirm website provenance

- [ ] Inspect the [homepage](https://stacks.steamfield.io/), [selected stack](https://stacks.steamfield.io/stacks/python-react/), trending view, and API status.
- [ ] Confirm the deployed data source with the maintainer. The October 28 handoff says production uses seeded history.
- [ ] Keep sample-data labels visible in analytics footage until real provenance is confirmed, even if a page omits a prominent label.
- [ ] Record computation date, through-date, interval, and sample for metrics used.
- [ ] Check the ledger panel separately; Python + React displayed no ledger run during the October 28 inspection.
- [ ] Choose one useful comparison instead of touring every chart.
- [ ] Find a working dependency-trend view before promising that scene.
- [ ] Separate the scripted homepage interaction from the actual agent build.
- [ ] Treat the four-hour baseline as illustrative and time-to-green medians as conditional on success.

| Evidence | Supports | Does not establish |
| --- | --- | --- |
| Match and recipe metadata | Suitability and an explained choice | Guaranteed success |
| Historical ledger run | A dated configuration passed | A changed recipe passes |
| Seeded charts | Analytics and comparison workflow | Community adoption or reliability |
| Recorded full green run | Declared checks passed here | Universal application correctness |
| Real sandbox response | Demonstrated read-only connection | Payments or production readiness |

## 4. Build from a fresh directory

Use a new destination outside this repository. Commands assume the chosen release is available as `stacks`; the quick start also documents npx.

```sh
stacks new python-react stacks-demo --sandbox --dry-run --json
stacks new python-react stacks-demo --sandbox --no-launch --json
```

- [ ] Inspect the preview, then scaffold the new project.
- [ ] Record the actual sandbox fragments and checks, not assumed full-project defaults.
- [ ] Have the agent read `.stacks/BRIEF.md` and implement it; preserve manifest and notes.
- [ ] Follow one requirement into code and a meaningful assertion.
- [ ] Verify a real frontend-to-API interaction rather than only a startup message.
- [ ] Record problems and interventions honestly; do not manufacture an unstaged failure.

## 5. Prove completion

From the generated project:

```sh
stacks verify --all
stacks runs
```

- [ ] Confirm full green status and that every required step ran; exit 0 alone can mean a partial run.
- [ ] Inspect assertions and ensure checks were not weakened or replaced by no-ops.
- [ ] Show the starter working after verification.
- [ ] In a disposable copy, change a recorded verification command and capture refusal.
- [ ] Label that controlled example and return to the unchanged successful project.
- [ ] Record scaffold duration, time to first green, verify runs, and interventions separately.
- [ ] Compare the run report's intervention count with the recording.

Command-change detection protects recorded commands; it does not guarantee meaningful assertions.

## 6. Optional Rho connection

- [ ] Verify credentials and a documented read-only sandbox endpoint.
- [ ] Add one small example and a meaningful test. Call it an API client unless an official SDK is verified.
- [ ] Keep credentials out of code, logs, and footage; redact the successful response.
- [ ] Label the sandbox or fixture source. Fixtures do not prove a live connection.
- [ ] If unreliable, use the local starter example and describe Rho as a next step.

Do not add thresholds, duplicate detection, payments, or deployment. Confirm track eligibility separately.

## 7. Retain the evidence

| Record | Rehearsal value |
| --- | --- |
| CLI version and source revision | Pending |
| Agent and model | Pending |
| Stack, preset, fragments, fingerprint | Pending |
| API/local ranking and evidence available | Pending |
| Website dataset and observation date | Pending |
| Scaffold duration | Pending |
| Time to first full green | Pending |
| Required / passed / failed / skipped steps | Pending |
| Verify runs and manual interventions | Pending |
| Rho or local-example fallback | Pending |

Report this run's measured duration. A speedup requires an equivalent bare-agent baseline with the same task, model, checks, credentials, and conditions. Count authoring effort separately, retain failures, and do not substitute seeded medians.

## 8. Record and submit

- [ ] Preserve the actual agent session and uncut footage.
- [ ] Keep the stack name consistent across search, brief, site, and project.
- [ ] Label acceleration, controlled examples, prebuilt portions, and sample data.
- [ ] Fit graphics and transitions inside 4:45; check readability, captions, and audio.
- [ ] Confirm deadline, timezone, video limit, edited-upload acceptance, and submission requirements.
- [ ] Check Loom account support and leave processing/submission time.
- [ ] Test share permissions and links from a signed-out session.
- [ ] Provide the demonstrated revision, reproduction commands, and permitted private-code access if required.
- [ ] Keep the catalog, agent session, starter, and a local video ready for the live table.

## Ready-to-record gate

Record when the chosen release reproduces the starter, full checks pass without weakening, data is correctly labeled, and the recommendation reflects what the agent actually read. Reduce the script to the working scope if any condition fails.
