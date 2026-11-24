---
paths:
  - "src/engine/**"
  - "src/main.ts"
  - "src/kit/**"
---

# Engine layer (`src/engine/`)

This code renders logic state, feeds it input and runs Rapier. Load the `threejs-game` skill before non-trivial changes, and read [engine](../../../docs/guidance/threejs-game/engine.md). Your memory of the three.js and Rapier APIs is older than the installed releases: check names in `node_modules` or through Context7.

- Logic changes only inside the `FixedStep` tick. In test mode (`ctx.params.testMode`) the engine's own loop must not tick; the shell calls `advance(ticks)`, which renders once afterwards.
- Engine clocks (`performance.now`, `THREE.Timer`, physics callbacks) drive visuals only, never gameplay. Rapier steps once per tick with `TICK_DT`.
- `WebGLRenderer` only; no `three/webgpu`, `three/tsl` or node materials.
- Input: read actions from `src/engine/input.ts` in the tick and pass plain data into logic.
- Saves go only through the `SaveStore` passed in. Never `localStorage` or `indexedDB`.
- Assets are imported (`?url` for models) and their load errors go to `ctx.reportError`. Keep `idle()` false while anything loads.
- The canvas fits `ctx.container`; don't size it from `window`.
- Log through `createLogger`, never `console`.
- Before calling a visual change done, look at it with `bun run see` (and `--mobile` for HUD or controls); see the `verify-game` skill.
