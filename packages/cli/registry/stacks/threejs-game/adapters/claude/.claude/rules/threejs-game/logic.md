---
paths:
  - "src/logic/**"
  - "src/kit/core/**"
---

# Game logic (`src/logic/`)

This code is the game's rules. It runs in Vitest without a browser and in the shell's test mode, tick by tick. Read [architecture](../../../docs/guidance/threejs-game/architecture.md) before non-trivial changes.

- Pure TypeScript. Import only `src/kit/core/`, `zod` and other `logic/` files. No three.js, Rapier, DOM, or the kit's `save`, `input` or `shell` (Biome and `tsconfig.logic.json` enforce this).
- Time is the `dt` passed to the step function (always `TICK_DT`) and tick counts. Delays, cooldowns, coyote time and hit-stop are tick counters in state. No clocks.
- Randomness comes from `createRng(seed)`. Store `rng.state()` in the save when a resumed game must continue the same sequence.
- Input and physics results arrive as plain data.
- Everything observable is a typed event in `events.ts`, emitted once, on the tick it happens.
- A save shape change bumps `SAVE_VERSION`, adds `migrations[old]` and commits `tests/fixtures/save-v<old>.json` captured from the old code.
- Keep `summarize()` small and stable; scenarios assert on it.
- Every rule change gets a Vitest test through `createWorld` and `stepWorld`, with edge cases at exact ticks.
