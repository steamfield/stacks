# src

This is the source of `stacks`, the CLI a coding agent (or a person) runs to pick a project
recipe, scaffold it, add capabilities to it later, and check it with `stacks verify` until it's
green. Everything here runs under Node, bundled by Bun into `dist/cli.mjs`.

A stack is a recipe for a whole new project and a fragment is a reusable addition composed onto
one (CI, git hooks, a database). Both are entries in a registry: the bundled one that ships with
the CLI, the user's own, a project's own, and an optional signed remote index. The CLI reads and
composes entries and writes files, but it never runs anything an entry contains; only `verify`
runs commands, and only the steps in the project's own manifest
(`.claude/rules/architecture.md`, "Trust model").

## How it fits

One invocation passes through four layers, each a folder or a file here:

1. `bin.ts` is the process boundary. It reads the facts about this process (arguments, env,
   terminal flags, the bundled registry's location), builds the services once, installs the
   signal policy, and turns the outcome into the exit status.
2. `main.ts` runs one command: it parses the arguments with `cli.ts`'s command tree, runs the
   handler, and then settles the output, the log record and the exit code, including after a
   failure or Ctrl+C. `runtime.ts::runInvocation` is the only place an Effect program is run.
3. `commands/` holds one thin handler per subcommand. A handler reads its flags, calls a program
   in `core/`, and renders the result for the invocation's audience.
4. `core/` holds the programs themselves: composing entries, writing projects, verifying them,
   validating a registry. It reaches the outside world only through `services/`.

The boundary rules (AGENTS.md, "Conventions") keep that direction. Only `bin.ts` and `platform/`
use Node's process APIs; `core/` and `services/` never import `platform/` or `commands/` (the one
exception is `services/processes.ts`); only `config.ts` reads the environment; and nothing writes
to stdout or stderr except through `services/output.ts::Output`.

## The main flow

For `stacks new typescript-cli my-app`:

1. `bin.ts` builds the layers and calls `main.ts::main` with the arguments.
2. `main` parses them against `cli.ts::cli` and runs `commands/new.ts`.
3. The handler calls `core/scaffold/new.ts::scaffold`, which composes the stack
   (`core/compose/`), renders the brief (`core/brief/`) and writes the project in one transaction
   (`core/scaffold/write.ts::openProject`).
4. The handler hands the result to `Output`, which renders it as JSON, agent text or human text.
5. `main` writes the buffered output, records the `command` log line, and returns the exit code;
   on a failure it prints the error from `errors.ts` instead.

## Files and folders

| Path | What it owns |
| --- | --- |
| `bin.ts` | The process boundary: platform layers, `Host`, signal wiring, the exit status |
| `main.ts` | One invocation: parsing, running, output and logging settled after the command |
| `cli.ts` | The command tree: every subcommand and the shared flags |
| `runtime.ts` | `runInvocation`, the one Effect runner, mapping an interrupt to exit 130 |
| `config.ts` | `AppConfig`: the only environment reader, settings, paths and agent detection |
| `errors.ts` | Every tagged error, its exit code, its failure text and the JSON error envelope |
| `logging.ts` | The JSONL log records and where they go |
| `invocation.ts` | `invocationFor`, the command name printed in hints (`stacks` or the npx form) |
| `project-layout.ts` | The paths under a project's `.stacks/` directory |
| `version.ts` | The CLI version |
| `commands/` | One handler per subcommand |
| `core/` | The programs behind the commands |
| `services/` | Output, process facts, child processes and TCP, as Effect services |
| `platform/` | The Node code those services sit on: spawning, signals, HTTP, text width |
| `schemas/` | The shapes of every `--json` result |
| `telemetry/` | Consent, the event spool and the client for usage events |

## Terms

- Audience: who an invocation's output is for, decided once: `json` with `--json`, `human` at a
  person's terminal, `agent` everywhere else (`.claude/rules/cli/cli.md`, "Three audiences").
- Tagged error: an expected failure, a class in `errors.ts` whose tag fixes the message and the
  exit code an agent branches on.
- Service: an Effect `Context.Service` built fresh for each invocation; state never outlives one.

## Where to start

Read `main.ts::main` to see one invocation end to end, then `cli.ts` for the list of commands, then
the README of whichever folder owns the command you care about. Each folder under `src/` has one.
Tests: `packages/cli/tests/helpers/cli.ts::runCli` runs the real command tree for most tests, and
`packages/cli/tests/cli.test.ts` covers the invocation boundary; `packages/cli/e2e/` runs the
packed Node package.
