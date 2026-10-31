# Phase 0.3b: Processes and signals

Status: EXECUTED 2026-10-26 on branch `feat/phase-0` (deviations under "Found while
executing"; the `npm exec` wrapper case waits for 0.2). Answers A3 as a recommendation;
the maintainers review it, and it must be in the decisions log before [1.6c](phase-1.6c-first-release-2026-10-30.md)
publishes.

| Field | Value |
|---|---|
| Goal | The CLI can run a shell command in its own process group with a bounded output tail, a timeout and a drain, start a long-running one that dies with its scope, run a program from an argv list with no shell, find an executable on `PATH`, build a child's environment, and hand the terminal to an interactive program without fighting it for signals, with no child outliving the CLI |
| Traces to | The CLI hands off "to the agent the user already has"; the agent "loops on `verify`", which runs install, test and dev-server commands that take minutes |
| Depends on | [0.3a](phase-0.3a-errors-and-output-2026-10-30.md) (error table, `Output.flushNow`) |
| Blocks | [1.2a](phase-1.2a-new-scaffold-and-templates-2026-10-30.md) (`git`, missing-tool checks with `Processes.which`), [1.2b](phase-1.2b-manifest-state-and-detection-2026-10-30.md) (`childEnv` takes its marker list), [1.3a](phase-1.3a-verify-runner-and-probes-2026-10-30.md) (steps, dev servers, tails, `childEnv`), [1.4](phase-1.4-handoff-and-entry-points-2026-10-30.md) (`interactive` and the signal policy), [2.0b](phase-2.0b-bench-2026-10-30.md), [3.2a](../../phases/phase-3.2a-git-sources-and-untrusted-origin.md) (`Processes.exec` for git on user-supplied URLs), [4.0d](phase-4.0d-cli-remote-origin-2026-10-30.md) (adds its HTTP client adapter to the `src/platform/` this sub-phase creates) |
| Decisions needed | None from the product list. A3 ([roadmap, open architecture questions](../../roadmap.md#open-architecture-questions)) is answered here and reviewed by the maintainers ([0.0](../../phases/phase-0.0-decisions-and-npm-name.md)). If the review prefers forwarding SIGINT to the child over ignoring it, the policy table changes and the double-delivery test below becomes the main risk |
| Settles | A3 (once agreed); the `Processes` contract, `TAIL_BYTES` and `TAIL_LINES`, `Processes.exec`, `Processes.which`, `config.ts::childEnv`; `src/platform/` as the one place Node process APIs live |

## Scope

In:

- `src/services/processes.ts::Processes` with `run`, `start`, `exec`, `interactive` and
  `which`, and its types `ShellSpec`, `ArgvSpec`, `Finished`, `Captured`, `Running`,
  `SpawnFailed`.
- The new `src/platform/` directory with `src/platform/process.ts` (group signals,
  liveness, and any direct `node:child_process` use) and `src/platform/signals.ts`, and
  the Grit rule that keeps Node process APIs there and in `bin.ts`.
- Process groups, the kill sequence, the 2 s drain, and a registry of live groups that
  `bin.ts` kills on a forced exit.
- `config.ts::childEnv` and the captured `PATH`.
- A3: the signal policy in `bin.ts`, with the `Foreground` holder and the 1 s rule for a
  second Ctrl+C.

Out: the error table, `details` and `Output` changes ([0.3a](phase-0.3a-errors-and-output-2026-10-30.md));
any product command. Verify (1.3a) and handoff (1.4) are the first users. The list of
agent session markers (`config.ts::AgentMarkers`) is 1.2b's; `childEnv` takes the names to
remove as an argument.

## Design

### Where this fits

[0.3a](phase-0.3a-errors-and-output-2026-10-30.md) fixed how outcomes are reported and gave
`Output.flushNow`. This sub-phase adds the service that starts processes and the policy
that decides what a signal means while they run. Handoff (1.4) calls `Output.flushNow`,
then `Processes.interactive`, under the policy here. `SpawnFailed` is internal and needs no
row in 0.3a's table: it reaches `main` only as a `Defect` when a caller doesn't handle it
(see roadmap, Error tags).

### The service

A `Context.Service` named `stacks/Processes` (see roadmap, Contracts: Process
service, Output tail size, PATH lookup). This sub-phase owns it:

```ts
export const TAIL_BYTES = 256 * 1024; // kept per process
export const TAIL_LINES = 60;         // reported in Finished.tail
type ShellSpec = {
  command: string;              // run through /bin/sh -c
  cwd: string;
  env: Record<string, string>;  // the whole environment, from childEnv; nothing inherited
  timeout?: Duration.Duration;
};
type ArgvSpec = {
  argv: readonly [string, ...string[]]; // argv[0] is the program; no shell, no expansion
  cwd: string;
  env: Record<string, string>;
  timeout?: Duration.Duration;
};
type Captured = {
  exitCode: number;
  signal?: string;
  durationMs: number;
  stdout: string;               // kept separately from stderr, each capped at TAIL_BYTES
  stderr: string;
  truncated: boolean;           // a cap was hit
  timedOut: boolean;
};
type Finished = {
  exitCode: number;             // 128 + n when killed by signal n
  signal?: string;
  durationMs: number;
  tail: string;                 // last TAIL_LINES lines of combined stdout and stderr
  timedOut: boolean;
  pipesHeld: boolean;           // output still open after the drain; group killed
};
interface Processes {
  run(spec: ShellSpec, onOutput?: (chunk: string) => Effect.Effect<void>):
    Effect.Effect<Finished, SpawnFailed>;
  start(spec: ShellSpec): Effect.Effect<Running, SpawnFailed, Scope.Scope>;
  exec(spec: ArgvSpec): Effect.Effect<Captured, SpawnFailed>;
  interactive(spec: { bin: string; args: string[]; cwd: string; env: Record<string, string> }):
    Effect.Effect<number, SpawnFailed>;
  which(name: string): Effect.Effect<Option.Option<string>>;
}
interface Running {
  readonly exited: Effect.Effect<Finished>;
  readonly tail: Effect.Effect<string>;
}
```

The live layer is built on `effect/process` (`ChildProcess`, with the
`ChildProcessSpawner` that `NodeServices` provides once [0.2](phase-0.2-npm-distribution-artifact-2026-10-30.md)
switches `bin.ts` to Node; `BunServices` provides one too until then). Every direct Node
process call lives in `src/platform/process.ts`, which this sub-phase creates:
`killGroup(pid, signal)`, `groupAlive(pid)` (both on `process.kill`), and, if
`effect/process` can't give the spawn options below, the spawn itself on
`node:child_process`. `services/processes.ts` calls the adapter and touches no Node
process API, so it stays testable and platform-free like the rest of `src/`.

The boundary rule (see roadmap, Other shared facts: Environment): Bun and Node process
APIs are used only in `bin.ts` and `src/platform/`. `biome-plugins/boundaries.grit`
gains one pattern for `process.kill`, `process.on`, `process.exit` and imports of
`node:child_process`, `child_process` and `@effect/platform-node`, allowed only in
`src/bin.ts` and `src/platform/**`, next to the existing Bun pattern. Later adapters (the
HTTP client and sockets of 1.3a and 4.0d) go in `src/platform/` under the same rule.

### Spawn options

| Method | `detached` | stdin | stdout, stderr | Why |
|---|---|---|---|---|
| `run`, `start` | `true`: the child leads a new process group | `ignore` | piped into the bounded tail |
| `exec` | `true`, as `run` | `ignore` | piped, kept separately (`Captured.stdout`, `Captured.stderr`), each capped at `TAIL_BYTES` | Group kill reaches every descendant; a step that reads stdin gets EOF instead of hanging verify |
| `interactive` | `false`: the child stays in stacks's process group, which is the terminal's foreground group | inherit | inherit | The terminal's Ctrl+C reaches the agent, and the agent can read the TTY |

`effect/process`'s `CommandOptions.detached` defaults to `true` on Unix, so
`interactive` must pass `false` explicitly. Left at the default, the agent would run in
its own background group: Ctrl+C would never reach it and its first TTY read would stop it
with SIGTTIN.

### Process groups and cleanup

- On interruption, timeout or scope close, the service sends SIGTERM to the group, waits
  5 seconds, sends SIGKILL, and only then completes.
- Every group the service creates is registered in a holder that `bin.ts` creates and
  passes into the layer (the same per-invocation holder as `Foreground` below; no module
  global). A group leaves the registry once it is confirmed gone.
- Liveness is `platform/process.ts::groupAlive`, which calls `process.kill(-pid, 0)`: success or EPERM means still alive (on macOS a
  zombie member can return EPERM), ESRCH means gone. Effect's spawner treats any error as
  gone; the registry doesn't rely on that check.
- Before any forced `process.exit` (the second Ctrl+C below) and in a
  `process.on("exit")` handler, `bin.ts` sends SIGKILL to every registered group,
  synchronously. A forced exit skips finalizers, so without this, dev servers started by
  `start` would survive the CLI.

### `run` completion and the drain

`run` resolves when the shell exits and its stdout and stderr have closed, waiting at most
2 s after the exit for them to close. A step that backgrounds a process
(`sh -c 'npm run dev &'`) leaves a grandchild holding the pipes open, which would hang
verify. When the pipes are still open after the drain, the service SIGKILLs the group,
sets `pipesHeld: true`, and appends one fixed line to the tail:
`stacks: output was still open 2s after the command exited; its process group was killed.`
The exit code stays the shell's. 1.3a turns `pipesHeld` into its self-backgrounding
finding.

`start` has no drain: it is for long-running processes, which end when their scope
closes.

### `exec`: argv with no shell

`exec` runs `argv[0]` with the rest of `argv` as its arguments, passed to the spawner as
a list, never joined into a string and never given to `/bin/sh`. Nothing in an argument
is expanded: `;`, `$()`, backticks, globs and quotes reach the program byte for byte.
It is for the CLI's own tools called with values a user supplied, such as `git` on a
source URL (3.2a), where a shell would turn the value into code. It resolves when the
process exits and its pipes close, with the same 2 s drain and group kill as `run` (a
held pipe after the drain sets `truncated` and kills the group), applies `timeout` the
same way, and fails `SpawnFailed` with `kind: "command"` when `argv[0]` is missing or not
executable. Callers resolve `argv[0]` with `which` first when they want a clear
missing-tool message.

Output is kept in a ring of `TAIL_BYTES` per process, and `Finished.tail` reports the last
`TAIL_LINES` lines of it. No sub-phase picks its own size. `onOutput`, when given, receives
each chunk as it arrives (1.3a passes it to `Output.progress`).

### `SpawnFailed`

Under `/bin/sh -c`, a command that isn't installed is not a spawn failure: the shell runs
and exits 127, and `run` returns a normal `Finished` with `exitCode: 127`. 1.3a reports
that as an environment failure of the step. `SpawnFailed` is only for the cases where no
process could start:

| `kind` | Cause | Typical errno |
|---|---|---|
| `cwd` | The working directory is missing or not accessible | ENOENT, ENOTDIR, EACCES |
| `shell` | `/bin/sh` is missing | ENOENT |
| `command` | `interactive` and `exec`, which run a binary without a shell: the binary is missing or not executable | ENOENT, EACCES |
| `resources` | The system refused a new process | EAGAIN, EMFILE, ENOMEM |

`SpawnFailed` carries `kind` and the `errno` code string. It is a `Schema.TaggedError` but
not part of `AppError`, so it is `Defect` unless the caller handles it.

### `which`

`Processes.which(name)` is the only PATH search in the CLI (see roadmap, Contracts: PATH
lookup). It reads the `PATH` that `config.ts` captured, never `process.env`, and checks
each directory in order through `FileSystem`: the first regular file with an execute bit
wins. Empty `PATH` entries are skipped rather than read as the cwd. A name containing `/`
is checked as a path. No shell.

### Child environment

`config.ts::childEnv` builds a child's whole environment from the environment `config.ts`
captured (see roadmap, Contracts: Child environment). It takes the names to remove and
any values to set, and returns a plain record; `ShellSpec.env` passes it whole, so tests
control exactly what a child sees. 1.2b supplies `AgentMarkers` as the names verify steps
drop. `config.ts` stays the only reader of the process environment.

### A3: the signal policy

`bin.ts` today aborts the whole program on SIGINT or SIGTERM. It gains a `Foreground`
holder, created per invocation and provided as a layer, so `Processes.interactive` can
register its child for as long as it runs. The decision is a pure function in
`src/platform/signals.ts` (state, signal, time in, action out), wired up in `bin.ts`.

| Signal | No interactive child | Interactive child in the foreground |
|---|---|---|
| SIGINT, first | Interrupt the program; finalizers run (teardown, group kills); exit 130 | Ignored here. The terminal already delivered it to the whole foreground group, including the child; the child decides |
| SIGINT within 1 s of the first | Ignored as the same Ctrl+C | Ignored |
| SIGINT 1 s or more after the first, while cleanup runs | SIGKILL every registered group, then `process.exit(130)` | Ignored |
| SIGQUIT | Default | Ignored |
| SIGTERM | Interrupt, as SIGINT | Forwarded to the child; stacks waits for it to exit |
| SIGHUP | Interrupt, as SIGINT | Forwarded to the child |

The 1 s rule exists because one Ctrl+C can arrive twice. `scripts/dev.ts` forwards SIGINT
to the CLI, and so does `npm exec` (what `npx` runs), while the terminal also delivers it
to the whole group. Without the rule, one keypress under `bun run dev` or `npx` would skip
every finalizer.

Before an interactive child starts, the caller flushes buffered output with
`Output.flushNow` (0.3a). What exit status a command reports after an interactive child
is the command's decision (1.4 decides it for handoff).

Why not `exec`: Node has no `exec(3)`. Spawning and waiting is the only option, so this
policy is what keeps Ctrl+C belonging to the agent.

### Failure modes

| Situation | What happens | What the caller sees |
|---|---|---|
| A step's command isn't installed | The shell exits 127 | `Finished.exitCode` 127; 1.3a reports an environment failure |
| The step's cwd doesn't exist | No process starts | `SpawnFailed`, `kind: "cwd"` |
| A child ignores SIGTERM | SIGKILL after 5 s | As interrupted or timed out |
| A step backgrounds a process | Drain of 2 s, group SIGKILLed | `pipesHeld: true`, fixed note in the tail |
| A step reads stdin | It reads EOF | Whatever the step does with no input |
| One Ctrl+C delivered twice | The second is ignored | Normal cleanup, exit 130 |
| A second Ctrl+C during a slow teardown | Registered groups SIGKILLed, exit at once | Exit 130, no orphaned dev server |

## Files and areas touched

New `packages/cli/src/services/processes.ts`, new `src/platform/process.ts` (the
directory is new), new `src/platform/signals.ts`, `biome-plugins/boundaries.grit` (the
Node process pattern) and its Grit probe test on real files, `src/bin.ts` (holder, signal wiring, exit-time group kill),
`src/config.ts` (captured `PATH`, `childEnv`), `src/errors.ts` (`SpawnFailed`, outside
`AppError`), `src/runtime.ts` (`AppLayer` adds `Processes`), `tests/helpers/cli.ts` (a
`Processes` layer that runs real processes), new `tests/processes.test.ts`, new
`tests/signals.test.ts` with fixtures, `AGENTS.md` (Architecture map: `Processes` and `src/platform/`;
Conventions: Node process APIs only in bin and `src/platform/`; Error handling: the 1 s
rule and exit-time group kill), `.claude/rules/cli/cli.md` (the same boundary sentence).

`bin.ts` is shared with 0.2: land one, then rebase the other (roadmap, lanes table).

## Acceptance tests

Processes, with real processes through `tests/helpers/cli.ts`:

- `run` of `sh -c 'exit 3'` returns 3; a command printing 10,000 lines returns the last
  `TAIL_LINES`, and the kept buffer never exceeds `TAIL_BYTES`.
- A `timeout` kills `sleep 60` and reports `timedOut`.
- `run` of `sh -c 'sleep 60 & echo hi'` resolves within about 3 s with `exitCode` 0,
  `pipesHeld: true`, `hi` and the fixed note in the tail, and the `sleep` gone.
- `run` of `sh -c 'cat'` returns at once (stdin is `ignore`).
- `run` of a missing command returns `exitCode` 127, not `SpawnFailed`; a missing cwd
  fails `SpawnFailed` with `kind: "cwd"`; `interactive` with a missing `bin` fails
  `kind: "command"`.
- A `start`ed process that spawns a grandchild leaves neither alive after its scope
  closes, checked with `kill(-pid, 0)` under the EPERM rule.
- `interactive`: the child reports its own process group id, which equals the parent's.
- `exec` with `argv: ["node", "-e", "process.stdout.write(process.argv[1])", "a; touch pwned $(touch pwned2) `id`"]`
  prints that last argument exactly and creates neither `pwned` nor `pwned2` in its cwd;
  stdout and stderr come back separately; a missing `argv[0]` fails `SpawnFailed` with
  `kind: "command"`; a `timeout` kills `sleep 60` with `timedOut: true`.
- Grit: a file under `src/core/` calling `process.kill` or importing `node:child_process`
  gets the boundary diagnostic; the same code in `src/platform/process.ts` doesn't.
- `which` finds an executable in a temp `PATH`, skips a non-executable file and a
  directory of the same name earlier in `PATH`, and ignores empty entries.
- `childEnv` drops the names it is given and contains nothing that wasn't captured.

Signals, as subprocess tests in the style of `tests/dev-script.test.ts`, with a fixture
program under the real platform layer:

- An `interactive` Node child that traps SIGINT and writes a marker file: SIGINT to the
  process group leaves the parent running and the child handles it; SIGTERM and SIGHUP
  to the parent reach the child.
- Without a foreground child, SIGINT while a `start`ed process runs exits 130 with the
  group gone.
- Two SIGINTs 100 ms apart during a slow finalizer count as one: the finalizer completes,
  exit 130.
- Two SIGINTs 1.5 s apart during a slow finalizer exit at once with 130, and the
  registered group is gone.
- Through `bun run dev`: SIGINT to the group holding `scripts/dev.ts` and the CLI (the
  wrapper also forwards it) runs finalizers and exits 130 without a forced exit.
- Through `npm exec` of the packed tarball: the same case. It needs 0.2's pack script;
  whichever of 0.2 and 0.3b lands second adds it.

## Exit criteria

- `bun run check` green from the repo root, and the existing CI `check` job green on
  Linux and macOS (no workflow change).
- `AGENTS.md` describes `Processes`, the 1 s rule and the exit-time group kill.
- A3 handed to the maintainers' review in [0.0](../../phases/phase-0.0-decisions-and-npm-name.md);
  1.6c checks it is in the decisions log before publishing.

## What this plan may get wrong

- `effect/process` may not expose everything needed: the drain, `pipesHeld`, or a kill
  sequence on the group rather than the leader. Check the installed `ChildProcess` and
  `ChildProcessSpawner` types first; the fallback is spawning in the platform adapter
  above. Check too that its argv form never goes through a shell; if any option does,
  `exec` spawns through the adapter.
- Ignoring SIGINT while an interactive child runs assumes the terminal sends it to the
  whole foreground group, which is true when stacks was started from a shell. When
  an agent or a script sends SIGINT to stacks's pid only, the child never sees it.
  Forwarding it would make a terminal Ctrl+C arrive twice at the agent, which some agents
  read as "exit". Test the agent-launched case explicitly and record what happens.
- The 1 s window is a guess at how far apart a terminal's delivery and a wrapper's
  forward land. If the subprocess tests show forwarded copies arriving later on a slow CI
  runner, widen it rather than drop the rule.
- A setuid or differently owned group member answers EPERM forever, so the registry would
  never drop it. SIGKILL to it fails the same way; the exit-time kill ignores the error,
  and nothing waits on it.

### Found while executing (2026-10-26)

- `effect/process` was not used; the spawn lives in `src/platform/process.ts` on
  `node:child_process` (the fallback above). Checked in the installed 4.0.6
  `@effect/platform-node-shared/NodeChildProcessSpawner` (which `BunServices` re-exports):
  a process killed by a signal makes `handle.exitCode` fail with the signal name only in
  the error message, so there is no `(code, signal)` pair for `Finished.signal` and
  `128 + n`; its liveness check treats every `kill(-pid, 0)` error as gone, EPERM included;
  its `exit` listener SIGTERMs the whole group as soon as the leader exits non-zero, which
  would kill a backgrounded child before the 2 s drain; and its finalizer sends SIGKILL
  only when `forceKillAfter` is set. Its argv form passes `shell` through unchanged, so it
  would not have gone through a shell, and `detached` does default to `true` on Unix.
- Node reports a missing `cwd` as `ENOENT` on `spawn /bin/sh`, the same as a missing shell,
  so the service checks the cwd with `FileSystem.stat` first (`kind: "cwd"`, `ENOENT` or
  `ENOTDIR`). A cwd that exists but can't be entered fails at spawn with `EACCES` and is
  reported as `shell` (or `command` for `exec` and `interactive`).
- The holder is `services/processes.ts::Foreground` (`stacks/Foreground`), one
  per-invocation object with the registered groups and the interactive child's pid. bin
  provides it in its platform layer next to `Host`; the test helpers provide a fresh one.
- `childEnv` is a method on `AppConfig`, because the captured environment lives inside the
  config layer. `Processes.which` reads the captured `PATH` through `childEnv([])`.
- SIGQUIT's "Default" is done by removing the policy's listeners and re-raising the signal.
  A signal death skips `exit` handlers, so the registered groups are SIGKILLed first (an
  addition to the table, with a test).
- The 1 s rule applies to SIGTERM and SIGHUP as well as SIGINT: all three share the "first
  interrupt" time, so a SIGTERM right after a Ctrl+C is ignored and one later forces the exit.
- `start` has no drain: `Running.exited` resolves once the leader has exited and its output
  has closed, so a grandchild still holding the pipes keeps it pending (read as still
  running). `ShellSpec.timeout` on `start` kills the group from a fiber owned by the scope.
- After `run` or `exec` returns, a group member that outlived the shell with its output
  redirected gets the scope-close sequence (SIGTERM, 5 s, SIGKILL), so such a step can take
  up to 5 s longer. `exec` adds no note on a held pipe; `truncated` says so.
- The agent-launched case is tested: SIGINT to stacks's pid alone while an interactive
  child runs is ignored by stacks and never reaches the child. SIGTERM to the pid is
  still forwarded, so that is how a script stops a handoff.
- The signal tests run in Vitest and spawn a fixture (`tests/fixtures/signals.ts`, using
  `installSignalPolicy`, `BunServices` and the live `Processes`) under Bun, since `bin.ts`
  runs on Bun until 0.2. The dev-wrapper case copies `scripts/dev.ts` and runs
  `bun scripts/dev.ts` with the fixture as its `src/bin.ts`, as `tests/dev-script.test.ts`
  does, rather than `bun run dev`. The `npm exec` case is left to 0.2, which lands second.
- On macOS the forwarded and terminal-delivered copies of one Ctrl+C land well inside 1 s;
  CI has not run the tests yet.
- The boundary covers more than the three calls named above: the Grit rule and
  `.claude/hooks/guard-boundaries.ts` both match `process.kill`, `on`, `once`, `off`,
  `addListener`, `removeListener`, `prependListener`, `prependOnceListener` and `exit`, and
  imports of `node:child_process`, `child_process`, `node:process` and
  `@effect/platform-node`, outside `bin.ts` and `src/platform/`.
- A3 additions after review. A SIGINT left to the interactive child is remembered: if a
  wrapper's copy of it arrives after the child has exited, within 1 s, it is ignored rather
  than read as a first Ctrl+C. Only SIGINT gets this rule, because a SIGTERM shortly after
  should still stop the CLI. A SIGTERM or SIGHUP forwarded to the child is remembered too:
  when the child exits, the CLI is interrupted and exits 130, instead of carrying on with the
  command (`foregroundCleared`, called through the holder's `onForegroundCleared`). The table
  row "stacks waits for it to exit" now ends in 130.
- Teardown: a closing scope sends SIGTERM to every group it launched at once, and each
  group's SIGKILL is due 5 s after its own SIGTERM, so N groups that ignore SIGTERM take
  about 5 s, not N times that. Groups in different scopes are still stopped one scope at a
  time.
- A scoped watcher drops a group from the registry once its output has closed and the group
  is seen empty, and only registered groups are ever signaled, so a reused pid isn't hit.
  `start`'s timeout checks the whole group, not just the shell.
- `onOutput` is fed from a sliding queue of 1024 chunks: under a reader slower than the
  command, the oldest undelivered chunks are dropped (progress is best-effort; the tail is
  unaffected). The per-stream decoders are flushed at the end, so a trailing partial
  character arrives as U+FFFD.
- The kept tail starts at the next whole UTF-8 character when truncation cuts one, so it can
  be up to 3 bytes shorter than `TAIL_BYTES`.
- Node rejects some arguments synchronously (a NUL byte in argv or env). The adapter turns
  that into `SpawnFailed` with Node's code as `errno` (`ERR_INVALID_ARG_VALUE`) and the
  method's usual kind (`shell` for `run` and `start`, `command` for `exec` and
  `interactive`), rather than a thrown defect.
