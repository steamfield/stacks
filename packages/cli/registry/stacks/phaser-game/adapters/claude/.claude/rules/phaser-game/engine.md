---
paths:
  - "src/engine/**"
  - "src/main.ts"
  - "src/kit/shell.ts"
---

# Engine layer (`src/engine/`)

This code renders logic state, feeds it input, and owns scene flow. Load the `phaser-game` skill before non-trivial changes, and check APIs against the installed Phaser (`node_modules/phaser/types/phaser.d.ts`): your memory is probably of an older major.

- Logic changes only inside `Runtime.tick()`, the `FixedStep` callback. In test mode Phaser's loop must not tick logic; the shell calls the handle's `advance(ticks)`.
- Phaser's clock, tweens, timers and physics callbacks drive visuals only, never gameplay.
- Input: read actions from `src/engine/input.ts` in the tick (`input.update()` first) and pass plain data into logic. No Phaser keyboard or pointer handlers for gameplay.
- Saves only through the `SaveStore` passed in. Never `localStorage` or `indexedDB`.
- Import assets and key them through typed consts. Route loader and context-loss errors to `ctx.reportError`. Keep `idle()` false while anything loads.
- The canvas fits `ctx.container`, which the shell sizes and pads for safe areas. Don't size it from `window`.
- Effects (shake, particles, sounds) fire from drained logic events and keep their own state; see `game-feel`.
- Log through `createLogger`, not `console`.
- Look at a visual change with `bun run build && bun run see ...` (and `--mobile` for HUD or controls) before saying it works; see `verify-game`.

Detail: [engine guidance](../../../docs/guidance/phaser-game/engine.md).
