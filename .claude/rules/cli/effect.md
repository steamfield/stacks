---
paths:
  - "packages/cli/src/**"
  - "packages/cli/tests/**"
  - "packages/cli/scripts/**"
---

# Effect

Load the `ce:effect` skill before writing Effect code or looking up its APIs (Claude Code and Codex both install it from the `claude-essentials` marketplace). It covers Effect 4 in general: the Effect 3 names that no longer exist, where the installed package documents each API, and references by topic. For this CLI the usual ones are `errors.md`, `services-layers.md`, `resources-concurrency.md`, `cli.md`, `config-observability.md` and `testing.md`. Resolve `effect` from `packages/cli`; its installed declarations and `node_modules/effect/AGENTS.md` win over the skill, web docs and memory. This rule is the CLI's own policy on top of it.

## Services and state

A service is `Context.Service<Self, Shape>()("stacks/Name")` with static layer factories named `layer`, `memory` or `fixed`. The layer's constructor yields every dependency once and returns the shape; methods close over those values, so a method's requirements are `never` (or `Scope` when it hands back a scoped resource, like `Processes.start`). Don't `yield*` a service inside a method, a loop or a pure helper: pure code (rendering, composition text, decisions) takes values.

State is per invocation. `bin.ts` builds the layers once per process and `tests/helpers/cli.ts` once per `runCli`, so state lives inside the layer's constructor: a closure variable, a `Ref`, or `Effect.cached` for lazy work done once (`AppConfig.get`, `Registry`'s `load`). No module-level `let`, `Map` or array, and no cache added to a service object to skip work its layer already caches; if a service repeats work, put `Effect.cached` in the layer. Providing a constant layer (`Logging.layer`) again inside a program that already has it hands back the outer instance and its state; when each call needs its own instance, provide a factory's new layer (`Registry.layer(roots)`) or `Layer.fresh`.

## Effectful functions and the runtime

Use `Effect.fn("module.name")` for new functions and ones you are already rewriting; most existing code is `(args) => Effect.gen(...)`, so don't convert untouched functions in bulk. A growing `Effect.gen` body gets named steps (AGENTS.md, "Code structure").

`runtime.ts::runInvocation` is the only runner for the CLI, and each script's own entry point for scripts. No `Effect.runPromise`, `runSync` or `runFork` inside Effect code or a callback; capture the services a later callback needs while still in Effect. `main` uses `Effect.uninterruptibleMask` so output settles after an interrupted command, and `runInvocation` maps a pending interrupt to 130. `NodeServices` from `@effect/platform-node` is used only in `bin.ts`, `src/platform/` and tests.

## Errors

Expected failures are the `Schema.TaggedError` classes in `errors.ts`, failed with `return yield* new Tag({ ... })` and chosen by what the caller should do next. A throw or a sync decode inside `Effect.gen` is a defect, exit 1: wrap throwing code in `Effect.try`, and decode input with `decodeUnknownEffect`. `decodeUnknownSync` and `encodeSync` are only for module-level constants and for encoding a report the CLI built, where failure is a bug. `Effect.die` and `orDie` are for broken invariants and values the CLI built itself, never for user input.

`catchCause` and `ignoreCause` swallow defects and interruption too, so they're only for a boundary that owns the policy for all three: `main.ts`, `logging.ts`, `services/output.ts`, `telemetry/` and `core/search/remote.ts`. Ordinary application work doesn't swallow a defect to look successful. To translate a typed failure, use `mapError`: it maps only the Fail reasons and keeps defects and interruption, which a hand-built `Effect.exit` branch drops. Don't use `Effect.ignore({ log })` or anything else that hands a cause to the logger (see "Logging").

Recover only when the substitute is true. `option`, `orElseSucceed` and `ignore` turn every typed failure into the default, so check which filesystem reasons really mean absent: walking up to discover a project treats `NotFound` and `BadResource` (ENOTDIR, a file where a directory was expected) as absent (`core/manifest.ts::locateManifest`); reading a known file whose absence has a default treats only `NotFound` as absent (`core/runs.ts::projectRuns`). `PermissionDenied` and `Unknown` mean the CLI couldn't look, which fails as `PermissionDenied` rather than reporting nothing there. A lookup that fails closed anyway (`verify/step.ts::runStep`'s `cwd` check) may stay an `option`.

## Resources and fibers

A write that must be undone on failure is acquired with `Effect.acquireRelease`, and the release reads `exit` to roll back only on failure or interruption (`project-state.ts::replaceProjectState`, `scaffold/write.ts::openProject`). Each stage that needs undoing gets its own acquisition, since a release is registered only after its acquire succeeds. A rollback keeps going after one restore fails, keeps the original failure, and records each path it couldn't restore with `Invocation.rollbackIncomplete`, which `main` reports in the envelope's `error.rollback`.

Don't use `forkDetach`. Every forked fiber is joined, scoped or ends in a handler that reports its failure; a scope ending stops a fiber but doesn't surface its failure.

Time and randomness in Effect code come from `Clock`, `Effect.sleep`, `Effect.timeoutOption` and `Random`, never `Date.now`, timers or `Math.random`, so TestClock drives them. `src/platform/` is the exception: its synchronous Node callbacks read the wall clock.

## Commands and parsed input

Read the CLI's inputs from what `effect/cli` parsed: flag values from the handler's config, failures from `CliError` fields (`InvalidValue.option`, `.kind`, `.value`, `.expected`; `UnknownSubcommand.subcommand`, `.parent`; `ShowHelp.commandPath`, `.errors`). Never re-parse argv. The two existing argv reads are the exceptions, and nothing else joins them: `bin.ts` reads `--json` before parsing because Output's audience has to exist when the parser fails, and `main.ts::hasFlag`/`rootHelp` check `--help` and `--version` because those built-in flags print and succeed without returning a command path.

`Command.runWith` runs with `{ version, renderErrors: false }`. Framework help goes through `Console.log`, which `main` captures and discards on failure; Output owns every application write.

## Config and logging

`config.ts` is the only env reader: it builds a fresh `ConfigProvider.fromEnvRecord` from blank-normalized env. Paths, logging and output config stay independently readable, because `doctor` and `--version` have to work when `config.json` is broken: layer building never reads fallible config files, schema decoding stays lazy inside commands, and an invalid log level falls back.

Logger records are built only by `logging.ts::entry`: `time`, `level`, `msg`, `detail`, annotations flattened to scalar top-level keys (secret-looking keys redacted, reserved names prefixed), and a `cause` holding only an `AppError`'s allowlisted fields. Don't construct a record anywhere else or pass an arbitrary object through as a field. A new field is a contract change for anything that reads the JSONL file, including the run records. The logger callback queues plain sanitized entries; flushing uses the captured FileSystem and Output, never a new runtime. A log sink failing (unwritable file, closed stderr) can't fail the command or change its exit.

## Tests

Build a fresh layer per test for stateful services; `@effect/vitest`'s `layer(...)` shares one build across a `describe`, so don't use it for them. Assert failures through `Exit`/`Cause` or through `runCli`'s exit code and streams. `.claude/rules/cli/testing.md` owns the rest.
