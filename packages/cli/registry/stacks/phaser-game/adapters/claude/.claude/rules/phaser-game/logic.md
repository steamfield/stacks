---
paths:
  - "src/logic/**"
  - "src/kit/core/**"
---

# Game logic (`src/logic/`, `src/kit/core/`)

This code is the game's rules. It runs in Vitest without a browser and in the shell's test mode, tick by tick.

- Imports only `zod`, `src/kit/core/` and other logic files. No Phaser, no DOM, no engine, shell, input or save kit (Biome and `tsconfig.logic.json` enforce this).
- Time is the `dt` passed to the step function (always `TICK_DT`) and tick counts. Delays, cooldowns, coyote time and hit-stop are tick counters in state. No clocks: `Date.now`, `performance.now` and `new Date()` fail lint.
- Randomness comes from `createRng(seed)`, never `Math.random`.
- Input and engine results arrive as plain data.
- Everything observable is a typed event in `events.ts`, emitted once, on the tick it happens.
- A save shape change bumps `SAVE_VERSION`, adds `migrations[old]`, and commits `tests/fixtures/save-v<old>.json` captured from the old code.
- Keep `summarize()` small and stable and `toAscii()` current.
- Every rule change gets a Vitest test through `createWorld`/`stepWorld`, with small inline levels and edge cases at exact ticks.

Detail: [architecture guidance](../../../docs/guidance/phaser-game/architecture.md). Feel techniques that change outcomes belong here; see the `game-feel` skill.
