# Effect

Effect 3, the Effect 4 prereleases and the current release are mixed together in model memory and on the web. Look up a name in this order, resolving `effect` from the workspace package you're changing:

1. `docs/guidance/effect/api.md`, the project's API reference, when it exists and its first line names the installed version.
2. The installed declarations (`node_modules/effect/dist/**/*.d.ts`) for names and signatures, and `src/` for behavior; each export's doc comment has When to use, Details and Gotchas sections.
3. `node_modules/effect/AGENTS.md` and the runnable example it links under `ai-docs/src/`.
4. That release's docs and changelog. Other majors and memory last.

Resolve imports through the package's `exports`, not older directory layouts. When the reference disagrees with the declarations, the declarations win: fix the reference.

## The API reference

The agent writes `docs/guidance/effect/api.md` once the project typechecks, recording only names it checked against the installed declarations. The first line is exactly `Verified against effect <version>`; verify fails when that version isn't the installed one. Cover, under the installed release's names:

- Services and layers: the service class form, static layers, `Layer.fresh` and memoization, scoped resources and finalizers.
- Errors: tagged errors, the catch helpers, `Result`, `Exit` and `Cause`, defects and interruption.
- Concurrency: forking under an owner, `Effect.callback`, promise cancellation, timeouts, schedules, `Clock`.
- Configuration and logging: `Config` constructors, `ConfigProvider` sources, `Redacted`, log levels, custom loggers and annotations.
- Schema: boundary decoding, optional keys, checks and transformations, closed JSON Schema documents, the Standard Schema adapter.
- Testing: `@effect/vitest`'s `it.effect`, `it.live`, `it.layer` and `it.prop`, `TestClock`'s import path, asserting failures and defects.
- The traps from older majors you hit while building (an old name, a moved module), each with its current form.

Add the HTTP, CLI, SQL, observability or AI modules the project uses, as the stack's guidance asks. Link examples to project files rather than pasting long code, and don't freeze signatures the declarations already show.

On every Effect upgrade, recheck each entry against the new declarations, then update the first line. Never bump the line alone.

## Testing

The stack's testing guide owns the test layers; `tests/effect-testkit.test.ts` shows each pattern below.

- `it.effect` runs on `TestClock`: fork the program that sleeps, adjust the clock, then join. Never sleep to wait for an outcome; for real I/O in between, wait on an observed condition.
- A layer value is memoized within one build: providing it twice builds it once and shares its state. Wrap it in `Layer.fresh` when two consumers need separate instances, and build the app layer per test when state must not leak.
- A program run repeatedly in one test file gets a fresh `ConfigProvider` per run (`ConfigProvider.fromUnknown` or `fromEnvRecord`), never a snapshot of the process environment.
- Separately started runtimes (a route runtime, a `ManagedRuntime`, the HTTP server) use the live clock, so test time-dependent programs directly with their layers provided.
- Assert typed failures as values (`Effect.flip`) and defects through the `Exit`'s `Cause`; never swallow a cause.

## Habits

Keep runtime execution at program boundaries. Observe every fork at its owner. Catch typed failures deliberately; defects remain defects. Treat empty config strings as absent. Never install `@effect/schema`: Schema is part of `effect`.
