# Architecture

The game is split so its rules run without a browser, tick by tick, and the same input always gives the same state. Tests, `bun run see` and the Playwright suite all depend on that.

## Layers

| Folder | Holds | May import |
| --- | --- | --- |
| `src/logic/` | The rules: world state, `stepWorld`, events, the save schema, `summarize()` | `src/kit/core/`, `zod`, other `logic/` files |
| `src/kit/core/` | Engine-free helpers: `FixedStep` and `TICK_DT`, `createRng`, `EventLog`, `hashState`, `createLogger`, save types | Nothing outside itself |
| `src/kit/` | The browser kit: `shell.ts` (boot, `window.__game`, test mode, errors, the log sink), `input.ts` (keyboard and touch actions), `save.ts` (IndexedDB saves) | `core/`, `idb-keyval` |
| `src/engine/` | three.js rendering, Rapier physics, the camera, input wiring, `runtime.ts` | Anything |
| `src/game.ts` | The game's identity: `id`, `title`, `orientation` | Types only |

Biome enforces the `src/logic/` row (no three.js, Rapier, `idb-keyval`, kit modules other than `core/`, or engine files; no `Math.random`, `Date.now` or `new Date()`), and `tsconfig.logic.json` compiles `src/logic/` and `src/kit/core/` with no DOM or Node types, so `window`, `document`, `performance` and `console` are type errors there. `tests/boundaries.test.ts` proves each lint rule fires.

## One tick

`src/engine/game.ts` (`startThree`) runs one `FixedStep` at 1/60 s. Each tick reads input actions, calls `stepWorld` from `src/logic/` with plain data, then steps Rapier once with `TICK_DT`. Rendering reads state and never writes it.

- Outside test mode the engine's `requestAnimationFrame` loop feeds real time to `FixedStep` and renders.
- In test mode (`window.__GAME_TEST__` or `?test=1`) that loop doesn't run. The harness calls `__game.advance(n)`, which runs up to `n` ticks and renders once. `advance` stops early when `idle()` turns false (physics loading, a save in flight), and the driver waits for `idle()` before continuing, so load timing never changes the outcome.
- `src/engine/runtime.ts` (`Runtime`) owns the world, the fixed step, serialized save writes and `worldHash()`. It has no three.js or Rapier, so `runtime.test.ts` covers it under Vitest.

## Determinism

- Time in logic is the `dt` passed in (always `TICK_DT`) and tick counters in state. Cooldowns, buffers and delays are counted in ticks.
- Randomness comes from `createRng(seed)`. Store `rng.state()` in the save when a resumed game must continue the same sequence. Cosmetic randomness in `engine/` uses its own seeded rng so captures repeat.
- `worldHash()` hashes logic state only (player, orbs, clock), never Rapier's bodies. The smoke test pins one hash for a fixed input and every Playwright project must reach it.
- Everything observable is a typed event in `src/logic/events.ts`, emitted through the `EventSink` on the tick it happens. Tests, `see` and the engine's effects read the same events.

A scenario that passes sometimes and fails sometimes is a determinism bug: something reads a clock, uses `Math.random`, or ticks logic from the render loop. Find it rather than retrying.

## Saves

`src/kit/save.ts` stores versioned envelopes (`{ version, savedAt, data }`) in an IndexedDB database named `<game id>-saves`, so never change `id` in `src/game.ts` after release. A save that fails its schema, or comes from newer code, is never overwritten: `load()` reports why and `exportJson()` still returns the raw data. A second tab opens read-only.

To change the save shape: bump `SAVE_VERSION` in `src/logic/save.ts`, add `migrations[old]` that upgrades `old` to `old + 1`, and commit `tests/fixtures/save-v<old>.json` captured from the old code. `tests/save.test.ts` loads every fixture with the current code.

## The shell

`bootGame` in `src/kit/shell.ts` sizes `#game-root` with safe-area padding, starts the game at once (audio unlocks on the first gesture), pauses and saves when the page is hidden, shows a rotate prompt when the phone is held the wrong way for `orientation`, records errors in `__game.errors`, and is the one place that writes to the console. Game code logs through `createLogger("area")`. Errors that aren't exceptions (a loader failure, a lost WebGL context) go to `ctx.reportError` so tests fail on them.

In test mode the shell shows a start button (`[data-game-start]`) so the harness decides when the game starts.

## Capture stages

`?stage=<name>` puts the game in a hard-to-reach state for scenarios and captures, such as `nearly-cleared`. Stages are defined in `src/engine/capture-stages.ts`, work only with `?debug=1` or in test mode, and a staged game is never saved.
