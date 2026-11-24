---
name: phaser-game
description: Build, extend or review this Phaser game's engine layer. Use when writing or changing Phaser scenes, sprites, atlases, Tiled tilemaps, cameras, audio, pixel-art scaling or the HUD, when porting Phaser examples from the web, or when a Phaser API from memory might be out of date. Covers how Phaser fits the logic/engine split and the shell's test mode, APIs that changed between Phaser majors, asset imports, and a review checklist.
---

# Phaser in this game

Phaser is pinned to one exact version in `package.json`. Your memory and most tutorials target an older major. Treat any Phaser API you recall as suspect until you've checked it against the installed version. The rules for how Phaser fits this game are in `docs/guidance/phaser-game/engine.md`; read it first. This skill adds where to look things up, assets, pitfalls and a checklist.

For the change-check-see loop, use `verify-game`. For game feel, juice, accessibility and mobile, use `game-feel`.

## 1. Look up the installed version

- `node_modules/phaser/package.json` for the version, and `node_modules/phaser/types/phaser.d.ts` for every signature.
- If `node_modules/phaser/skills/` exists, it holds agent skills written against that exact release, one folder per topic (scenes, loading assets, tilemaps, cameras, sprites and animations, text, particles, tweens and timers, filters, Arcade physics, audio, scaling, and migration from the previous major). Read the relevant `SKILL.md`, and its gotchas first, before writing code in that area. They win on Phaser APIs; `engine.md` wins on how things fit this game.
- Otherwise use that version's docs (Context7 has them) and its changelog.

## 2. How Phaser fits here

`src/engine/game.ts` is the reference, and `engine.md` spells out the contract. In short: `Runtime` (`src/engine/runtime.ts`) owns logic and scene flow, Phaser's `STEP` event feeds it wall time outside test mode, the shell calls `advance(ticks)` in test mode, and scenes only draw runtime state. Scenes call `rt.entered(key)` at the end of `create()`, and scene changes go through `rt.goTo` or `rt.startPlay`.

That rules out Phaser time, tweens and physics callbacks changing logic state, Phaser keyboard or pointer handlers for gameplay, Phaser's random numbers for anything logic reads, and any storage outside the `SaveStore`. If a game needs Arcade physics, `engine.md` says how to put it under the logic clock.

## 3. Assets

Every asset is imported so Vite hashes it into `_v/` and the build fails if it's missing. Keys come from typed consts, never string literals. Patterns for atlases, Aseprite, Tiled, audio and fonts are in [references/assets.md](references/assets.md).

```ts
import heroPng from "../assets/hero.png";
import heroJson from "../assets/hero.json?url";

export const Tex = { hero: "hero" } as const;

preload() {
  this.load.on("loaderror", (file: Phaser.Loader.File) =>
    this.rt.ctx.reportError("loader", `${file.key} ${file.url}`),
  );
  this.load.atlas(Tex.hero, heroPng, heroJson);
}
```

- Never `setBaseURL` or `setPath` on the loader; imported URLs are already absolute.
- `loaderror` must reach `ctx.reportError`, or a 404 shows up as a missing-texture warning instead of a failure. Audio decode errors don't emit `loaderror`; Phaser logs them with `console.error`, which the test driver already treats as a failure.
- Only load what the first scene needs before the title. Later scenes load in their own `preload()`, and `idle()` stays false until `create()`.
- Placeholder textures from `createPlaceholderTextures` stay valid. Replacing one with real art means loading an image under the same key.

## 4. Scenes, HUD, cameras, audio

**Scenes.** One scene per game mode (boot, title, play, pause overlay, dialogue). Scenes are constructed once with `rt`, so reset per-run state in `create()` or `init()`, not the constructor. Clean up listeners with `this.events.once("shutdown", ...)`. Running a HUD or pause scene in parallel (`scene.launch`) is fine; it renders and reads `rt` but doesn't tick logic.

**HUD and text.** HUD objects use `setScrollFactor(0)`. Update text only when the value changes; each `Text#setText` re-rasterizes a canvas and re-uploads a texture (the title and play scenes show the pattern). For menus and longer text, a DOM layer appended to `ctx.container` gives crisp, scalable, screen-reader-visible text. Keep it in `engine/`, set `pointer-events: none` unless it's interactive, and keep it clear of the touch overlay in the bottom corners.

**Cameras.** `this.cameras.main.setBounds(0, 0, mapW, mapH).startFollow(player, true)` as shipped. Add a deadzone for platformers so small movements don't scroll the view, and a small lookahead in the facing direction. Shake, flash and fade are visual only: trigger them from logic events (see `game-feel`), and gate shake and flash on the reduced-motion setting.

**Audio.** Phaser uses Web Audio by default. After boot, register its context so the shell can resume it after the first gesture and after iOS interrupts it:

```ts
game.events.once(Phaser.Core.Events.READY, () => {
  if (game.sound instanceof Phaser.Sound.WebAudioSoundManager) {
    ctx.registerAudioContext(game.sound.context);
  }
});
```

Play sounds from drained logic events (see `game-feel`), never from inside logic. The sound manager is global: stop looping music on scene shutdown yourself. When you add the first sound, consider an engine event such as `audio.played { key }` emitted once playback starts, so tests can check the game made a sound.

## 5. Pitfalls seen in practice

- Feeding `rt.frame()` from more than one place per frame doubles game speed. The shipped game feeds it once, from the game's `STEP` event.
- `this.scene.start()` is queued, not immediate. Don't read the new scene's objects in the same frame. `switchScene` in `game.ts` stops the other running scenes, not the target.
- Animations are global (`this.anims.create` once, in boot). Recreating them per scene logs warnings that clutter `bun run see`.
- `this.sound.play(key)` is fire and forget. Use `this.sound.add` for anything you need to stop.
- Tweens and timers left running on a shut-down scene's objects throw on restart. Kill them in the shutdown handler.
- Tiled: the tileset name passed to `addTilesetImage` must match Tiled exactly, and tilesets must be embedded in the map JSON. Mismatches return `null` with only a console warning.
- Forcing `Phaser.WEBGL` has no fallback and fails silently. Keep `AUTO`; the smoke test asserts `renderer() === "webgl"`.

## 6. Checklist before handing back

- [ ] Gameplay rules, timers, randomness and collision live in `src/logic/` and have Vitest coverage; the engine only reads state and forwards input.
- [ ] Nothing in `engine/` changes the world outside `Runtime.tick()`. Test mode doesn't tick from Phaser's loop.
- [ ] Phaser APIs checked against the installed version (section 1 and the table in `engine.md`). Typecheck passes against Phaser's own `.d.ts`.
- [ ] Every asset is imported, keyed through a typed const, and loaded with `loaderror` routed to `ctx.reportError`.
- [ ] New scenes keep `idle()` false until `create()` has run and call `rt.entered()`.
- [ ] Pixel art: integer zoom, `pixelArt: true`, rounded positions, extruded atlases, legible HUD text at 1x.
- [ ] Audio context registered with the shell; sounds triggered from events; music stops on scene shutdown.
- [ ] `debugSummary` has the fields new scenarios assert on, and a scenario covers the new behavior.
- [ ] The scoped tests, `bun run lint` and `bun run typecheck` pass, `bun run see` on the changed scene (desktop and `--mobile`) looks right, and `bun run e2e` is green before handing back (`verify-game`).
