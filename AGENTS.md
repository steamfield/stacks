# quickstacks

## Overview

A bun workspace; every package is in `packages/<name>/` or `packages/tools/<name>/`. `packages/cli` is `quickstacks`, the CLI: Effect 4 commands/services, doctor/version, lazy configuration, safe output and logs. Bun compiles the executable; Node 24 runs Vitest. There is no product code, vendor, release tooling or network requirement. `packages/api` (`@quickstacks/api`) and `packages/mcp` (`@quickstacks/mcp`) are placeholders with no code or scripts. `packages/tools/analyze` (`@quickstacks/analyze`) is a standalone static-analysis record producer: open-source analyzers over any directory, one SARIF 2.1.0 log per run, no runtime dependencies, no CLI wiring (phase 2.3 in `plans/`). Code two packages share goes in its own package, never imported across another package's `src/`. How the monorepo works and how to add a package: README.md, "Monorepo".

The root owns the harness: `.claude/`, lefthook, CI, the root `biome.json`, `tsconfig.base.json`, and the hook tests in `tests/hooks/`. Each package owns its source, tests, `tsconfig.json` (extending `../../tsconfig.base.json`) and any Biome plugins in a nested `biome.json` (`"root": false, "extends": "//"`). See docs/harness.md.

## Planning

Product planning lives in `plans/`; start with [plans/HANDOFF.md](plans/HANDOFF.md), then [product/PROBLEM_STATEMENT.md](product/PROBLEM_STATEMENT.md) and [plans/README.md](plans/README.md). Settled decisions live only in the plans README decisions log; proposals stay in `plans/requirements.md` until the maintainers agree them. Keep each plan file's `Status:` line current and update HANDOFF.md at the end of a session.

## Commands

Root commands run from the repo root and fan out to every workspace package (`bun run --filter '*' <script>`); preserve the runner split.

| Command (repo root) | Purpose |
| --- | --- |
| `bun install` | Install every package's dependencies and the lefthook hooks |
| `bun run install:ci` | Frozen dependency install |
| `bun run dev doctor` | The CLI's source doctor with local logs/data (unprefixed output, so `--json` stays parseable) |
| `bun run dev doctor --json` | Machine-readable source doctor |
| `bun run build` | Build every package (the CLI compiles `packages/cli/dist/quickstacks`) |
| `bun run typecheck` | Root harness tsc, then each package's |
| `bun run lint` | Biome over the whole repo, with each package's nested plugins |
| `bun run format` | Safe fixes and formatting |
| `bun run test` | Hook tests, then each package's tests |
| `bun run test:hooks` | Hook tests only (`tests/hooks/`, Vitest on Node) |
| `bun run coverage` | Each package's coverage |
| `bun run e2e` | Each package's end-to-end checks |
| `bun run check` | Lint, typecheck, test, e2e: the gate |
| `bun run clean` | Each package's generated output |
| `bun run prepare` | Install hooks outside CI |

In `packages/cli/` (run there):

| Command | Purpose |
| --- | --- |
| `bun run test:unit tests/cli.test.ts` | Single test file |
| `bun run test:watch` | Watch Vitest tests |
| `bun run e2e` | Compile, then bun test ./e2e |
| `./dist/quickstacks --version` | Bundled version |
| `./dist/quickstacks doctor --json` | Compiled local diagnostics |
| `bun run check` | This package's gate only |

In `packages/tools/analyze/` (run there):

| Command | Purpose |
|---|---|
| `bun run src/bin.ts <path>` | Analyze a directory and print one SARIF 2.1.0 log on stdout |
| `bun run src/bin.ts <path> --out <file>` | Write the log to a file (temp file, then rename) |
| `bun run src/bin.ts <path> --tool ruff` | Run one configured analyzer; others are recorded `skipped` |
| `bun run src/bin.ts --sarif <file> <path>` | Adopt a log produced elsewhere into the record |
| `bun run test:unit tests/tools.test.ts` | Single test file |
| `bun run check` | This package's gate only |

The adapter table is `packages/tools/analyze/tools.json`. An entry with `"verified": false` has not had its flags confirmed against an installed binary; confirm, then flip it.

## Architecture map (packages/cli)

Paths below are relative to `packages/cli/`.

- `src/bin.ts`: Bun/platform/Host/writer boundary, the per-invocation `Foreground` holder, signal policy wiring and exit status.
- `src/main.ts`: one invocation, framework Console capture, safe outcome and logging.
- `src/cli.ts`, `commands/doctor.ts`: real Effect command tree and thin handler.
- `src/core/doctor.ts`: platform-free diagnostic program.
- `src/services/`: Output buffers success output; Host supplies process facts; `processes.ts::Processes` runs child processes (`run`, `start`, `exec`, `interactive`, `which`) and `Foreground` holds this invocation's live process groups and interactive child.
- `src/platform/`: the only Node process code. `process.ts` spawns on `node:child_process` and signals/probes process groups; `signals.ts` is the A3 signal policy (`decide`, `installSignalPolicy`).
- `src/config.ts`: lazy per-invocation AppConfig; independent paths/log settings.
- `src/errors.ts`, `logging.ts`, `runtime.ts`, `version.ts`: stable boundaries.
- `src/schemas/`: config/report schemas and their types.
- `tests/`, `e2e/`: Node programs/hook tests and Bun standalone binary tests.
- `scripts/`, `biome-plugins/`: lifecycle/build and enforced boundaries.
- Repo root: `.claude/`, `.github/`, `docs/`, `tests/hooks/`: adapter, CI, harness guide and hook tests.

bin supplies platform, Output, Host and Foreground; AppLayer captures local services (config, logging, Processes) without opening config. main runs one scoped command. Doctor reads cached config and reports optional-file errors. Framework help is captured and flushed only on success; failures clear the output buffer.

## Architecture map (packages/tools/analyze)

Paths below are relative to `packages/tools/analyze/`. No Effect, no dependencies, runs under Node.

- `src/bin.ts`: the only module touching argv, `process.exitCode` and signals.
- `src/cli.ts`: hand-rolled argument parsing; unknown flag is a usage error.
- `src/main.ts`: orchestration — digest, inventory, attribution, tool runs, assemble, write.
- `src/output.ts`: the only module allowed to write stdout or stderr.
- `src/errors.ts`: the outcome type and the exit table (0 record, 2 input, 1 defect).
- `src/schemas/sarif.ts`: the SARIF 2.1.0 subset read and written, plus the tolerant validator that rejects any other version.
- `src/core/`: `digest.ts` (sorted tree hash, symlinks skipped), `inventory.ts` (tier 0 metrics), `tools.ts` (adapter table, PATH resolution, spawn without a shell, ledger), `attribution.ts` (optional `.quickstacks/manifest.json`), `run.ts` (envelope assembly).
- `tools.json`: the adapter table, data not code.
- `tests/`, `e2e/`: Vitest over the real entry point plus fake analyzer binaries; Bun for e2e.

## Conventions

Use namespaced Context.Service classes, static layer factories and fresh per-invocation state. No globals/caches across runs. Core uses Effect FileSystem/Path and remains unchanged under Node. Only bin/explicit adapters may use Bun; only `bin.ts` and `src/platform/` use Node process APIs (`process.kill`/`on`/`exit`, `node:child_process`, `@effect/platform-node`); everything else runs processes through `Processes`. Only config reads env: a child's whole environment comes from `AppConfig.childEnv` (nothing inherited), and `Processes.which` is the only PATH search, over the captured PATH. No direct console or stdout writes in application logic. Grit and adapter guards enforce platform/schema/env/output boundaries.

Strict TypeScript 7: unchecked indices, verbatim modules, erasable syntax, explicit Bun/Node types and no emit. Biome: two spaces, double quotes, width 100, recommended rules and explicit type imports/exports. Prefer current patterns and dependencies; keep changes scoped.

## Schemas

`src/schemas/` contains Settings and DoctorReport, each sharing its schema/type name. Decode unknown input at boundaries; encode reports for output. Config rejects excess properties. Use branded ids when adding domain ids, Schema.TaggedError for errors, and Schema.toJsonSchemaDocument with onExcessProperty:error for closed external JSON schemas. Keep framework validators; do not add @effect/schema or competing validators.

## Testing

`tests/helpers/cli.ts` invokes the real command tree with real NodeServices and injected Output/Host; no module mocks. Setup isolates HOME/XDG and clears credentials before app imports. Tests cover streams, parser failures, config laziness/caching, all error mappings, scope disposal, cancellation, EPIPE, logging and sink failures. Property tests use @effect/vitest; timers use TestClock. Hook tests execute actual helpers; all Grit rules are probed on real files.

Bun tests only `./e2e` after compiling. Binary tests spawn the artifact with an environment built from scratch, including hostile local dotenv/bunfig files to prove autoload is disabled. Never use unscoped bun test, --bun with Vitest, or weaken tests. A bug fix starts with a failing regression.

## Error handling

Fixed safe tagged messages; `errors.ts::errorTable` is the one exit/retryable/keepsResult table, and `errorClasses` lists every class (a test keeps the two equal). Adding a tag means its class, its row and its line in the roadmap's Error tags table. Expected usage/input/not-found exit 2, config 3, upstream 4, VerifyFailed/VerifyChanged 5 (read the verify report), permissions 6, interruption 130, defects 1; BrokenPipe is quiet 0. main observes failures/defects once and clears stdout on error, except for a keeps-result tag (VerifyFailed, VerifyChanged), whose buffered result is flushed to stdout before the envelope. BrokenPipe rule: a closed stdout or stderr while writing the result or envelope is quiet and exits 0, except after a keeps-result tag, which keeps its own exit. The outer runtime maps a pending interrupt after cleanup to 130. `SpawnFailed` (`kind`: cwd, shell, command, resources; `errno`) is internal and outside `AppError`, so it is a Defect unless the caller handles it; a missing command under `/bin/sh -c` is a normal exit 127. Logs never serialize arbitrary cause objects or secrets; a defect is logged as its class and stack frames, without its message. Defects are not retryable.

Signals (A3, `platform/signals.ts`): with no interactive child, SIGINT, SIGTERM and SIGHUP interrupt (finalizers run, exit 130). A second one within 1 s of the first is the same Ctrl+C delivered twice (terminal plus a forwarding wrapper) and is ignored; one 1 s or more later SIGKILLs every registered process group and exits 130 at once. SIGQUIT keeps its default action after the groups are SIGKILLed. While `Processes.interactive` runs a child, SIGINT and SIGQUIT are ignored (the terminal already gave them to the child) and SIGTERM and SIGHUP are forwarded to it. Process groups from `run`, `start` and `exec` get SIGTERM, 5 s, then SIGKILL on interruption, timeout or scope close; `run` and `exec` drain output for 2 s after exit before killing the group (`Finished.pipesHeld`). A SIGINT within 1 s of one left to the interactive child is still that child's Ctrl+C (a wrapper's late copy), and a SIGTERM or SIGHUP forwarded to the child stops the CLI with 130 once the child exits. Process groups leave the `Foreground` registry once seen gone and only registered groups are signaled. A closing scope sends SIGTERM to all of its groups at once, so they share one grace period. A `process.on("exit")` handler SIGKILLs any group still registered.

A tag may carry an optional closed `details` struct (`Schema.optionalKey` on its TaggedError fields), holding only CLI-produced values or caller arguments. Construction drops keys the schema doesn't name; `Output.error` encodes details per tag (`errors.ts::encodeDetails`) with `onExcessProperty: "error"`, so only a details object mutated after construction can reach the Defect path (exit 1). Details go only in the envelope, `{ error: { tag, message, retryable, details? } }`; human mode prints the message, then the lines `errors.ts::detailLines` picks, indented. Details never enter the message or a log record. An unknown subcommand is `Usage` with `details: { command, suggestions }` from `core/suggest.ts::closest`; effect/cli's own suggestions are discarded. A keeps-result failure whose result couldn't be written (non-EPIPE) keeps its exit, and the command log record gets `result: "unwritten"` with the write error's tag.

JSON commands produce one result; JSON failures produce one stderr error envelope as the last stderr line. To preserve that contract, JSON-mode ancillary logs use only the configured JSONL file. Human diagnostics/logs use stderr. `Output.progress` writes live lines to stderr in human mode only, swallows every write error and stops after the first. `Output.flushNow` (human mode only) writes buffered results immediately; once it has run, stdout is no longer empty on a later failure in that invocation. No colors are currently emitted, respecting NO_COLOR and pipes. `Host.stdinIsTTY`/`stdoutIsTTY` come from bin.ts; core never reads the streams.

## Debugging

Read packages/cli/logs/cli.log and packages/cli/logs/cli.jsonl. Development data stays under packages/cli/.dev/data. Use LOG_LEVEL=debug for detail. The session hook reports Bun mismatch and only newly added warning/error lines. Shared session-start can advise about absent .env; this base intentionally works without it.

After two unsuccessful fixes with no new diagnostic, stop and investigate other hypotheses. Read errors before guessing; do not swallow defects or report success after failure.

## Git hooks

Install lefthook on PATH (e.g. brew install lefthook), then bun install. Pre-commit formats/checks staged code/config and restages safe fixes. Commit-msg requires Conventional Commits, allowing merge/revert/fixup/squash forms. Pre-push runs lint, typecheck and tests in parallel. Never bypass hooks with --no-verify.

## CI

.github/workflows/ci.yml runs a sequential `check` job on ubuntu-latest and macos-latest for main pushes, PRs and manual runs, then `ci-ok`, which passes only when both did; contents:read only. Bun comes from packageManager, Node from .node-version. Frozen install, lint, typecheck, coverage, binary e2e; upload each package's logs/coverage on failure. Required check: ci-ok. Upgrade official action tags after checking upstream; SHA pins are deferred.

## Build workarounds

No patches, pinned prereleases or disabled rules. Every shared dependency version lives once, in the root `workspaces.catalog`; packages depend on `catalog:`. Effect packages resolve together at stable 4.0.6 with compatible 4.x ranges, Vitest/coverage 5.x. The generated type config targets current TypeScript 7. Bun compile disables all runtime config autoload and removes its linked sourcemap output intentionally.

The shipped dev wrapper was adapted to forward directly delivered SIGINT/SIGTERM/SIGHUP, with a reproducing subprocess test. Reassess/remove local adaptation when upstream provides equivalent signal forwarding. Biome stdin suppresses useful plugin diagnostics, so boundary tests use actual temporary files; no Grit rule was removed.

## Deferred

Application features, install/update distribution and release workflow (decision A1, open in `plans/`), and SHA-pinned CI actions.

## Pending user actions

None.

## Deeper context

README.md for usage/configuration; docs/harness.md for adapter ownership; .claude/README.md for installed hooks/commands; .claude/rules/architecture.md for product and contract constraints on any design; .claude/skills/effect/SKILL.md for current APIs.
