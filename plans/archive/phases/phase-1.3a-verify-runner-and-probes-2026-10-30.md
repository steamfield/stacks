# Phase 1.3a: `verify` runner and probes

Status: EXECUTED 2026-10-26, reviewed once and fixed, merged to main 2026-10-27. Revised 2026-10-26 for
the amended D18: a serve step's probe is `expect: { http, within }`, and built-in file checks
are out of v1 (an open additive item below)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | `stacks verify` finds the project's manifest, runs its steps in phases with per-step timeouts, probes dev servers and catches ones that background themselves, always runs teardown, and returns one result an agent can act on, with `VerifyFailed` (exit 5) when a step fails |
| Traces to | "When I'm an agent asked to set up a project, I want a target I can verify against, so I know when I'm done" (job 5); success rows "The agent finishes without help", "It's faster than by hand", "The result is complete"; assumption "`verify` is enough of a definition of done to keep an agent honest" |
| Depends on | [1.2b](phase-1.2b-manifest-state-and-detection-2026-10-30.md) (the manifest, `Manifest`, `ManifestStep`, `AgentMarkers` and `childEnv`'s marker list), [0.3b](phase-0.3b-processes-and-signals-2026-10-30.md) (`Processes`, `TAIL_BYTES`/`TAIL_LINES`, `childEnv`, the signal policy, `src/platform/`), [0.3a](phase-0.3a-errors-and-output-2026-10-30.md) (error table, `VerifyFailed` on exit 5, keeps-result failures, `Output.progress`) |
| Blocks | [1.3b](phase-1.3b-tamper-detection-and-run-records-2026-10-30.md) (tamper check and run records wrap this runner); through 1.3b, [1.6b](phase-1.6b-mvp-gate-runs-2026-10-30.md) |
| Decisions needed | Open question 10 (probes limited to local hosts). If the maintainers allow other hosts, the host check below is removed and `validate` (1.5) gains a warning instead; nothing else changes. D7 only through 1.5: the runner treats `layer` as a label |
| Settles | Phase semantics; step timeouts and their reporting; probe behavior, including self-backgrounding serve commands and servers left running; the step environment; selection flags and what counts as `partial`; `StepResult`, `VerifyResult` and `VerifyFailed`'s `details` |

## Where this fits

1.3a is the runner: given a decoded manifest, run the steps and produce a `VerifyResult`.
[1.3b](phase-1.3b-tamper-detection-and-run-records-2026-10-30.md) puts the D14 tamper check in front
of it (a changed manifest never reaches the runner) and records every run after it. 1.3a
hands 1.3b two seams: `runVerify` takes the already-checked manifest, and it calls an
`onFinished(result)` effect inside the same finalizer that runs teardown, so 1.3b's run
record is written after interrupted runs too. Until 1.3b lands, `onFinished` is a no-op and
`verify` runs without a tamper check; 1.3a alone is not releasable, and both land before
[1.6b](phase-1.6b-mvp-gate-runs-2026-10-30.md).

## Scope

In:

- `verify [--only a,b] [--skip-tag t] [--all] [--json]`, run from the project root or any
  directory below it (walks up to the nearest `.stacks/manifest.json`).
- Phases `setup`, `check`, `serve`, `teardown`; `VerifyStep.timeout`; `expect.http`
  probes with the local-host rule, port-in-use detection, early-exit and left-running
  detection.
- The step environment through `childEnv`, with agent markers removed.
- Live progress on stderr in human mode; one result on stdout in both modes.
- `StepResult`, `VerifyResult`, `VerifyFailed` details.

Out:

- The tamper check, `--accept-changes`, `VerifyChanged`, run records, `firstGreenAt` and
  `firstTestPassAt` (all 1.3b).
- Parallel steps. Steps run one at a time; parallelism changes failure output and port use
  and there is no evidence it's needed.
- Sending anything anywhere (4.1a). Aggregating runs (`stacks runs`, 2.0c).
- Any CI change. The new tests run in the existing `check` job with no workflow change;
  extra CI jobs are [5.0](../../phases/phase-5.0-ci-release-and-checks.md).

## Design

### What runs

Verify runs only the steps in the manifest of the project it was pointed at, printing each
command before running it ([roadmap, Trust model](../../roadmap.md#trust-model), point 1).
Human mode prints `> <name>: <command>` through `Output.progress`; JSON mode carries the
command in the step's result.

### Phases

| Phase | Runs | On failure |
|---|---|---|
| `setup` | In order. Installs, migrations, one-shot commands that exit; never a long-lived process (see below) | Skip remaining setup, check and serve steps (status `skipped`); go to teardown |
| `check` | In order. Lint, typecheck, test, build | Keep going: report every failing check, so the agent fixes several things per loop |
| `serve` | Each step: start the command in its own process group, wait for its `expect` probe, stop the group, confirm the port closed | Keep going to the next serve step |
| `teardown` | Always, even after a failure or an interrupt | A failing teardown step fails the run; it never hides an earlier failure |

Continuing through `check` failures is deliberate: an agent loop that sees one failure at a
time takes more iterations, and each costs minutes.

Only `serve` steps may run long-lived processes, because only they run through
`Processes.start` inside a scope that owns the group and stops it. `setup`, `check` and
`teardown` steps run through `Processes.run`, which ends the step when its shell exits.
A step that needs a database starts it with a command that daemonizes outside the step's
process group and returns (`docker compose up -d`), and a `teardown` step stops it
(`docker compose down`). A setup step that leaves a child of its own behind is cut off by
the drain rule below; the brief (1.1) tells the agent services start detached in setup and
stop in teardown.

### The step environment

Every `run` step gets an environment built by `childEnv` ([roadmap, Contracts: Child
environment](../roadmap.md#types-and-schemas)): the environment `config.ts` captured, with
every agent session marker in `AgentMarkers` removed, overlaid by the manifest's `env` for
keys not already set, so a user can move a port with `PORT_WEB=5187 stacks verify`.
Nothing is inherited implicitly.

Why markers are stripped, all of them, with none kept: a step must behave the same whether
a person or an agent ran `verify`, or the gate measures the caller instead of the project.
Some dev servers and tools change behavior when they see a marker such as `CLAUDECODE`
(backgrounding themselves, switching reporters, skipping prompts), and a gate run inside an
agent would pass or fail differently from a person's run. The cost is that a tool's
agent-friendly output mode is lost; the bounded tail (below) already keeps output short.

### Running a step

A `run` step goes through `Processes.run` ([roadmap, Contracts: Process
service](../roadmap.md#types-and-schemas)) with `/bin/sh -c`, the project root (or the
step's `cwd`, whose real path must resolve inside the project) as working directory, and
the environment above. stdin, group leadership, the drain after the shell exits and group
kill are 0.3b's behavior; verify doesn't add its own.

When the shell exits while its children still hold stdout or stderr, `Processes.run`
waits the 2 s drain, then kills the step's process group, and returns `Finished` with
`pipesHeld: true` ([roadmap, Contracts: Process service](../../roadmap.md#types-and-schemas)).
Verify reads the flag, never the tail: the step's status still comes from the shell's exit
code, and a `pipesHeld` step carries the fixed reason `the step left a process holding
its output; it was stopped after 2 s` (as a failure reason when the step failed, and
otherwise as a `note` on a passed step). A passing step is not failed for it, because a
daemon that closed its pipes properly never triggers it. Output is kept in one bounded tail of
`TAIL_BYTES` and reported as the last `TAIL_LINES` ([roadmap, Contracts: Output tail
size](../roadmap.md#types-and-schemas)); verify picks no size of its own. In human mode the
output is also streamed to stderr prefixed with the step name.

Timeouts: each setup, check and teardown `run` step passes `VerifyStep.timeout` (default
10m, owned by 1.0; [roadmap, Contracts: Entry format v1](../../roadmap.md#types-and-schemas))
as `ShellSpec.timeout`. When `Finished.timedOut` is true the step fails with
`failureKind: "timeout"` and reason `timed out after <timeout>`. A serve step's limit is
its `expect.within`; it ends when the probe passes, so `timeout` adds nothing there and is
ignored (decided here). `validate` (1.5) may warn on a serve step that sets one.

Exit 127 from the shell means the command wasn't found. Verify reports it as
`failureKind: "env"` with reason `command not found: <first word>`, the first word taken
from the step's `run`, not from its output. A `SpawnFailed` (missing cwd, missing
`/bin/sh`, `EAGAIN`) is also `env`. Every other non-zero exit is `"step"`.

Every step is a `run` step: v1 has no built-in file checks (1.0), so an entry that wants
one runs a short command. See "What this plan may get wrong" for the open item.

### Probes

A serve step's probe is its `expect` (1.0): `http`, a URL, and `within`, default 60s.
Before a serve step starts anything:

1. `expect.http` has `${VAR}` expanded from the step environment. An unresolved `${VAR}`, a
   scheme other than `http`, or a host other than `localhost`, `127.0.0.1` or `::1` fails
   the step with a reason and starts nothing. Verify checks the project; it doesn't make
   requests elsewhere (open question 10).
2. A TCP connect to the probe's host and port that succeeds means something already holds
   the port. The step fails `failureKind: "env"` with reason `port <n> already in use`,
   rather than probing someone else's server and calling it green.

Both network operations go through Effect services, never through Node APIs in core
code: the HTTP probe uses `HttpClient` (`effect/unstable/http`) and the port checks use
`Socket` (`effect/unstable/socket`) for a plain TCP connect. Their Node layers
(`NodeHttpClient`, `NodeSocket` from `@effect/platform-node`) are provided by
`src/platform/net.ts`, which `bin.ts` adds to the platform layer; tests use the same real
layers against local servers. The Grit boundary rule (0.3b) keeps `@effect/platform-node`
imports in `bin.ts` and `src/platform/`, so `core/verify/probe.ts` stays platform-free.

Then `Processes.start` runs the command in its own group, inside a scope for that step,
and the probe polls every 500 ms with a 5 s per-request timeout until it gets any status
below 500. The step resolves on the first of:

| Event | Result |
|---|---|
| Probe gets a status below 500 | Passes the probe stage; continue to stop |
| The command exits non-zero | Fails `"step"`, with its tail |
| The command exits 0 before the probe passed | Fails `"step"` with the fixed reason `serve command exited before its probe passed; serve commands must stay in the foreground` |
| `within` elapses (default 60s) | Fails `"timeout"`, reason `probe not ready after <within>` |

The exit-0 row catches dev servers that fork a background copy and return (some do so only
when they see an agent marker, which stripping prevents, but some do it anyway). The brief
(1.1) tells the agent serve commands stay in the foreground; this makes the rule
enforceable.

Stopping: closing the step's scope kills the group (0.3b). Verify then connects to the
probe port every 250 ms for up to 5 s. If the port still answers, the step fails `"step"`
with the fixed reason `port <n> still answering after the serve step stopped; a process
left the step's process group`, even if its probe passed. A server that escaped its group
would otherwise hold the port for the next run and make it fail `env` for no visible
reason. Verify can't kill a process outside the groups it started, so the reason names the
port and the agent has to stop it.

### Selection flags

| Flag | Effect | Scope |
|---|---|---|
| none | Every step except `skipByDefault` ones (`prod` steps under `--sandbox`) | `full` |
| `--all` | Every step including `skipByDefault` | `full` |
| `--skip-tag t` | Skip steps carrying tag `t`; repeatable | `partial` |
| `--only a,b` | Run only these `check` and `serve` steps; `setup` and `teardown` still run | `partial` |

An unknown `--only` name is `BadInput` with `details: { known: [<names>] }`. A
`partial`-scope run where every selected step passed has outcome `partial` and exits 0; it
never counts as green ([roadmap, Other shared facts: JSON
contract](../roadmap.md#other-shared-facts)).

### Result

```ts
// src/schemas/verify.ts
export const FailureKind = Schema.Literals(["step", "env", "timeout", "interrupted"]);

export const StepResult = Schema.Struct({
  name: Schema.String,
  phase: Phase,                                // from VerifyStep (1.0)
  layer: Schema.optional(Layer),
  command: Schema.String,                      // the step's run
  status: Schema.Literals(["passed", "failed", "skipped"]),
  failureKind: Schema.optional(FailureKind),   // only when failed
  exitCode: Schema.optional(Schema.Number),
  durationMs: Schema.Number,
  reason: Schema.optional(Schema.String),      // fixed CLI text, never step output
  note: Schema.optional(Schema.String),        // fixed CLI text on a passed step (pipesHeld)
  outputTail: Schema.optional(Schema.String),  // the step's own output, last TAIL_LINES
});

export const VerifyResult = Schema.Struct({
  outcome: Schema.Literals(["green", "partial", "failed", "interrupted"]), // 1.3b adds "changed"
  scope: Schema.Literals(["full", "partial"]),
  steps: Schema.Array(StepResult),
  totals: Schema.Struct({ passed: Schema.Number, failed: Schema.Number, skipped: Schema.Number }),
  durationMs: Schema.Number,
  secondsSinceCreated: Schema.Number,          // from createdAt (the state record's when there is one) and Clock
});
```

1.3b adds `tamperCheck`, `changed`, `firstGreen` and `stateRecord` to `VerifyResult`
and the `changed` outcome. Nothing is published between 1.3a and 1.3b, so the JSON shape
freezes only when 1.6c releases.

`green` means scope `full` and every non-skipped step passed (1.3b adds "and the tamper
check passed"). `outputTail` goes in the result on stdout, because the agent needs it to
fix the failure, and never into the error envelope or the logs.

### Outcomes and exits

On failure the result stays on stdout and the error envelope is the last stderr line
(keeps-result failure, 0.3a; [roadmap, Error tags](../../roadmap.md#error-tags)):

| Outcome | Exit | Envelope |
|---|---|---|
| `green` | 0 | none |
| `partial`, every selected step passed | 0 | none; the brief says done means `green` |
| `failed` (including every failure being `env`) | 5 | `VerifyFailed`, `details: { failed: [{ name, failureKind, exitCode? }] }` |
| `interrupted` | 130 | `Interrupted` |
| No manifest found walking up | 2 | `NotFound`, `details: { suggestions: [], looked: <start dir> }`, reusing the optional string `looked` 1.5 added to the closed `NotFound` details struct (the resolved directory the walk started from, not a list); the fixed message names `stacks new` |
| Manifest fails to decode | 3 | `InvalidConfig`, `details: { path, field }`; a higher `schemaVersion` gets the fixed "upgrade stacks" message ([roadmap, Schema versions](../../roadmap.md#schema-versions)) |

`VerifyFailed`'s `details` is a closed `Schema.Struct` holding only step names, kinds and
exit codes; no output. `env` stays in the failure kind so the agent and 2.0c's ledger can tell "the
machine lacks Docker" from "the code is broken"; the exit is 5 either way.

### Human failure output

Human mode ends every non-green run with one fixed `Next:` line from
`verify/next.ts::nextLine(outcome)`, after the per-step summary and before the envelope.
The wording matches the brief's rules (1.1, section 10) so the agent reads the same
instruction in both places:

| Outcome | Last line |
|---|---|
| `failed` with any `step` or `timeout` failure | `Next: fix the code or config these steps exercise, not the steps, then run <cli> verify again.` |
| `failed`, every failure `env` | `Next: the machine is missing something these steps need (see each reason); install or start it, then run <cli> verify again.` |
| `partial` | `Next: this was a partial run; done means a full <cli> verify with outcome green.` |
| `changed` (1.3b) | `Next: the verify steps changed since they were recorded. Don't edit them back; ask the user to run <cli> verify --accept-changes from their own terminal, or to undo the change.` |
| `interrupted` | none |

`<cli>` is `Host.invocation`. 1.3b uses the `changed` row as written here. JSON mode has no
`Next:` line: the agent reads the outcome and `failureKind`, and the brief carries the rule.

### Interrupts

The first SIGINT or SIGTERM (0.3b's policy, including its rule for when a second SIGINT
counts) interrupts the running step, whose group is killed by `Processes`; remaining setup,
check and serve steps are `skipped`; teardown runs; `onFinished` runs with outcome
`interrupted` and the interrupted step at `failureKind: "interrupted"`; exit 130. Teardown
and `onFinished` are finalizers of the verify scope, so this ordering holds for every way
the scope ends.

### Settled here

| Question | Answer | Why |
|---|---|---|
| Check-phase failures | Run all checks, report all | Fewer agent loops |
| Agent markers in step env | Removed, every one | A step's behavior must not depend on who ran verify |
| Serve command exits 0 before its probe | Fails with a fixed reason | Self-backgrounding servers hold ports and fake a pass |
| `timeout` on a serve step | Ignored; `within` governs | The step ends at the probe, so a second limit only confuses |
| Probe targets | Local hosts only (open question 10) | Verify checks the project, it doesn't reach the network |
| Shell | `/bin/sh -c` for `run` steps | Steps are project commands like `make test` |

## Files and areas touched

| Path (under `packages/cli/`) | Change |
|---|---|
| `src/commands/verify.ts` | Thin handler, flags |
| `src/core/verify/plan.ts` | Selection, scope |
| `src/core/verify/run.ts` | `runVerify`: phases, finalizers, `onFinished` seam |
| `src/core/verify/step.ts`, `probe.ts` | Run steps (with the `pipesHeld` note), `expect` probes and port checks through `HttpClient` and `Socket` |
| `src/platform/net.ts`, `src/bin.ts` | Node layers for `HttpClient` and `Socket` from `@effect/platform-node`, added to the platform layer |
| `biome-plugins/boundaries.grit` | Confirm `@effect/platform-node` stays allowed only in `bin.ts` and `src/platform/` (0.3b's rule), with a probe file |
| `src/core/verify/next.ts` | `nextLine`, the human `Next:` line per outcome (1.3b uses its `changed` row) |
| `src/core/manifest.ts` | Locate by walking up; read (1.2b owns write and `digestSteps`) |
| `src/schemas/verify.ts` | `FailureKind`, `StepResult`, `VerifyResult` |
| `src/errors.ts` | `VerifyFailed` `details` schema (the tag and row are 0.3a's) |
| `src/cli.ts` | `verifyCommand` |
| `tests/verify.test.ts`, `tests/verify-probe.test.ts`, `tests/verify-signals.test.ts` | New |
| `tests/fixtures/projects/` | Hand-written manifests and tiny server scripts per case |
| `e2e/verify.test.ts` | `verify` on a fixture project against the built artifact |

## Acceptance tests

Real child processes only (`sh -c 'exit 1'`, `node -e`, a tiny HTTP server started by a
serve step). No module mocks. Each test runs with the agent markers of the test host
stripped by `tests/helpers/cli.ts`, and the marker test sets them on purpose.

1. Passing setup, check and teardown steps: exit 0, outcome `green`, one result on stdout.
2. Two failing check steps: both reported, exit 5, `VerifyFailed` envelope last on stderr
   naming both, result on stdout with both `outputTail`s; teardown ran (it touches a
   marker file).
3. A failing setup step skips check and serve and still runs teardown.
4. A step `sleep 30` with `timeout: 1s` fails `failureKind: "timeout"` in under 10 s, and
   the sleep process is gone.
5. A step whose `run` is a command that isn't installed (`nope-not-installed --x`) fails
   `env` with reason `command not found: nope-not-installed`.
6. A step that prints `env` while `CLAUDECODE=1` and every other `AgentMarkers` entry is
   set for the CLI: none of them appear in its output; a manifest `env` key is present,
   and a value set in the caller's environment wins over the manifest default.
7. A serve step starting a `node -e` HTTP server on a free port passes its probe; after the
   step the port is closed.
8. A serve step whose command exits 1 early fails `"step"` with its tail. A probe on a busy
   port fails `env` without starting the command.
9. Self-backgrounding fixture: a serve command that spawns a detached HTTP server (Node
   `spawn` with `detached: true`, `unref`, writing its pid to a file) and exits 0 fails with
   the fixed early-exit reason. A second fixture whose foreground process stays up but
   whose detached server holds the probe port passes the probe and then fails with the
   `still answering` reason. The test kills the detached pids afterwards.
10. A probe that never answers fails `"timeout"` after `within: 1s`.
11. A probe URL to a non-local host, or with an unresolved `${VAR}`, fails before
    starting anything.
12. A step that leaves `sleep 600 &` behind finishes in under 10 s and the sleep is gone
    (0.3b's drain and group kill, checked end to end); it passes with the fixed
    `pipesHeld` note. The same with `sleep 600 & exit 1` fails `"step"` with that reason.
    A setup step running `sh -c 'sleep 600 >/dev/null 2>&1 &'` (pipes closed) has no note.
13. A step whose `cwd` escapes the project (including through a symlink) fails `env`
    without running.
14. `--only lint` passes with outcome `partial`, exit 0; `--only nope` exits 2 listing the
    known names; `--skip-tag slow` gives scope `partial`.
15. `--sandbox` project: the `prod` step is skipped; `--all` runs it.
16. Interrupting through `runCli`'s `signal` during a `sleep` step exits 130, kills the
    step, runs teardown, and `onFinished` receives outcome `interrupted`.
17. Running from a subdirectory finds the manifest; outside any project exits 2 with
    `details.looked`; a manifest with `schemaVersion: 2` exits 3.
18. `verify --json | head -c 1`-style broken pipe after a failing run still exits 5
    (0.3a's BrokenPipe rule).
19. Human mode: a failing `step` run ends with the "fix the code ... not the steps" line;
    an all-`env` failure ends with the "machine is missing something" line; a `--only` pass
    ends with the partial line; a green run has no `Next:` line; `--json` output never
    contains `Next:`.
20. `core/verify/probe.ts` imports nothing from `@effect/platform-node` or `node:`; a Grit
    probe file that does fails lint.
21. e2e: the built artifact runs a fixture project with one passing and one failing step,
    exit 5, result on stdout.

## Exit criteria

- All tests above pass; `bun run check` green from the repo root.
- `AGENTS.md` documents exit 5, the result-on-failure contract for verify, step timeouts
  and the serve-step rules; `packages/cli/README.md` documents `verify` and its flags.
- The roadmap's contracts rows this uses (Process service, Output tail size, Child
  environment, Entry format v1, JSON contract) still match what was built; any mismatch is
  raised with the maintainers, not patched locally.

## What this plan may get wrong

- The port-closed check after stopping a serve step assumes nothing else grabs the port in
  those 5 s. Rare; the reason says which port, so it's visible.
- Detecting "port in use" by connecting first can race with a server that starts between
  the check and the step. Rare, and the failure is visible.
- Stripping every agent marker might break a tool that needs one to authenticate inside an
  agent sandbox. No such tool is known; if one shows up, `AgentMarkers` is the place to
  split "detect" from "strip", with the reason written there.
- Continuing after check failures can produce noise when one root cause breaks everything
  (no install). If 1.6b's gate runs show that, stop the check phase after the first failing
  `install`-layer step.
- The 10-minute default timeout may be short for a cold install on a slow machine. 1.6b's
  gate runs record step durations; raise the default in 1.0 if a stack needs it.
- The tail of `TAIL_LINES` may cut the useful part of a long test failure. Measure in
  1.6b.
- Open, 2026-10-26: built-in checks. This plan first ran `check: { filled | exists }`
  steps in-process; the amended D18 dropped them from v1, so a file check is a shell
  command again (the thing the trust model's point 1 wanted to avoid), and the
  `agents-md` and `readme` steps 1.6a planned need a `run`. If ported content shows
  authors writing the same file-check shell often, add built-in checks back as an
  additive optional step key (for example `check`, exclusive with `run`), which under the
  roadmap's Schema versions rule is a D18 amendment and a `schema_version` bump.
- 2026-10-26: `probe: { url, within }` became `expect: { http, within }`. Behavior is
  unchanged; only the key names moved.
- 2026-10-26, found while executing. The network layers aren't `NodeHttpClient` and
  `NodeSocket` from `@effect/platform-node`: that package is a dev dependency (the binary runs
  on Bun), and in effect 4.0.6 the modules are `effect/http` and `effect/socket`, not
  `effect/unstable/*`. `src/platform/net.ts::NetLayer` uses `FetchHttpClient` (fetch exists in
  both Bun and Node; redirects are not followed, so a local probe can't be bounced to another
  host) and `makeNet` from `@effect/platform-bun/BunSocket` (a re-export of the shared
  `node:net` socket, which loads under Node too). effect's `Socket` is one connection, not a
  connector, so core gets the small `services/net.ts::Tcp` service (`connect(host, port)`)
  instead; the roadmap gained a "Network layers" contracts row. A proxy set in the caller's
  environment (`HTTP_PROXY`) may still be read by the runtime's fetch; not seen, not handled.
- 2026-10-26: the unknown `--only` name is `BadInput` with `details: { id, flag: "only",
  known }`, not `{ known }`: `BadInputDetails` is one closed struct whose `id` and `flag` are
  required, so `only` became a `flag` value and `known` an optional key (roadmap Error tags
  row updated). `known` lists the check and serve steps, sorted; naming a setup or teardown
  step is an unknown name, since those always run.
- 2026-10-26: a manifest that fails to decode is `InvalidConfig` with `details: { path }` (or
  `{ path, schemaVersion }`), 1.2b's `InvalidConfigDetails`, not `{ path, field }`; the struct
  has no `field` and a decode issue's path isn't needed to fix a hand-edited manifest.
- 2026-10-26: the missing-manifest `NotFound` sets `kind: "project"` (the details' `kind`
  widened from the entry kinds) so `detailLines` can tell it from validate's missing path,
  whose `Next:` line is about registry roots. `NotFound`'s message stays fixed ("Not found.");
  `stacks new` is named in the human `Next:` line, not the message.
- 2026-10-26: decided while executing. A skipped step carries a fixed `reason` (`not selected
  by --only`, `tagged <t>; --skip-tag leaves it out`, `skipped by default in this preset;
  --all runs it`, `an earlier setup step failed`, `the run was interrupted`). A
  `skipByDefault` step named in `--only` is still skipped without `--all`, so `--only` can't
  run a prod step in a sandbox project. `outputTail` is only on failed steps; a timed-out
  step reports no `exitCode` (the status is the CLI's own kill). A plain non-zero exit's
  reason is `exited with status <n>`. An unresolved `${VAR}` in a probe is `env`; a non-local
  or non-http URL is `step`. Serve steps don't stream their output live, because
  `Processes.start` has no output callback; their tail is in the result.
- 2026-10-26: the left-running port check runs only after a probe passed. A serve command
  that backgrounds itself and exits 0 fails with the early-exit reason; the server it left
  is not named, and the next run reports `port <n> already in use`.
- 2026-10-26, found in review. The runner keys results by step name, but `Manifest` didn't
  require unique names (only `compose.ts::steps` did), so a hand-edited manifest with two
  `lint` steps reported one result and a failed step could read green. `Manifest.verify` now
  refuses a repeated name, so such a manifest is `InvalidConfig` (exit 3) before anything runs.
- 2026-10-26, found in review. `secondsSinceCreated` counted from the manifest's `createdAt`,
  which is outside the digest, so an agent could edit it to improve its time to green. It now
  counts from the state record's `createdAt` when there is one (`tamper.ts::createdAtOf`; the
  record for the id, else one found by path), and from the manifest's only when the check was
  manifest-only. `run.ts::VerifyProject` carries that `createdAt` from the caller.
