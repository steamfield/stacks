# Phase 2.0b: Bench

Status: EXECUTED 2026-10-27 (`bun run bench` with the claude and codex adapters, tested
against fake agents; real runs and their proofs are the maintainers')
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | A maintainer reruns any bundled stack with one command on their own machine: a local script builds the CLI from the working tree, scaffolds the stack with `new --sandbox` (or, with `--preset default`, `new --yes`), drives the maintainer's own agent headlessly with token auth (D24), runs `verify` itself, and appends a `LedgerRecord` and a run note, with interventions counted from the agent's `## Asked` log |
| Traces to | "The only quality signal the product has is manual and nobody has time to run it"; success rows "The agent finishes without help" and "It's faster than by hand"; assumption 1's test: "Run each bundled stack to green and count hesitations and skipped instructions" |
| Depends on | [2.0c](phase-2.0c-run-ledger-2026-10-30.md) (`LedgerRecord`, `appendRecord`, `stacks runs --json`, `countAsked`), [2.0a](phase-2.0a-composed-files-and-fingerprint-2026-10-30.md) (`fingerprint` in `new --json`), [0.3b](phase-0.3b-processes-and-signals-2026-10-30.md) (`Processes`), [1.4](phase-1.4-handoff-and-entry-points-2026-10-30.md) (`agentPrompt`) |
| Blocks | [5.1](../../phases/phase-5.1-scheduled-canary.md) (schedules this script on an isolated machine); [3.3a](phase-3.3a-release-and-deploy-fragments-2026-10-30.md) and [3.3c](phase-3.3c-service-vendor-and-effect-fragments-2026-10-30.md) (bundled fragment expansion, which bench with `--preset default` as well), [3.3b](phase-3.3b-bundled-stack-expansion-2026-10-30.md), [3.4a](phase-3.4a-agent-harness-fragment-2026-10-30.md), [3.4b](phase-3.4b-native-agent-adapters-2026-10-30.md), [3.5a](../../phases/phase-3.5a-app-entry-kind.md) and [3.5b](phase-3.5b-two-phase-brief-2026-10-30.md) (each new entry lands with a bench run); evidence for [4.3](../../phases/phase-4.3-mcp-server.md) (bench notes, open question 15) |
| Decisions needed | D24 (headless auth by long-lived token in the environment; if declined, the bench has no supported way to log in and only the fake-agent tests can be built). Open question 11 answered 2026-10-27: the maintainers approved building the bench and running it locally with full permissions. Open question 12 (whether a maintainer reads every bench run to relabel `partial`; blocks the exit, owner: the maintainers; if only failing and regression runs get a read, `partial` is under-counted and the run note says the run wasn't reviewed) |
| Settles | The bench's command line and steps; the `BENCH.md` rules, including the `## Asked` log; how a run is classified into 2.0c's `result` values; the agent adapter table (`claude` and `codex`) and each agent's auth mechanism; continuing a kept run; hook detection; that bench runs send no telemetry; why the bench doesn't breach D2 |

## Scope

In:

- `packages/cli/scripts/bench.ts`, a development script (not a CLI command) that runs one
  stack end to end with one agent and records the result.
- `packages/cli/scripts/bench/agents.ts`, the adapter table.
- The bench brief `BENCH.md` the agent reads alongside `.stacks/BRIEF.md`.
- Tests with scripted fake agents.

Out:

- Scheduling, unattended runs, isolation from the maintainer's account, GitHub tokens and
  reports, and classifying runs over time (canary infra, timeouts, flaky stacks): all
  [5.1](../../phases/phase-5.1-scheduled-canary.md) and trust model point 8.
- The fingerprint (2.0a); the ledger schema and `stacks runs` (2.0c). Rot checks
  (2.2).
- Judging whether the built project is good beyond verify. The bench copies the agent's
  notes into a run note for a maintainer to read; it doesn't grade them.
- Any CI step. The fake-agent tests run in the existing `check` job with no workflow
  change; no real agent ever runs in CI (D23).

## Design

### Where this fits

[2.0c](phase-2.0c-run-ledger-2026-10-30.md) defines what a ledger record is and how the 1.6b gate
runs got into the ledger. This sub-phase produces new records: it replaces
the hand-run gate procedure from 1.6b with one command, so a maintainer can rerun a stack
after a prose change, a CLI release or a new agent version. [2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md)
is built in parallel and reads the records this script appends. [5.1](../../phases/phase-5.1-scheduled-canary.md)
later runs this same script on a schedule; nothing here schedules anything.

### What a local bench run is, and isn't

A bench run is a maintainer running their own agent, logged in with their own token, on
their own machine, against stack content from this repo. The agent runs with full
permissions (below). The throwaway directory and `HOME` keep the maintainer's own stacks,
settings and agent hooks out of the run so results are reproducible; they are not a
security boundary, and an agent with full permissions can still read the real home by
absolute path ([Trust model](../../roadmap.md#trust-model), point 8). Whether that risk is
acceptable for local runs was [open question 11](../../risks-and-open-questions.md#open-questions-for-the-maintainers).
On 2026-10-27 the maintainers approved building the bench and running it locally.
Unattended runs get real isolation in 5.1.

### Command

```
bun scripts/bench.ts <stack> [--with a,b] [--preset sandbox|default]
                     [--agent claude|codex] [--max-minutes 60]
                     [--cli <binary>] [--existing <dir>] [--keep] [--no-record]
```

`--agent` defaults to the agent the bench was started from, when `AppConfig.agent` names
one with an adapter (a maintainer running the bench inside a Codex session gets `codex`),
and to `claude` otherwise; `"other"` and `"none"` fall back to `claude`. The run note says
which rule picked it. `--preset` (default `sandbox`) picks the composition the bench
scaffolds: `sandbox` runs `new --sandbox`, the D20 gate composition; `default` runs
`new --yes`, so every decision takes its default and the default preset's prose is what
the agent reads. The preset is recorded in the ledger key, so the two never mix.
`--cli` uses an already compiled dev binary instead of building; the bundled registry
comes from the working tree beside it.
`--existing <dir>` continues a run kept with `--keep` (below). `--no-record` runs
everything but writes no ledger record or run note (for trying a change). The script is written with Effect, uses the `Processes` service (roadmap,
[Contracts: Process service](../../roadmap.md#types-and-schemas)) for every child process, and
provides the same Node platform layer `bin.ts` uses. Its program is exported so tests run
it in-process.

### Steps

1. **Preflight.** Resolve the adapter. `Processes.which` finds the agent binary; the
   adapter's version command gives `agentVersion`; the adapter's token variable must be
   set in the maintainer's environment (D24). The repo commit is `git rev-parse HEAD`, and
   the run refuses if `packages/cli/` has uncommitted changes, because a record must name
   the commit that ran. Any failure stops here with the agent's or git's own message,
   exit 1, nothing written.
2. **Artifact.** Build the working tree with `bun run build` (producing
   `packages/cli/dist/stacks`), or take the compiled binary from `--cli`. Copy the
   binary to `<prefix>/bin/stacks` and the bundled `registry/` beside `bin/` in a fresh
   temporary prefix, as the 1.6b gate runs did. Install no `scripts/` or `src/` files. Every
   `stacks` call below is that installed binary, never source.
3. **Environment.** A throwaway root with `run/` (the project), `home/` (`HOME`, with fresh
   `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` under it) and
   `bench/` (the bench's own files). The child environment is built from scratch:
   `PATH`, `HOME`, the XDG paths, `TMPDIR`, `LANG`, `PORT_*` from step 4, the
   adapter's one token variable, `DO_NOT_TRACK=1`, and the adapter's debug-log variable
   when it has one (step 7). `DO_NOT_TRACK=1` means no `stacks` the agent runs, and
   none the bench runs itself, ever sends telemetry once a telemetry client exists (4.1a):
   bench installs would otherwise dominate small cells in later stats, and later release builds
   the bench installs would send. Nothing else is passed: no `GH_TOKEN`, no model API keys
   such as `ANTHROPIC_API_KEY` (which some agents would prefer over the token), and none of
   the agent session markers in `config.ts::AgentMarkers`, so a bench started from inside
   an agent session doesn't look nested.
4. **Ports.** The bench picks free ports for every `PORT_*` variable the composition's
   `env` declares and passes them to `new` and to every later `verify`.
5. **Scaffold.** `stacks new <stack> run --sandbox --agents <agent> --no-launch --json
   [--with ...]` (`--yes` in place of `--sandbox` under `--preset default`), reading `fingerprint` and `briefWords` from the result. Then the bench
   records a snapshot of every path and its sha256 under `run/`, for the infra rule in
   step 9.
6. **Bench brief.** Writes `bench/BENCH.md` and `bench/verify` (below). Both live outside
   the project, so they never show up in the snapshot, the project's git status or its
   tamper check.
7. **Agent.** Launch through `Processes.run` with the adapter's headless arguments, the
   prompt from 1.4's `agentPrompt` plus one sentence naming `bench/BENCH.md` by absolute
   path, the agent's JSON output mode, and a wall-clock cap of `--max-minutes`. At the cap
   the bench interrupts the run, which kills the agent's process group. `agentMinutes` is
   the wall clock from spawn to exit or kill. The adapter reads the agent's final JSON
   result from the output tail (roadmap, Contracts: Output tail size) and returns
   `exit` or `error` with the error subtype. When the adapter has a debug log, the bench
   reads it after the agent ends and records `hooksFired`: the hook names the agent logged
   as run, matched against the hooks the composition ships for that agent (for the
   agent-ops guardrail fragment from 1.6a and 1.6d, the session-start, destructive-command and
   format hooks). This is how a bench run proves the guardrail fragment works, not only
   that it was written.
8. **Independent check.** The bench runs `stacks verify --json` itself, then
   `stacks runs --json`. `run` is the last `runs.jsonl` line, decoded with
   `RunRecord`, which is the record of the bench's own verify. `verifyRuns`,
   `minutesToGreen`, `minutesToFirstTest` and `interventions` come from `runs --json`,
   so they mean exactly what 2.0c says. The bench's own verify is excluded from
   `verifyRuns` (it subtracts one), because the measure is the agent's loop.
   `minutesToGreen` is the whole run's (`firstGreenAt`, which 3.5b keeps meaning the whole
   project), never the base stage's; for a run with an app, the run note records the time to
   a green base, read from the first run record whose `stages.base` is `green` (3.5b).
9. **Classify** into 2.0c's `result` values:
   - `infra` when the adapter reports `error` and the snapshot from step 5 is unchanged
     (the agent wrote no files, `NOTES.md` included).
   - `pass` when `run.outcome` is `green`, `run.tamperCheck` is `"full"` and the agent
     ended with `exit`.
   - `fail` otherwise, with `agentEnded` saying why when it was `timeout` or `error`.
   - Never `partial`; that is a maintainer's call after reading the note.
10. **Record.** Unless `--no-record`, append a `LedgerRecord` with 2.0c's `appendRecord`
    (`mode: "headless"`, `note` set), and write `plans/runs/<date>-<stack>.md` in the
    [run-note format](../../runs/README.md), with the agent's `NOTES.md` copied in full and
    the final `RunRecord` line included. The maintainer reviews both and commits them on a
    branch.
11. **Cleanup.** Delete the throwaway root unless `--keep`. The bench never stops a process
    it didn't start; serve steps clean up their own process groups (1.3a).

### Continuing a kept run

`--existing <dir>` takes the throwaway root of an earlier `--keep` run. It refuses unless
`<dir>/run/.stacks/manifest.json` decodes, its stack and `with` match the command
line, and its fingerprint equals the one the current commit's composition gives (so a
continued run still measures the content the record will name). It skips steps 2 to 6
(reusing the kept artifact, `HOME` and ports), takes a fresh snapshot for the infra rule,
then launches the agent with the same prompt and runs steps 8 to 11. The record gets
`mode: "headless"` like any other and the run note says it continued an earlier run, with
both notes linked. The ledger's `minutesToGreen` comes from `runs --json`, so it counts
from the original `new`, not from the continuation. A continued run never counts toward
D20's zero-intervention gate: the continuation is itself an intervention, and the record
sets `interventions` to the `## Asked` count plus one.

### The bench brief

`bench/BENCH.md` is short and adds only what an unattended run needs. The stack's brief
already carries the build rules (1.1).

- Nobody will answer you. Never ask the user a question. When you would have asked one,
  choose the default the brief gives (or the most conventional choice if it gives none),
  carry on, and add one line under `## Asked` in `.stacks/NOTES.md`: the question,
  then `default:` and what you chose.
- Keep `.stacks/NOTES.md` as the brief describes, including `## Findings`.
- Run verify with `<absolute path>/bench/verify`.
- Never edit `.stacks/manifest.json`. Never fake a credential or stub a service the
  brief says to use for real.
- Stop when verify is green.

`interventions` for a bench record is the count of lines under `## Asked`, by 2.0c's
`countAsked`. A headless run is not zero interventions by construction: every question
the agent would have asked is a hesitation assumption 1 wants counted, and an agent that
doesn't keep the log gets `interventions: null`, which never meets D20.

`bench/verify` is a two-line shell wrapper that appends a timestamp to `bench/verify.log`
and runs the installed CLI's `verify` with the bench's ports. The run note reports the
log's line count next to `verifyRuns`; a mismatch means the agent called `verify` some
other way.

### Agent adapters

```ts
// scripts/bench/agents.ts
export type AgentAdapter = {
  readonly id: AgentId;                          // roadmap, Contracts: Agent ids
  readonly binary: string;
  readonly versionArgs: ReadonlyArray<string>;
  readonly auth: { readonly env: string; readonly obtain: string }; // D24
  readonly headlessArgs: (prompt: string) => ReadonlyArray<string>;
  readonly readResult: (tail: string) => { ended: "exit" | "error"; subtype?: string; turns?: number };
  readonly debugLog?: { readonly env?: string; readonly args: ReadonlyArray<string> };
  readonly readHooks?: (log: string) => ReadonlyArray<string>;  // hook names that ran
};
```

| Agent | Binary and headless mode | Auth mechanism (D24) | Result |
|---|---|---|---|
| `claude` | `claude -p <prompt> --output-format json --dangerously-skip-permissions` | `CLAUDE_CODE_OAUTH_TOKEN`, a long-lived token from `claude setup-token` | Final JSON object: `is_error` and `subtype` (`success`, or an `error_*` value), `num_turns`. Debug log: the `--debug` output to a file under `bench/`, from which hook runs are read |
| `codex` | `codex exec <prompt> --json` with its full-access sandbox mode | `CODEX_ACCESS_TOKEN`, as documented by `codex login --with-access-token` in codex-cli 0.164.0 (D24) | Final JSONL event: success or error and the turn count. Hook detection only if its log records hook runs; otherwise `hooksFired: null` |
| others | Added one row at a time | Must be a token passed by environment through the agent's own headless flow. An agent that only offers a refreshable credential file can't be benched | Per agent |

Flags and field names are confirmed against the installed agent when the adapter is
written and pinned by a test against a recorded output sample; the row above is the
expected shape, not a promise about the agent. The bench never copies credential files,
keychain items or agent config into the throwaway `HOME`: keychain logins can't be copied,
and a copied OAuth refresh token rotates inside the copy and invalidates the original
(D24).

The `codex` adapter is required, not optional: a second agent is what tells a stack that
only works with one agent's habits from a stack that works, and 3.4b's native adapters
are proved with it. Its exact flags, token variable and result shape are pinned by a
recorded output sample the same way as `claude`'s.

`hooksFired` goes into the run note and, as an optional field, onto the ledger record
(the run record and ledger row of the roadmap's [Schema versions](../../roadmap.md#schema-versions): a new optional field
doesn't bump). `null` means the adapter can't tell, never "none fired".

### Why full permissions

Allowlisted headless modes were tried in design and rejected: agents treat their own
config directories and git hook config as protected paths and refuse writes there in
headless runs regardless of the allowlist, so every stack that ships agent config or git
hooks ends red for reasons that aren't the stack's. The cost is the one stated above and
in open question 11.

### Why the bench doesn't breach D2

D2 is about the product: the CLI never calls an LLM and never runs a command from an
entry. The bench is a development script in the repo, started deliberately by a
maintainer, that starts the agent the maintainer already has, as they would by hand. The
CLI it drives is the installed dev binary and still runs nothing from an entry; the agent runs
the generators, and the CLI runs only the manifest's steps under `verify`. The installed
prefix contains no `scripts/` or `src/` files, and no CLI command imports the bench.

### Failure modes

| Case | Handling | Exit |
|---|---|---|
| Agent not on PATH, version command fails, token variable unset | Stops in preflight with the message naming the missing piece | 1 |
| Uncommitted changes under `packages/cli/` | Stops in preflight | 1 |
| Agent fails to log in or hits a rate limit before writing anything | `infra` | 0 (recorded) |
| Agent errors after writing files | `fail`, `agentEnded: "error"` | 0 |
| Agent exceeds `--max-minutes` | Group killed, verify still runs, `fail`, `agentEnded: "timeout"` | 0 |
| Agent edits the manifest | Verify reports `changed`; `fail` | 0 |
| Verify green but notes show a missing deliverable | `pass`; the maintainer relabels it `partial` and opens a verify-step fix (open question 12) | 0 |
| Ledger undecodable | `appendRecord` fails; the run note is still written, the record is printed to stderr | 3 |
| Ctrl+C during the run | The agent's group is killed, cleanup runs, nothing recorded | 130 |

### Decided here

- Headless runs use full permissions in a throwaway directory and `HOME`, and that is not
  called isolation. Reason above; [open question 11](../../risks-and-open-questions.md#open-questions-for-the-maintainers)
  was answered on 2026-10-27: build the bench and run it locally with full permissions.
- Bench runs never send telemetry (`DO_NOT_TRACK=1` in the child environment). Reason:
  maintainer reruns of one stack would concentrate its cells and say nothing about users.
- The bench brief lives outside the project. Reason: it must not change the project's
  files, git status or the snapshot the infra rule compares against.
- The bench refuses a dirty tree rather than recording a dirty flag. Reason: a record must
  name a commit someone can check out (2.0c's import and 2.2 both rely on that).

## Files and areas touched

| Path (under `packages/cli/`) | Change |
|---|---|
| `scripts/bench.ts`, `scripts/bench/agents.ts`, `scripts/bench/brief.ts`, `scripts/bench/hooks.ts` | the bench, the `claude` and `codex` adapters, `BENCH.md` text, hook detection from debug logs |
| `src/schemas/ledger.ts` | optional `hooksFired: NullOr(Array(String))` and `continued: Boolean` on `LedgerRecord` (additive, no version bump) |
| `package.json` | `bench` script; `files` keeps excluding `scripts/` |
| `tests/bench.test.ts`, `tests/fixtures/fake-agents/` | fake-agent tests and recorded `claude` and `codex` output samples and debug logs |
| `plans/runs/` (repo root) | one note per real run, written by the bench |
| `registry/runs.json` | records appended by real runs |
| repo `AGENTS.md`, package README | how to bench, the token variable, the not-a-boundary rule |

## Acceptance tests

Fake agents are Node scripts put first on a test `PATH` and registered as adapters in the
test. The tests use a fixture stack whose verify passes when two files exist.

1. A fake that writes the files, logs one `## Asked` line and exits with a success result
   gives a `pass` record with `interventions: 1`, the fingerprint from `new --json`,
   `agentVersion` from its version command, the current repo commit, and `run` equal to
   the last `runs.jsonl` line.
2. A fake that edits the manifest gives `fail`, with `run.outcome` `changed`.
3. A fake that sleeps past `--max-minutes` (set to a fraction of a minute in the test) is
   killed with its group and gives `fail`, `agentEnded: "timeout"`; no process it started
   is left running.
4. A fake that exits at once with an error result and writes nothing gives `infra`; one
   that writes a file and then errors gives `fail`, `agentEnded: "error"`.
5. A fake that writes no `NOTES.md` gives `interventions: null`.
6. The child environment seen by a fake (it dumps its env) contains the token variable
   and none of `GH_TOKEN`, `ANTHROPIC_API_KEY` or any `AgentMarkers` variable, even when
   the test process has them set.
7. Preflight: an unset token variable, and a dirty `packages/cli/` in a temporary repo,
   each exit 1 with nothing written.
8. `--no-record` writes no ledger record and no run note.
9. The `claude` adapter's `readResult` parses the recorded output sample, success and
   error.
10. The bench's installed prefix holds the compiled binary and `registry/` and no `scripts/` or `src/` files.
11. The fake's env dump contains `DO_NOT_TRACK=1`, and every `stacks` the bench
    runs itself is spawned with `DO_NOT_TRACK=1` in its environment.
12. `--existing` on a kept root continues the run and appends one record with
    `continued: true` and `interventions` one higher than the `## Asked` count; a kept
    root whose manifest names another stack, or whose fingerprint no longer matches the
    current composition, is refused with exit 1 and nothing written.
13. A fake debug log naming two of three shipped hooks gives `hooksFired` with those two;
    an adapter without `readHooks` gives `hooksFired: null`.
14. Agent auto-pick: with `AppConfig.agent` set to `codex` by the test environment's
    markers and no `--agent`, the `codex` adapter is used; with `"other"` or `"none"`,
    `claude`; an explicit `--agent` always wins.
15. The `codex` adapter's `readResult` parses its recorded output sample, success and
    error.
16. `--preset default` scaffolds with `--yes` and no `--sandbox`, and the record's
    `preset` is `default`; without `--preset` the record's `preset` is `sandbox`.

### Realistic edge cases

17. A symlinked kept root with spaces, quotes, a leading dash and Unicode continues from another working directory.
18. Inherited git repository variables and missing or relative XDG paths cannot redirect preflight or the fresh child environment.
19. An existing partial root with a missing or undecodable manifest, or a file in place of `.stacks/`, is refused without changing it.
20. Cancellation while the build is blocked kills that process, cleans the throwaway root and writes no record or note.
21. Cancellation after the agent and its descendant are blocked kills both, removes the throwaway root and preserves unrelated files.
22. An undecodable ledger remains unchanged; exit 3 still leaves the complete run note and prints a recoverable record to stderr.
23. An agent that writes only ignored `NOTES.md` before an error is `fail`, not `infra`.
24. A kept root with different added fragments is refused unchanged.
25. A missing agent binary or failed version command is a preflight failure with no files written.
26. Missing, malformed, truncated or contradictory agent output cannot certify success; a later Codex error wins over an earlier completion.
27. Default cleanup removes the throwaway root after recording the full notes.
28. A second run on the same date appends a distinct note and record without overwriting the earlier note.

## Exit criteria

Agent-owned:

- `bun run check` green from the repo root, including the fake-agent tests.
- `AGENTS.md` documents the bench, the token variable for each adapter, and that the
  throwaway `HOME` is not a security boundary.

Maintainer-owned, as in 1.6b's agent split (an agent can drive the terminal, but a person
confirms the run and reads the notes):

- Open question 11 answered 2026-10-27 (local full-permission runs approved); question 12 still needs an answer.
- One real bench run per bundled stack with the `claude` adapter, each appended to the
  ledger with its run note, and each note read (and relabeled `partial` if needed).
- At least one real bench run with the `codex` adapter on one bundled stack, recorded
  the same way, so the second adapter is proved against a real agent before 3.4b uses it.

## What this plan may get wrong

- 2026-10-27: The locked helper passes a fallible output flush to an infallible runner;
  the first bench test compares brief word counts across parent and fresh git contexts;
  kept-root and binary comparisons enumerate compiled-binary buffers and exhaust Node's
  heap, including a 16 GB retry. Resolved in review: the helper orDies the flush, the
  baseline brief runs in the fresh context, and the binary comparisons hash files instead of
  comparing buffers. Each test file compiles the probed binary once (about 23 s, from 57 s).

- 2026-10-27: The bench uses the dev build and a fresh binary-plus-registry prefix until
  0.2 lands; packing returns with 0.2.

- Headless agent modes differ in what they allow and report. The adapter table absorbs the
  differences, but an agent without a headless mode or an env-passed token can't be
  benched at all.
- A fresh `HOME` may trigger first-run prompts or onboarding in some agents even in
  headless mode. If so, the adapter writes the minimum non-credential config the agent
  needs, and the adapter row says what.
- The infra rule only catches failures before the agent writes anything. A rate limit
  halfway through is `fail`; telling that apart from rot over many runs is 5.1's job.
- Bench runs measure a clean environment. Users' machines have busy ports, missing tools
  and read-only homes inside agent sandboxes; `failureKind: "env"` in run records is how
  those show up once telemetry exists (4.1a).
- The `## Asked` log depends on the agent following `BENCH.md`. An agent that asks
  anyway usually ends its headless turn with the question; verify isn't green, so the run
  records `fail` and the run note shows the question. That is the right signal, but the
  question doesn't reach the `## Asked` count.
