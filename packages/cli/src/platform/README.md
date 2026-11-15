# platform

This folder is the CLI's only direct contact with Node's process and network APIs: spawning
and signaling child processes, reacting to Ctrl+C and other signals, reading the working
directory, measuring text for the terminal, and the HTTP and TCP clients. Every command that
runs a verify step, launches a coding agent or makes a request ends up here.

## How it fits

`bin.ts` is the main caller. It reads the working directory (`cwd.ts`), installs the signal
policy (`signals.ts`), passes `width.ts::stringWidth` to `Host` and provides `net.ts::NetLayer`.
The one other caller is `services/processes.ts`, which builds the `Processes` service on
`process.ts` and is the only file outside this folder allowed to import it.

AGENTS.md ("Conventions") keeps Node process APIs (`process.kill`, `process.on`, `process.exit`,
`node:child_process`, `@effect/platform-node`) to `bin.ts` and this folder. `core/` and
`services/` never import from here (apart from that one `processes.ts` import), so they run the
same under the bundle and in tests. The Grit rule in `biome-plugins/boundaries.grit` enforces it.
Code here may read the wall clock (`Date.now`) because Node calls it back synchronously, outside
any Effect clock.

## The flow through it

1. `bin.ts` creates the per-invocation `ProcessHolder` (`services/processes.ts::Foreground`) and
   calls `signals.ts::installSignalPolicy` with it.
2. `Processes` spawns each child through `process.ts::spawnChild`, adds its process group to the
   holder, and stops it with `killGroup` and `groupAlive`.
3. When a signal arrives, `signals.ts::decide` says what it means given the signals before it
   and whether an interactive child holds the terminal. A forced exit, SIGQUIT and process exit
   SIGKILL every group still in the holder through `process.ts::killGroupsNow`.

## Files

| File | What it owns |
| --- | --- |
| `process.ts` | `spawnChild`, the kill helpers, `groupAlive` and the `ProcessHolder` shape shared with the signal policy |
| `signals.ts` | The signal policy (`decide`, `foregroundCleared`) and `installSignalPolicy` |
| `cwd.ts` | The working directory, or none when it was deleted under the shell |
| `width.ts` | `stringWidth`, a string's width in terminal columns |
| `net.ts` | `NetLayer`: the `HttpClient` (redirects not followed) and the `Tcp` socket service |

## Terms

- **Process group**: a process and everything it starts. Signaling the negative of the leader's
  pid reaches all of them.
- **Interactive child**: the coding agent `new` launches with the terminal. It stays in the
  CLI's process group, so the terminal's Ctrl+C reaches it directly; `ProcessHolder.foreground`
  holds its pid while it runs.
- **Second signal**: an interrupting signal within 1 s of the first (`SECOND_SIGNAL_MS`) is the
  same keypress delivered twice and is ignored; a later one forces the exit.

## Where to start

Read `signals.ts`, whose header states the whole policy, then `process.ts::spawnChild`. The
signal rules are also in AGENTS.md ("Error handling", the Signals paragraph).

Tests, all in `packages/cli/tests/`:

- `signals.test.ts`: `decide` and `foregroundCleared` as pure functions, and the installed
  policy against real processes.
- `handoff-signals.test.ts`, `verify-signals.test.ts`: signals during a launched agent and
  during verify steps.
- `processes.test.ts`: spawning, group kills and timeouts through `Processes`.
- `human-rendering-regression.test.ts`, `human-styling.test.ts`: `stringWidth` in human layouts.
- `boundaries.test.ts`: the import rules above.
