# Phase 5.1: Scheduled canary

Status: DRAFT 2026-10-26 (not agreed)

| Field | Value |
|---|---|
| Goal | Every bundled stack is rebuilt by a real agent on a schedule, against current upstream versions, on an isolated maintainer-controlled machine, and the maintainers hear within a day when a stack that passed stops passing without anyone changing its prose, without infrastructure failures ever being reported as rot |
| Traces to | Open question "How does a stack prove it still works? Manual end-to-end runs don't scale past a handful of stacks. A scheduled canary is the product's CI; until one exists, someone has to run the bench by hand"; success row "Stacks don't rot: A stack that passed last month still passes this month without a prose change"; assumption "Version-less prose rots much more slowly than templates ... How to validate: The scheduled canary; count prose edits per stack per quarter" |
| Depends on | [2.0b](../archive/phases/phase-2.0b-bench-2026-10-30.md) (the bench this schedules), [5.0](phase-5.0-ci-release-and-checks.md) (CI that validates ledger PRs), D15 (where and how it runs), D24 (headless agent auth). Uses [2.0c](../archive/phases/phase-2.0c-run-ledger-2026-10-30.md)'s `LedgerRecord` and [2.0a](../archive/phases/phase-2.0a-composed-files-and-fingerprint-2026-10-30.md)'s fingerprint |
| Blocks | Nothing. [4.0c](../archive/phases/phase-4.0c-registry-index-2026-10-30.md) publishes whatever the ledger holds; canary records make it fresher |
| Decisions needed | D15 (isolation, account, token). If the answer differs (for example a GitHub-hosted runner with a model API key), this file is rewritten before work starts. D24 (token auth); without it there is no unattended login. D8 as revised (canary in phase 5). [Open question 11](../risks-and-open-questions.md#open-questions-for-the-maintainers) (full permissions; this sub-phase is the "unattended runs are isolated" half). [Open question 13](../risks-and-open-questions.md#open-questions-for-the-maintainers) (token scopes, now in D15). [Open question 21](../risks-and-open-questions.md#open-questions-for-the-maintainers) (the 80%-per-month target; it decides what the monthly report flags) |
| Settles | The schedule and caps, the isolation layout, runner state, the classification classes, the canary report's format, and the quarterly prose-edit count assumption 2 asks for |

## Scope

Where this fits: 2.0b already gives a maintainer one command that packs the CLI,
scaffolds a stack into a throwaway directory, drives an agent headlessly with a long-lived
token (D24), runs the final `verify` itself and produces a `LedgerRecord`. 2.0c owns the
ledger at `packages/cli/registry/runs.json`, including the `infra` result, `agentVersion`
and the repo commit. This sub-phase adds no new way to run a stack: it runs 2.0b's bench
unattended, in isolation, on a schedule, and turns the records into PRs and issues.
Sibling 5.0 makes CI validate the ledger PRs this opens; 5.2 deploys the index that
publishes the results.

In:

- A runner that benches every bundled stack (default fragments, sandbox preset) with each
  configured agent, one at a time, on a schedule.
- The isolation layout from D15 and [trust model point 8](../roadmap.md#trust-model).
- Runner state: a dedicated clone, a local outbox, a lock.
- Classification of each record against the previous one for the same key, with
  infrastructure failures kept out of rot.
- Reports: one ledger PR, kept current; an issue per stack when rot or a regression is
  found; a `canary-infra` issue for infrastructure failures.
- Caps on wall time per run and runs per week.
- A monthly pass-rate report and a quarterly prose-edit report.

Out:

- Running optional-fragment combinations on a schedule (one combination per stack per
  month at most, added only if a stack's optional fragments start failing in user
  reports).
- Any inference in GitHub-hosted CI, and any model API key in repository secrets (D15).
- Repairing a stack automatically. The canary reports; a person or an agent session fixes
  prose with the run note in hand.
- Merging ledger PRs. A maintainer merges them after `ci-ok`.
- Protecting result integrity against a determined agent (see "What isolation buys").

## Design

### Where it runs (D15)

A machine the maintainers control, with the agent CLIs installed, under a maintainer's own
agent subscription. Two OS accounts on it:

| Account | Holds | Runs |
|---|---|---|
| Runner account (`qs-canary`) | The GitHub token (a file readable only by this account), the dedicated clone, the outbox, the lock, logs | The scheduler entry, `canary.ts`, classification, `gh` |
| Agent account (`qs-agent`) | Only the agent's long-lived token (D24), in a file in its own home readable only by itself | The bench (2.0b) and everything it starts: the agent, the CLI, `verify` and the project's own commands |

Decided here: a separate OS user, not a container, as the default. Stacks need the host's
toolchains (Node, Python, Go and whatever the bundled stacks name), installed the way a
user's machine has them and updated by the OS package manager. A container image would
freeze those versions, which hides exactly the upstream movement the canary exists to
see. A VM or container holding only the agent's login also satisfies D15; a maintainer
who prefers one replaces the `AgentSandbox` layer below and keeps everything else.

The trust rules are [trust model point 8](../roadmap.md#trust-model). How this layout
meets each:

- **Only the agent's login.** `qs-agent` has no GitHub credentials, no SSH keys, no model
  API keys and no access to `qs-canary`'s home (mode `700`). The bench code and the
  packed CLI it runs are owned by `qs-canary` and not writable by `qs-agent`.
- **Environment built from scratch.** `qs-canary` starts the bench through one sudoers
  rule that allows exactly `sudo -n -u qs-agent <clone>/packages/cli/scripts/canary/agent-entry.sh`.
  That entry is a short POSIX `sh` script, not Bun, because it must clear the environment
  before any runtime loads config: it `exec env -i` with a fixed list (`PATH` of the
  toolchain directories, `HOME`, `LANG`, `TMPDIR`), adds the token variables from
  `qs-agent`'s own token file, and runs the bench. Nothing travels on a command line, so
  the token never shows in `ps`. Excluded by construction: `GH_TOKEN`, `GITHUB_TOKEN`,
  every model API key variable, and every agent session marker in `config.ts::AgentMarkers`
  (see roadmap, Contracts: Agent detection and TTY). Included by construction:
  `DO_NOT_TRACK=1`. The bench already sets it in the agent's environment (2.0b), and the
  entry sets it again so canary runs, which use the packed release build, never send
  usage telemetry (4.1a). A canary install would otherwise be one of the largest
  contributors to every stack it runs and skew 4.2a's numbers.
- **Posts only after the agent's process group exits.** When the bench exits or the wall
  cap hits, `qs-canary` kills every process owned by `qs-agent` (`pkill -KILL -u qs-agent`,
  then waits until none are left), which also catches anything that left its process group
  with `setsid`. Only then does it read the bench's output and call `gh`.
- **A token that user can't read.** The GitHub token lives only in `qs-canary`'s home and
  is passed only to `gh` child processes, through `Processes` with an explicit
  environment.

### What isolation buys

It protects the maintainer's home, the GitHub token and the host from an agent running
with full permissions and from the upstream code it installs. It doesn't make a canary
record more trustworthy than any other `verify` run: an agent can still weaken a project
command, which the tamper digest can't see (trust model point 5, open question 9). The
runner reads everything `qs-agent` produced as untrusted data: the `LedgerRecord` is
decoded with its schema, and a record that doesn't decode is an `infra` result, never a
pass.

### GitHub token and branch protection (D15)

A fine-grained token on this repository only, with contents write and pull-request
write, and `main` protected so the token can't push to it. Because a fine-grained token
acts as the maintainer who created it, the protection must have "do not allow bypassing
the above settings" on; otherwise an admin's token bypasses it. The runner opens issues
too, which needs issues write. Issues write is also needed; see D15 and the first bullet of
"What this plan may get wrong".

The runner calls GitHub only through the `gh` CLI (roadmap, Other shared facts: New
dependencies), with `GH_TOKEN` set in that child's environment and nowhere else.

### Runner state

| Thing | Where | Rule |
|---|---|---|
| Dedicated clone | `qs-canary`'s home | Before each run: `git fetch origin`, `git reset --hard origin/main`, `git clean -fdx`. The canary always runs what is on `main`; no local edits survive |
| Config | `packages/cli/scripts/canary.json` in that clone | Stacks, agents, caps, per-stack frequency. Changed by PR like any other file |
| Outbox | `qs-canary`'s state directory, one JSON line per record | Every record the runner produced that isn't yet in the merged ledger. A record leaves the outbox when `origin/main`'s ledger contains it (matched on stack, fragments, agent, date and fingerprint) |
| Lock | Same state directory | Held for the whole run; a second trigger exits 0 |

Classification reads the merged ledger plus the outbox, so a record waiting in an
unmerged PR still counts as the previous result.

The ledger PR is one branch, `canary/ledger`, regenerated on every run from `origin/main`
plus the outbox and force-pushed (allowed: it isn't protected). One open PR at a time,
titled with the date range it covers; it conflicts with nothing because it is rebuilt from
`main` each time.

### Schedule and caps

| Setting | Default | Why |
|---|---|---|
| Frequency | Each stack weekly, staggered so one stack runs per night | Upstream majors move on the scale of weeks; daily runs cost seven times more for little extra signal |
| Agents | The first configured agent every week; each other configured agent once a month | Agent changes cause failures too, but the stack signal comes from one steady agent |
| Wall time per run | 60 minutes, passed to the bench as its cap; at the cap the run is `fail` with `agentEnded: "timeout"` | Twice the slowest MVP gate run; a run that needs more is itself a finding |
| Runs per week | 10, a hard cap in the runner | Bounds subscription usage; extra runs queue to the next night |
| Concurrency | One run at a time | Port and CPU contention would make failures about the machine |

Triggered by the OS scheduler: a `launchd` daemon with `UserName` set to `qs-canary` on
macOS, a systemd timer with `User=qs-canary` on Linux. The unit text is in
`docs/canary.md` to copy, not committed as an installer.

### The runner

`packages/cli/scripts/canary.ts`, an Effect program like the other scripts, using
`Processes` for every child process (roadmap, Contracts: Process service). One run:

1. Take the lock; reset the clone; read `canary.json`.
2. Pick tonight's stack and agent from the date, the config and the weekly count.
3. Build and pack the CLI as `qs-canary` (2.0b's packing step), so `qs-agent` runs a
   read-only artifact.
4. `AgentSandbox.run`: start `agent-entry.sh` as `qs-agent` with the stack, agent and
   cap; collect the bench's stdout (its `LedgerRecord` and run-note text).
5. `AgentSandbox.killAll`, then decode the output.
6. Classify, rerunning once if the rules below say so (steps 4 to 6 again).
7. Append to the outbox; regenerate and push `canary/ledger`; open, comment on or close
   issues.

`AgentSandbox` is a `Context.Service` with `run` and `killAll`. The real layer uses
`sudo -u qs-agent` and `pkill -u qs-agent`; the test layer runs the fake agent as the
current user in its own process group. This is the seam that lets everything except the
second OS account be tested in `bun run check`.

### Results and classification

The bench's `result` values come from 2.0c's `LedgerRecord`: `pass`, `partial`, `fail`
and `infra` (see roadmap, Contracts: Ledger). This file uses `timeout` as shorthand for a
`fail` record with `agentEnded: "timeout"`; it is a classification input, not a new
`result` value. The runner sets `infra` itself,
from the bench's own failure output, when:

- the agent exited with an error that its JSON output marks as an error subtype (auth,
  rate limit, usage limit, an API error) rather than a finished turn,
- the agent wrote no files into the project,
- the bench failed before scaffolding (agent missing, token expired),
- the output didn't decode, or the machine itself failed (disk full, toolchain missing).

The previous record for a key (stack, fragments, preset, agent) is the latest one in the
merged ledger plus outbox whose `result` isn't `infra`.

| Previous | Now | Also | Class | Report |
|---|---|---|---|---|
| any | `infra` | | `canary-infra` | One open `canary-infra` issue for the machine; comment on it per occurrence. Never `rot`, never touches the stack's issue |
| `pass` | `pass` | | `green` | Ledger PR only |
| `pass` | `fail` or `timeout`, then `pass` on the rerun | | `flaky` | Ledger PR lists it; no issue |
| `pass` | `fail` or `timeout` twice | same fingerprint, `agentVersion` and CLI version | `rot` | Issue: "<stack> stopped passing with no prose change" |
| `pass` | `fail` or `timeout` twice | same fingerprint, different `agentVersion` or CLI version | `tooling-changed` | Issue naming which version moved |
| `pass` | `fail` or `timeout` | different fingerprint | `regression` | Issue: "<stack> fails after its last prose change", linking the commit range between the two records' repo commits |
| `fail` or `timeout` | `pass` | | `recovered` | Comment on and close the open issue |
| `fail` or `timeout` | `fail` or `timeout` | | `still-failing` | Comment on the open issue with the new run note |
| none | any non-`infra` | | `first` | Ledger PR |

`partial` is set by a person reviewing notes (2.0b), so the runner never produces it; a
previous `partial` is treated as `fail` for classification.

`rot` is the signal assumption 2 is about: the prose didn't move, the agent and CLI
didn't move, and the world did. Splitting out `tooling-changed` uses the `agentVersion`
and CLI version 2.0c records, so an agent release can't be counted as rot. A `rot` that
keeps recurring for one tool is a candidate for a verify step that asks the tool itself (a
framework's own doctor command), per 1.6a's content rules.

### Reports

The issue body has: stack, agent and `agentVersion`, CLI version, repo commit,
fingerprint, the class, the failing verify steps with exit codes and the last
`TAIL_LINES` lines of each (roadmap, Contracts: Output tail size), time to failure, the
agent's `NOTES.md`, and a link to the previous passing record.

Everything from `qs-agent` is untrusted text, so before posting the runner:

- replaces the throwaway directory and both accounts' home paths with placeholders;
- removes the agent token's exact value and anything shaped like a known credential
  (`github_pat_`, `gh[pousr]_`, `sk-`, `sk-ant-` prefixes, PEM blocks);
- puts all agent-produced text inside fenced code blocks, so `@name` mentions notify
  nobody and Markdown can't render links or images;
- caps the body at a fixed size, keeping the head and tail.

### Monthly and quarterly reports

`canary.ts --monthly` prints, per stack and agent: runs, passes, pass rate and the sample
count beside it. The 80%-per-month target means about four weekly samples per stack, so
one failure (75%) misses it; the canary report always shows `n` and marks a miss with fewer than
eight samples as "below target, small sample" rather than a plain miss, until open
question 21 is answered.

`canary.ts --quarterly` prints, per stack: commits touching the entry in the quarter,
`rot`, `tooling-changed` and `regression` issues, median `minutesToGreen`, and pass rate.
The maintainers paste it into HANDOFF or a run note; it is the validation row for
assumption 2.

### Failure modes

| Case | Handling |
|---|---|
| Machine asleep or offline | The next run sees the gap in ledger dates; the ledger PR lists missed stacks, so silence is never read as green |
| Agent token expired or revoked | Bench fails before scaffolding: `infra`, `canary-infra` comment |
| Agent usage limit hit | `infra` from the agent's error subtype; the weekly cap is the lever |
| GitHub unavailable or `gh` fails | Records stay in the outbox; posted on the next run |
| A run hangs past the cap | The bench kills the agent's group; `killAll` kills the rest; `timeout` |
| The agent left a background process | `killAll` before anything is read or posted |
| Two scheduler triggers overlap | Lock; the second exits 0 |
| Clone diverged or dirty | Reset to `origin/main` before every run |
| Ledger PR closed unmerged | Its records are still in the outbox; the next run opens a new one |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/scripts/canary.ts`, `packages/cli/scripts/canary.json` | Runner and config |
| `packages/cli/scripts/canary/classify.ts` | Pure classification |
| `packages/cli/scripts/canary/report.ts` | Issue and PR text, redaction |
| `packages/cli/scripts/canary/sandbox.ts` | `AgentSandbox` service, real and test layers |
| `packages/cli/scripts/canary/state.ts` | Clone reset, outbox, lock |
| `packages/cli/scripts/canary/agent-entry.sh` | The `env -i` entry run as `qs-agent` |
| `packages/cli/tests/canary.test.ts` | Below |
| `docs/canary.md` | Creating the two accounts, the sudoers rule, the token file locations, the scheduler units, token scopes and branch protection, how to pause it, the isolation probe |
| `AGENTS.md` | The canary's existence, where its issues land, the `canary-infra` label |

`scripts/` is already excluded from the package's `files` (0.2), so none of this ships.

## Acceptance tests

- `classify`: a table test with every row above, including rerun-before-`rot`, `flaky`,
  `tooling-changed`, a previous `infra` record being skipped, and a previous `partial`
  treated as `fail`.
- Previous-record lookup: a record only in the outbox is used as previous; once the
  merged ledger fixture contains it, it leaves the outbox and isn't counted twice.
- Environment: with `GH_TOKEN`, `GITHUB_TOKEN`, a model API key and every `AgentMarkers`
  variable set in the runner's environment, a fake agent that dumps its environment sees
  only the fixed list (including `DO_NOT_TRACK=1`) plus the agent token variable. This
  runs `agent-entry.sh` directly as the current user.
- Telemetry: a fake agent that runs the packed CLI's `new` and `verify` with
  `STACKS_TELEMETRY_URL` pointed at a recording server (and the release-build seam on,
  as in the packed tarball) leaves the server with no request and the telemetry spool
  empty.
- Ordering: a fake agent that starts a `setsid` sleeper and exits; the fake `gh` on
  `PATH` (records each call) is called only after the test sandbox's `killAll` has
  returned and the sleeper is gone.
- Infra: a fake agent that exits with an auth error subtype and writes nothing gives
  `infra` and `canary-infra`, never `rot`, even after a previous `pass` with the same
  fingerprint; undecodable bench output gives `infra`.
- Report: built from real temp directories and a fake token value; the text contains
  none of the paths, not the token, no credential-shaped string, and every `@` from agent
  text sits inside a code fence.
- Runner with a fake bench: picks the right stack for a given date, respects the weekly
  cap, writes to the outbox when `gh` fails, exits 0 when the lock is held, and resets a
  fixture clone with a local commit and a dirty file to the fixture's `origin/main`.
- `--monthly` and `--quarterly` against a fixture ledger and git history print the
  expected counts, including the small-sample marking.
- On the canary machine, by the maintainers, the isolation probe in `docs/canary.md`: a
  fake agent run as `qs-agent` tries to read the GitHub token file, a marker file in the
  maintainer's home and `qs-canary`'s home; all three fail.

## Exit criteria

- `bun run check` green from the repo root.
- D15 and D24 agreed and recorded in the README decisions log; open question 21 answered
  or explicitly left open.
- The isolation probe passed on the canary machine.
- The canary has run each bundled stack at least once on schedule and opened a ledger PR
  that passed `ci-ok`.
- A manual `canary.ts --once --ref <branch> --no-post` on a branch with a deliberately
  broken stack classifies `regression`; an expired-token run classifies `canary-infra`.
  (`--ref` and `--no-post` are for these manual runs only; scheduled runs always use
  `origin/main` and post.)
- `docs/canary.md` and `AGENTS.md` updated; HANDOFF lists the canary machine's owner role
  (the maintainers) and how to pause it.

## What this plan may get wrong

- D15 and open question 13 give the token contents, pull-request and issues write. If the
  maintainers want the token narrower, the runner reports through the ledger PR body only
  and the issue rows above become PR comments.
- Separate-user isolation on macOS is less tidy than on Linux (`launchd` daemons, keychain
  prompts for the agent account). If an agent's headless token flow (D24) still needs
  the keychain, that agent runs in a Linux VM instead.
- Weekly may be too slow for a fast-moving stack and too fast for a stable one. The
  config allows per-stack frequency; set it from the first quarter's `rot` counts.
- A subscription-based agent account may have usage limits that change. The weekly cap
  is the lever; if limits tighten, drop the monthly second-agent runs first.
- `rot` assumes the fingerprint covers everything the agent read. It excludes the CLI's
  brief text by design (2.0a), which is why `tooling-changed` compares the CLI version too.
