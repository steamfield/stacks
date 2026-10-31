---
name: effect
description: Load before changing CLI programs, services, configuration, schemas, logging or tests.
---

# Effect 4 in this CLI

Checked against effect, @effect/platform-node and @effect/vitest 4.0.6. Recheck with each dependency bump.

The authoritative sources are the installed package, in this order: its declarations, its own agent guide (`node_modules/effect/AGENTS.md`) and its worked examples (`node_modules/effect/ai-docs/src/`), resolved from `packages/cli`. Web pages, blog posts and model memory mix Effect 3 with 4.0 prereleases. Before using a name you didn't see in this repo's code, confirm it exists: `node --input-type=module -e 'import * as E from "effect"; console.log("catchAll" in E.Effect)'` from `packages/cli`.

## Names that don't exist in 4.0.6

| Don't write (Effect 3 or a 4.0 prerelease) | Write |
| --- | --- |
| `Context.Tag`, `Context.GenericTag`, `Effect.Service`, `Effect.Tag`, `ServiceMap` | `class X extends Context.Service<X, Shape>()("stacks/X")` |
| `Layer.scoped` | `Layer.effect` (it removes `Scope` from the layer's requirements itself) |
| `Effect.catchAll`, `catchAllCause`, `catchAllDefect` | `Effect.catch`, `catchCause`, `catchDefect` |
| `Effect.either`, `Either` | `Effect.result`, `Result` (`.success` / `.failure`, `Result.isFailure`) |
| `Effect.async` | `Effect.callback((resume, signal) => ...)`, returning a cleanup Effect |
| `Effect.fork`, `forkDaemon` | `forkChild`, `forkScoped`, `forkDetach` (below) |
| `Effect.zipRight`, `tapErrorCause` | `Effect.andThen`, `tapCause` |
| `Schema.TaggedErrorClass`, `Schema.ErrorClass` | `Schema.TaggedError<X>()("X", fields)` |
| `@effect/schema`, `Schema.decodeUnknown`, `Schema.parseJson` | `Schema` from `effect`, `decodeUnknownEffect`, `Schema.fromJsonString` |
| `Schema.Union(a, b)`, `Schema.Literal("a", "b")` | `Schema.Union([a, b])`, `Schema.Literals(["a", "b"])` |
| `Config.string` | `Config.String` (constructors are capitalized) |

`Schema.optionalKey` is an exact optional key (absent, never `undefined`); `Schema.optional` also admits `undefined`. Fields in this repo's schemas use `optionalKey`.

## Entry points

`Effect`, `Context`, `Layer`, `Schema`, `Config`, `FileSystem`, `Path`, `Clock`, `Random`, `Result`, `Exit`, `Cause` from `effect`; `Command`, `Flag`, `CliError` from `effect/cli`; `FetchHttpClient` from `effect/http`; `TestClock` from `effect/testing`; `NodeServices` from @effect/platform-node (only `bin.ts`, `src/platform/` and tests); `it`, `assert`, `layer` from @effect/vitest. The CLI, HTTP and socket modules are marked unstable; check their declarations rather than assuming a shape.

## Services and layers

A service is `Context.Service<Self, Shape>()("stacks/Name")` with static layer factories (`layer`, `memory`, `fixed`). The layer's `Effect.gen` yields every dependency once and returns the shape; methods close over those values, so a method's requirements are `never` (or `Scope` when it hands back a scoped resource, like `Processes.start`). Don't `yield*` a service inside a method, a loop or a pure helper: pure code (rendering, composition text, decisions) takes values.

State is per invocation. `bin.ts` builds the layers once per process and `tests/helpers/cli.ts` builds them once per `runCli`, so any state belongs inside the layer's constructor: a closure variable, a `Ref`, or `Effect.cached` for lazy work done once (`AppConfig.get`, `Registry`'s `load`). Never a module-level `let`, `Map` or array, and never a cache added to a service object to skip work its layer already caches. A `Registry.get` that kept a mutable snapshot on the instance was reverted for this: `load` is already cached per build, and a second cache only adds staleness and ordering bugs. If repeated work is the problem, put `Effect.cached` in the layer.

A layer value is built once per memo map, and a nested `Effect.provide` forks the enclosing memo map. Providing a constant layer (`Logging.layer`) again inside a program that already has it hands back the outer instance and its state. When each call needs its own instance, provide a factory's new layer (`Registry.layer(roots)`) or wrap it in `Layer.fresh`.

## Effectful functions

For a reusable function returning an Effect, `Effect.fn("module.name")(function* (args) { ... })` names it for traces; `Effect.fnUntraced` is the same without the span, for small internal helpers. Extra behaviour goes in as further arguments to `Effect.fn` (`Effect.fn("x")(body, Effect.mapError(...))`), and `Effect.fn.Return<A, E, R>` annotates the return type. Most existing code is `(args) => Effect.gen(...)`: use `Effect.fn` for new functions and ones you are already rewriting, and don't convert untouched functions in bulk.

A growing `Effect.gen` body gets named steps, each a function returning an Effect, so the body reads as the command's sequence. Effects run only at the outer boundary: `runtime.ts::runInvocation` for the CLI and each script's own entry point. No `Effect.runPromise`, `runSync` or `runFork` inside Effect code or inside a callback; capture the services a later callback needs while still in Effect.

## Errors

Expected failures are the `Schema.TaggedError` classes in `errors.ts`, failed with `return yield* new Tag({ ... })`. Map a platform or parse error to a tag where its meaning is known (`Effect.mapError`, `catchTag`, `catchTags`), choosing the tag by what the caller should do next.

`Effect.catch`, `catchTag`, `orElseSucceed` and `ignore` see only typed failures; defects pass through, as intended. `catchCause` and `ignoreCause` also swallow defects and interruption: use them only for best-effort writes whose failure can't change the outcome (a log sink, a fallback envelope), as `main.ts` and `logging.ts` do. `Effect.die` and `orDie` are for broken invariants and values the CLI built itself, never for user input.

A throw inside `Effect.gen` is a defect (exit 1). Wrap throwing code in `Effect.try({ try, catch })`, or `Result.try` in pure code, and decode input inside Effect code with `Schema.decodeUnknownEffect`. `decodeUnknownSync` and `encodeSync` are for module-level constants and for encoding a report the CLI built, where failure is a bug.

`Effect.result` gives a `Result` (`.success`, `.failure`); `Effect.exit` gives an `Exit` (`.value`, `.cause`). Inspect a cause through `cause.reasons` with `Cause.isFailReason`, `isDieReason`, `isInterruptReason`, and `Cause.hasInterruptsOnly`. A pending interrupt can survive masked cleanup; `runInvocation` maps it to 130.

## Resources and concurrency

A resource is acquired inside a `Scope`: `Effect.acquireRelease(acquire, (value, exit) => release)` or `Effect.addFinalizer((exit) => ...)`, closed by `Effect.scoped` or the layer. Acquisition is uninterruptible, so do the write that needs undoing inside `acquire`, and let the release read `exit` to undo only on failure or interruption (`replaceProjectState`, `openProject`).

`forkChild` is interrupted with its parent fiber, `forkScoped` with the `Scope` in context, and `forkDetach` has no owner, so don't use it here. Observe every fork: join it, or let its scope end it. `Effect.callback`'s returned Effect runs on interruption, so cancel the underlying source there. `Effect.uninterruptibleMask(restore)` is how `main` guarantees output settles after an interrupted command.

Time and randomness in Effect code come from `Clock.currentTimeMillis`, `Effect.sleep`, `Effect.timeoutOption` and `Random`, never `Date.now`, timers or `Math.random`, so TestClock drives them. `src/platform/` is the exception: its synchronous Node callbacks read the wall clock.

## Commands

`Command.make` builds commands and `withSubcommands` composes the tree; `withSharedFlags` puts a flag before or after subcommands. `Flag.Boolean` needs `withDefault(false)` (flag constructors are capitalized too). `Command.runWith` takes raw arguments and `{ version, renderErrors: false }`. Framework help goes through `Console.log`, which `main` captures and discards on failure; Output owns every application write.

Read flag values from the handler's parsed config, and parser failures from `CliError` fields (`InvalidValue.option`, `.kind`, `.value`, `.expected`; `UnknownSubcommand.subcommand`, `.parent`; `ShowHelp.commandPath`, `.errors`). Never re-parse argv to recover them. The two existing argv reads are the exceptions, and nothing else joins them: `bin.ts` reads `--json` before parsing because Output's audience has to exist when the parser fails, and `main.ts::hasFlag`/`rootHelp` check `--help` and `--version` because those built-in action flags print and succeed without returning a command path.

## Config, logs and clock

Build a fresh `ConfigProvider.fromEnvRecord` from blank-normalized env; `config.ts` is the only env reader. Layer building never reads fallible config files; schema decoding stays lazy inside commands, and paths and log settings are read independently (an invalid level falls back).

`Logger.make` receives date, logLevel, message, cause and fiber. Read annotations with `fiber.getRef(References.CurrentLogAnnotations)` and filter with `References.MinimumLogLevel`. Levels are title case inside Effect and lowercased in JSON. The logger callback queues plain sanitized entries; flushing uses the captured FileSystem and Output, never a new runtime.

## Schemas

`Schema.Struct` for DTOs, `Schema.Class` for identities with behaviour; schema and type share a name. Brand domain ids with `Schema.brand`. Refinements are `.check(Schema.makeFilter(...))` or a built-in check (`Schema.isPattern`); metadata is `.annotate` on the node it describes. Decode unknown input at the boundary with `decodeUnknownEffect`; encode at output.

`Schema.toJsonSchemaDocument` returns a document with `.schema`; `onExcessProperty: "error"` closes objects, and decoding needs it too when extras must fail. Identifiers produce refs, so avoid them on tool-facing schemas unless the consumer handles refs.

## Testing

@effect/vitest's `it.effect` supplies a scope and TestClock; `TestClock.adjust` advances it. Fork the sleeping fiber, adjust, then join. `it.live` uses the real clock. When real I/O intervenes, wait on an observed condition, not a guessed sleep. `it.prop` and `it.effect.prop` take schemas or arbitraries. `layer(...)` shares one built layer across a `describe`, which contradicts this repo's fresh-layer rule for stateful services; build a fresh layer per test instead. A separately run runtime uses live services, whatever the surrounding test clock. Assert failures and defects through `Exit`/`Cause` or through `runCli`'s exit and streams.
