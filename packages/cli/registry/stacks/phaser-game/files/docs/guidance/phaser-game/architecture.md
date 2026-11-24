# Architecture

The game is split so the parts most likely to be wrong run in Vitest in milliseconds, and so the same input always reaches the same state in every browser.

## Logic and engine

`src/logic/` holds the rules and state as plain TypeScript: the level format, tile collision, coins, the goal, events and the save schema. `src/engine/` renders that state and feeds input into it.

- Logic imports only `zod`, `src/kit/core/` and other logic files. Biome rejects Phaser, the engine, the shell, input and storage imports there, and `tsconfig.logic.json` compiles `src/logic/` and `src/kit/core/` with no DOM types, so `window`, `document`, `localStorage` and `performance` are type errors.
- Time is the `dt` passed to the step function (always `TICK_DT`, 1/60 s) and tick counts. Delays, cooldowns, coyote time and hit-stop are tick counters in state. `Math.random`, `Date.now`, `performance.now` and `new Date()` are lint errors in logic (`biome-plugins/no-nondeterminism.grit`).
- Randomness comes from `createRng(seed)` in `src/kit/core/rng.ts`. Store `rng.state()` in the save if a resumed game must continue the same sequence.
- Input arrives as plain data (`stepWorld(world, { move, jumpPressed, jumpHeld }, dt)`). Results from anything engine-side arrive as plain data too.
- Everything observable is a typed event in `src/logic/events.ts`, emitted once, on the tick it happens. Tests, `bun run see` and engine effects all read events.
- `summarize()` stays small and stable, since scenarios assert on it, and `toAscii()` stays current for tile games.

## The runtime

`src/engine/runtime.ts` is the only place logic advances. `Runtime` owns the event log, the `FixedStep`, the current scene, the title menu, the world and the save write queue, and imports nothing from Phaser:

- Outside test mode, Phaser's `STEP` event feeds wall time to `rt.frame(delta)`, which runs as many fixed ticks as have elapsed. In test mode the shell calls the handle's `advance(ticks)` instead, and Phaser's loop only renders.
- `rt.goTo(scene)` sets `loading` until the new scene's `create()` calls `rt.entered(scene)`. `idle()` is false while a scene loads or a save is being written, so `advance()` stops at a scene change and the harness waits. Load timing never changes which tick something happens on.
- Phaser scenes in `src/engine/game.ts` read runtime state in `update()` and sync game objects to it. They never decide gameplay.

## Saves

`src/kit/save.ts` stores versioned saves per game in IndexedDB (database `<game id>-saves`) and assumes a migration will sometimes be wrong:

- `load(slot)` returns `ok`, `empty`, `unreadable` or `newer-than-code`. After an unreadable or newer-than-code load, the raw blob is copied to a quarantine key and `save()` refuses to overwrite that slot, so rolling back a deploy leaves newer saves intact.
- When a load migrates an older save, the original blob is kept under a backup key.
- `save()` validates against the schema and refuses invalid data; `importJson` and `exportJson` move a save in and out as a file.
- A second tab opens the store read-only (Web Locks).
- `requestPersistence()` runs from the player's first tap or key press (`onFirstGesture` in `src/main.ts`), because Firefox prompts for it.
- The shell saves when the tab is hidden, the last reliable moment to write on mobile.
- `status` is `persistent`, `best-effort`, `memory-only` or `read-only`; the game shows a notice when progress can't be kept.

A change to the save shape bumps `SAVE_VERSION` in `src/logic/save.ts`, adds `migrations[old]`, and commits `tests/fixtures/save-v<old>.json` captured from the old code. `tests/save.test.ts` loads every fixture.

## Input

`src/kit/input.ts` maps keys and touch to named actions and vectors: `isDown("jump")`, `justPressed("jump")`, `vector("move")`. `src/engine/input.ts` declares the game's actions, their keys and the touch layout. Call `input.update()` once at the start of each tick. On touch devices the kit renders a d-pad and buttons inset from the screen edges and safe areas. Tests inject input at the action level, so every gameplay input goes through actions, never Phaser's keyboard or pointer handlers.

## The shell

`src/kit/shell.ts` owns the container element inside `#game-root`. Phaser sizes its canvas inside it. The shell handles safe-area padding, the rotate prompt for the wrong orientation, gesture suppression, starting the game as soon as the page loads (a start gate only in test mode), resuming audio after the first gesture and after iOS interrupts it, pause and save on hide, the storage notice, error capture and the `window.__game` test hook. It is the only module that writes to `console`; everything else logs through `createLogger(namespace)`, filterable with `?log=<namespace>` or `?log=debug`.

Errors that aren't exceptions (a lost WebGL context, a failed asset load) go through `ctx.reportError(source, error)`, which records them on `window.__game.errors` and shows a red banner, so tests fail on them.

## Launch parameters

`?scene=play` skips the title, `?seed=<n>` sets the seed, `?debug=1` shows the debug overlay, `?stage=<name>` (only with `?debug=1` or in test mode) starts from a capture stage, `?touch=1` forces the touch controls, and `?test=1` turns on test mode by hand.
