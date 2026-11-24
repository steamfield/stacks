# Phaser in this game

Phaser is pinned to one exact version in `package.json`. Most Phaser code in training data and tutorials targets an older major, so treat any Phaser API you remember as suspect until you've checked it against the installed version: `node_modules/phaser/types/phaser.d.ts`, the docs or agent skills that ship in `node_modules/phaser/` (look for a `skills/` folder), and that version's online docs. Where shipped Phaser docs disagree with this file about a Phaser API, they win; where they disagree about how Phaser fits this game (the loop, input, scaling, saves), this file wins.

## How Phaser fits the split

`src/engine/game.ts` is the reference:

- Scenes get the `Runtime` through their constructor. `BootScene` draws placeholder textures and calls `rt.start()`; each other scene calls `rt.entered(key)` at the end of `create()`.
- Phaser's `STEP` event calls `rt.frame(delta)` once per game step, so a scene switch mid-step can't tick logic twice. Don't call `rt.frame` from a scene's `update()`.
- Scenes read runtime state in `update()` and sync game objects to it (`PlayScene.sync()`). They never decide gameplay.
- Scene changes go through `rt.goTo(key)` (or `rt.startPlay(save)` for play), so `loading`, `idle()` and the `scene.started` event stay correct. Keep `idle()` false until a new scene's `create()` has run, including scenes that load assets in `preload()`.
- `startPhaser(ctx, saves)` returns the `GameHandle` the shell drives: `advance`, `idle`, `renderer`, `debugSummary`, `debugState`, `loadState`, `pause`, `resume` and `onHide` (`GameHandle` in `src/kit/shell.ts`).

What that rules out:

- Phaser's clock, tweens, timers and physics callbacks never change logic state. They run on Phaser's clock, which isn't the logic clock in test mode.

  ```ts
  // Gameplay that depends on time: count ticks in logic.
  if (world.respawnTicks > 0 && --world.respawnTicks === 0) respawn(world);

  // Not this: Phaser's clock isn't the logic clock, so tests and saves diverge.
  this.time.delayedCall(500, () => respawn(world));
  ```

- No Phaser keyboard or pointer handlers for gameplay or menus. Read `input` from `src/engine/input.ts` inside the tick and pass plain data into logic. Scenarios inject actions, so a `this.input.keyboard` path is invisible to them.
- No Phaser random numbers or `Math.random` for anything logic reads. Cosmetic randomness in `engine/` (particle spread) may use its own seeded `createRng`.
- No storage. Saves go through the `SaveStore` passed to `startPhaser`.

### Arcade physics, if you need it

The game has no Arcade physics: collision is tile AABB code in `src/logic/world.ts`, unit tested in Vitest. Keep that for platformers and tile games. If a game needs many moving bodies where engine physics pays off, put Arcade under the logic clock: set `arcade: { customUpdate: true, fps: 60 }` in the game config so Phaser never steps the world itself, call `physics.world.singleStep()` once per logic tick inside `Runtime.tick()`, and copy contacts into logic state as plain data. Anything a save or a scenario needs must live in logic state, not only on a body. Check the installed version's docs for both options before relying on them.

## Config, scaling and pixel art

- `type: Phaser.AUTO`, `parent: ctx.container`, `banner: false`, a fixed logical `width` and `height` (320x180 here), `pixelArt: true` for pixel art.
- `scale: { mode: Phaser.Scale.NONE }` plus a `ResizeObserver` on `ctx.container` calling `game.scale.setZoom(integerScale(WIDTH, HEIGHT, ctx.container))`. Don't switch to `FIT`, `ENVELOP` or `RESIZE` with `parent: ctx.container`: the shell pads the container for safe areas, and Phaser's scale manager ignores parent padding. Fractional zoom also makes pixel art shimmer. For smooth art, keep `NONE` and set a fractional zoom from the container size.
- Keep every asset at 1x on one base grid. Round positions when syncing from logic floats (`Math.round(world.player.x)`), and follow with rounding (`startFollow(target, true)`).
- Small `Text` at 320x180 blurs after zoom. Use `BitmapText` with a pixel font, or a DOM layer in `ctx.container` for menus and long text.

## Assets

Import every asset so Vite hashes it into `_v/` and fails the build if it's missing; never use `public/` or the loader's `setBaseURL`/`setPath`. JSON, Tiled maps and font descriptors need `?url` so they stay separate files. Keep texture, sound and map keys in typed consts next to the imports (`Tex` in `src/engine/textures.ts`), never string literals. Route the loader's `loaderror` event to `ctx.reportError`, or a 404 shows up only as a missing-texture warning. Load only what the first screen needs before the title.

## APIs that changed between majors

Habits from older Phaser majors that agents still write. Check each against the installed `phaser.d.ts` before using it:

| Older habit | What to check for instead |
| --- | --- |
| `sprite.preFX` / `postFX` | A filters API on the game object |
| `BitmapMask`, `setMask` | A mask filter |
| `setTintFill(color)` | `setTint` plus a tint mode |
| `setPipeline("Light2D")`, custom WebGL pipelines, raw `gl` calls | Lighting flags and render nodes |
| `this.textures.generate` | `Graphics` plus `generateTexture` (as `textures.ts` does) |
| `Geom.Point`, `Phaser.Struct.Set`/`Map` | `Phaser.Math.Vector2`, native `Set`/`Map` |
| `roundPixels` on by default | Off by default; `pixelArt: true` turns it on |
| Drawing into a `RenderTexture` and reading it right away | Draw calls may be buffered until a render call |
| `this.add.particles(key).createEmitter(cfg)` | `this.add.particles(x, y, key, cfg)` returning the emitter |
| The canvas renderer as a target | WebGL; the smoke test asserts `renderer() === "webgl"` |

## Debug views

- `debugSummary()` (`src/engine/debug.ts`) is small and stable: scene, save status, coins, the player's tile and `worldHash`. `bun run see` prints it and scenarios assert on it. Add fields new scenarios need.
- `debugState()` can be large: the world's changing fields, `ascii` and `worldHash`.
- Capture stages (`src/engine/capture-stages.ts`) make rare moments reviewable. `?stage=<name>` is honoured only with `?debug=1` or in test mode, writes plain world state right after the world is built, and marks the run so it never saves. Add a name to `STAGES` and a case to `applyStage` for each moment worth reviewing.
- `?debug=1` draws the overlay from logic data, so it shows what logic believes.
