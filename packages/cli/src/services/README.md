# services

This folder holds the services every command leans on to touch the outside world: printing
results and errors, starting child processes, reading facts about the machine and opening TCP
connections. When `stacks verify` runs a step, the step starts through `Processes`; when it
reports, the text goes out through `Output`.

## How it fits

Each file defines an Effect service (`Context.Service`, tagged `stacks/<Name>`) that code gets
with `yield* Output`, `yield* Processes` and so on, never by importing a Node API. `bin.ts`
builds the real layers once per process and `tests/helpers/cli.ts` builds them once per
`runCli`; tests swap in `Output.memory`, `Output.fixed` and `Host.memory` at those boundaries.

The layer rules from AGENTS.md ("Conventions") apply here as in `core/`: nothing in this folder
imports `commands/` or `platform/`, with one allowance: `processes.ts` imports
`platform/process.ts`, the only file that spawns and signals processes. The Grit rule in
`biome-plugins/boundaries.grit` enforces both. `output.ts` is the one file here allowed a Node
builtin (`node:util`, for styling and stripping escape sequences).

State is per invocation: `Output`'s result buffer, `Processes`' group registry and `Invocation`'s
notes all live inside their layer or factory, never at module level, so two runs in one test
process never share them.

## The flow through it

1. `bin.ts` reads the process facts into `Host`, creates the `Foreground` holder it shares with
   the signal policy (`platform/signals.ts`), and builds `Output.layer`, which settles the
   audience once with `output.ts::resolveAudience`.
2. A command buffers its result with `Output.result`, writes warnings with `Output.note`, live
   lines with `Output.progress` (human) or `Output.event` (JSON and agent), and runs children
   through `Processes`.
3. `main.ts` then calls `Output.flush` on success, or `Output.clear` and `Output.error` on
   failure, and reads what the command left in `Invocation` (an exit status, log fields, paths a
   rollback couldn't restore).

## Files

| File | What it owns |
| --- | --- |
| `output.ts` | The audience, the result buffer, every write to stdout and stderr, color, the live spinner line and the error envelope |
| `processes.ts` | `Processes` (`run`, `start`, `exec`, `interactive`, `which`), process-group lifecycle and timeouts, and the `Foreground` holder |
| `newest-bytes.ts` | The bounded buffer that keeps the newest bytes of a child's output |
| `host.ts` | `Host`: Node version, working directory, terminal flags and width, and the bundled asset paths |
| `invocation.ts` | `Invocation`: what a command reports back to `main` (exit status, log fields, incomplete rollback) |
| `net.ts` | `Tcp`, the interface for opening TCP sockets; `platform/net.ts` implements it |

## Terms

- **Audience**: `json`, `agent` or `human`, as `.claude/rules/cli/cli.md` ("Three audiences")
  defines it. Only the rendering differs between them.
- **Keeps-result failure**: a failure whose report stays on stdout before the envelope
  (`VerifyFailed`, `VerifyChanged`, `ValidationFailed`); `Output.error` doesn't repeat its
  `Next:` line.
- **Process group**: a child and everything it starts, signaled together. `run`, `start` and
  `exec` each give their child its own group; `interactive` keeps the child in the CLI's group so
  it owns the terminal.
- **Grace, drain**: stopping a group is SIGTERM, 5 s of grace, then SIGKILL. After a command
  exits, its output gets 2 s to drain before a group still holding the pipes is killed
  (`Finished.pipesHeld`).
- **Tail**: the last 60 lines of a step's output, cut from at most 256 KiB kept per stream.
- **Live line**: one stderr row redrawn as a spinner while human output waits on something; it
  clears when its scope closes.

## Where to start

Read `output.ts` from the `Output` service down, then the `Processes` service at the bottom of
`processes.ts` and the helpers it calls. AGENTS.md ("Error handling", "Signals") has the full
signal and output-stream rules.

Tests, all in `packages/cli/tests/`:

- `output.test.ts`, `audience.test.ts`: streams per audience, `progress`, `event`, `flushNow`
  and the audience rule.
- `human-live.test.ts`, `human-styling.test.ts`, `human-rendering-regression.test.ts`: the live
  line, color and `NO_COLOR`/`FORCE_COLOR`.
- `flush-interruption.test.ts`, `errors.test.ts`: flushing under interruption and the envelope.
- `processes.test.ts`: every `Processes` method with real children, timeouts and group cleanup.
- `handoff-signals.test.ts`, `verify-signals.test.ts`: processes under real signals.
- `boundaries.test.ts`: the import rules above.
