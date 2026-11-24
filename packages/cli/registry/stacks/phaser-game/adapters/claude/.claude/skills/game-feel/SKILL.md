---
name: game-feel
description: Craft that makes a browser game feel polished, done in a way that keeps this game deterministic. Use when tuning controls (coyote time, jump buffering, acceleration), adding juice (screen shake, hit-stop, particles, squash and stretch, flashes, sound), designing the HUD or menus, adding accessibility (reduced motion, colorblind-safe palettes, captions, assist options), improving touch and mobile ergonomics, or cutting load time. Also use when someone says the game "feels floaty", "feels stiff", "lacks impact" or "isn't readable".
---

# Game feel, juice and UX

Polish here has one constraint the usual advice doesn't: logic is deterministic and tested by scenarios. Every technique below says which side of the logic/engine split it belongs on. Phaser specifics are in `phaser-game`; the verify loop is in `verify-game`.

## 1. Where feel lives

| It changes... | It lives in | Timed in | Examples |
| --- | --- | --- | --- |
| What happens: positions, collisions, outcomes, timing of rules | `src/logic/` | Ticks (1/60 s) | Coyote time, jump buffer, hit-stop, invulnerability frames, acceleration curves, knockback |
| Only what the player sees or hears | `src/engine/` | Ticks preferred, wall time allowed | Screen shake, particles, squash and stretch, flashes, damage numbers, camera lookahead, sounds |

Test: if turning the effect off could change a scenario's events or `debugSummary`, it belongs in logic. Hit-stop pauses the simulation, so it's logic. Shake moves only the camera, so it's engine.

Rules for engine-side effects:

- **Triggered by logic events, never by input directly.** The jump sound plays on `player.jumped`, not on the key press, so a buffered jump plays its sound at the right moment and a blocked jump plays none.
- **Visual state, separate from logic state.** Effects keep their own state (trauma, particle lists, flash timers) in `engine/` and never write into the world.
- **Advanced per tick where possible.** An effect stepped in the tick looks the same in `bun run see` at tick N however the harness split its `advance()` calls. Engine clocks (Phaser tweens, `performance.now()`) don't advance between test ticks the same way, so captures of clock-driven effects aren't reproducible.
- **Cosmetic randomness from its own seeded rng**, e.g. `createRng(ctx.params.seed ^ 0x9e3779b9)`, so screenshots repeat.

### Consuming events in the engine

`EventLog.drain(cursor)` is non-destructive and each reader keeps its own cursor, so the effects layer reads alongside the test harness:

```ts
let fxCursor = 0;
function runEffects() { // call at the end of each tick, after stepWorld
  const { events, cursor } = rt.events.drain(fxCursor);
  fxCursor = cursor;
  for (const e of events) {
    switch (e.type) {
      case "player.jumped": fx.squash(0.8, 1.2); sfx.play(Sfx.jump); break;
      case "player.landed": fx.squash(1.2, 0.8); fx.dust(); break;
      case "coin.collected": fx.sparkle(e.index); fx.popText("+1"); sfx.play(Sfx.coin); break;
    }
  }
  fx.tick(); // decay trauma, advance particles, count down flashes
}
```

## 2. Controls that feel good (logic)

These change outcomes, so they go in `stepWorld` with Vitest tests. Values are in ticks; the ranges are common starting points, and the real numbers come from playing.

- **Coyote time (5-7 ticks):** jumping is still allowed for a few ticks after walking off a ledge.
- **Jump buffer (6-9 ticks):** a jump pressed shortly before landing fires on landing.
- **Variable jump height:** the shipped world cuts upward speed when jump is released (`jumpCutVelocity`). Keep it.
- **Asymmetric gravity:** stronger gravity when falling than rising (about 1.5-2x), and lower gravity near the apex while jump is held, for a snappy arc with hang time.
- **Acceleration and friction:** separate ground and air values. Instant reversal on the ground feels responsive; a little air momentum feels physical. Pure instant velocity (the shipped `p.vx = Math.sign(input.move) * PHYSICS.runSpeed`) is fine for a prototype and stiff for a finished game.
- **Corner correction:** if a jump clips a ceiling corner by a pixel or two, nudge sideways instead of stopping dead. Likewise on ledge tops.
- **Max fall speed** so long falls stay readable (the shipped world has `maxFall`).
- **Invulnerability ticks** after damage, with a visible flicker (engine) driven by the logic counter.

```ts
// logic: added to Player { coyote: number; jumpBuffer: number }
export const FEEL = { coyoteTicks: 6, jumpBufferTicks: 8 } as const;

p.jumpBuffer = input.jumpPressed ? FEEL.jumpBufferTicks : Math.max(0, p.jumpBuffer - 1);
p.coyote = p.grounded ? FEEL.coyoteTicks : Math.max(0, p.coyote - 1);
if (p.jumpBuffer > 0 && p.coyote > 0) {
  p.vy = -PHYSICS.jumpVelocity;
  p.grounded = false;
  p.jumpBuffer = 0;
  p.coyote = 0;
  world.events.emit({ type: "player.jumped" });
}
```

Test each one at its edges in Vitest: "jumps when pressed 6 ticks after leaving the ledge", "doesn't jump at 7", "a press 8 ticks before landing jumps on the landing tick". Saves that include `Player` need a schema bump and migration if these fields are persisted. Usually they shouldn't be. Any change to the physics also moves the pinned `WALL_JUMP_HASH` in `tests/smoke.spec.ts`.

**Hit-stop (logic):** freeze the simulation for 2-6 ticks on a heavy hit. Keep a `world.freezeTicks` counter that `stepWorld` decrements before returning early. Keep buffering input during the freeze, or presses get eaten.

## 3. Juice (engine), with restraint

Every player action should get feedback within a tick or two: a sound, a visual, or both. Big effects are for big moments only.

- **Screen shake:** use a trauma model. Events add trauma (0..1), it decays linearly per tick, and offset = max offset × trauma² × noise. Squaring keeps small hits subtle. Cap the offset at a few pixels in pixel art, and add rotation only a little.
- **Squash and stretch:** scale the sprite on jump (tall), land (wide) and hit, easing back over 6-10 ticks. Visual only; the hitbox doesn't change.
- **Particles:** dust on landing and turning, sparkles on pickups, debris on breaks. Short-lived, few, pooled.
- **Flash:** a 2-4 tick white flash on the hit sprite (a fill tint), not on the whole screen.
- **Number pops and anticipation:** damage or score numbers rising and fading; a short wind-up before big enemy attacks. Wind-up is a gameplay telegraph, so its timing is logic.
- **Sound:** vary pitch slightly per play (±5%) with the cosmetic rng so repeats don't grate, and keep each sound short. Duck music under important cues.
- **Camera:** a deadzone so small moves don't scroll, lookahead toward facing or velocity, and smoothing that's frame-rate independent.

Don't: shake on every coin, flash the full screen, slow-motion on routine events, or let particles hide hazards. If you can't see the player during an effect, tone it down.

## 4. Readable screens

- **Contrast:** HUD text at least 4.5:1 against what's behind it (WCAG AA), with a backing panel or outline over busy scenes. Interactive and hazard shapes at least 3:1 against the background.
- **Size:** HUD text no smaller than about 16 CSS px on a phone. In 320x180 pixel art at 3x zoom that's about 6 game px, so use a bitmap font designed for that size.
- **Hierarchy:** player, hazards and pickups read first. Background art is lower contrast and less saturated than gameplay objects.
- **Telegraphing:** dangerous things look dangerous (red is not enough, see section 5), and attacks wind up before they hit.
- **State on screen:** pause, game over, level complete and "saving" each have a clear screen with one obvious next action, reachable from keyboard and touch.
- **The shell's UI:** the touch overlay sits in the bottom corners and notices at the bottom center. Keep the HUD clear of both.

## 5. Accessibility

- **Reduced motion:** read `matchMedia("(prefers-reduced-motion: reduce)")` at boot and offer an in-game toggle that overrides it. When on: no screen shake, no camera bob, no full-screen flashes, gentler or no parallax, shorter transitions. Gameplay doesn't change.
- **Flashing:** nothing flashes more than three times in any one second (WCAG's three-flashes rule), at any setting.
- **Color:** never let hue alone carry meaning. Pair color with shape, icon, pattern or position. A colorblind-safe base palette such as Okabe-Ito avoids most red-green confusions. Check captures in grayscale and with a deuteranopia simulator.
- **Captions:** any sound that carries gameplay information (an off-screen enemy, a timer warning, dialogue) gets a visual equivalent: a caption line, a directional indicator, or an icon. Music and pure ambience don't need one.
- **Controls:** `src/kit/input.ts` takes its key map once in `createInput` and has no runtime remap yet. Give every action at least two default keys (arrows and WASD, as shipped), and never require simultaneous presses that a one-handed player can't make.
- **Assist options** where they fit the game: slower game speed, extra health or invulnerability, skip a section, toggle instead of hold. Assists change outcomes, so they are logic settings passed into `createWorld` and covered by tests.
- **Pause anywhere,** and the game already pauses on hide (the shell calls `pause()` and saves).
- **Settings persist** through `src/kit/save.ts` as part of the save schema: bump `SAVE_VERSION`, add a migration that fills defaults, and commit a fixture of the old version.

## 6. Touch and mobile

- The shell and `src/kit/input.ts` provide the touch overlay (d-pad, buttons) inset from edges and safe areas, gesture suppression and the rotate prompt. Don't add a second touch layer.
- Touch targets at least 44 CSS px. WCAG's minimum target size is 24 px, but that's for UI, not thumbs during play.
- Map the important actions to the button closest to the right thumb's rest position (the first entry in `touch.buttons` is bottom right). Keep the button count to what thumbs can find without looking: two, three at most.
- Nothing depends on hover, right-click or keyboard-only shortcuts. Every menu works with taps or the overlay buttons.
- Touch has no tactile edges, so make the buffer and coyote windows generous and check with `bun run see --mobile`.
- Phones throttle when hot. A game that holds 60 fps for one minute may not after ten. Prefer the cheaper option (fewer particles) when in doubt.
- Run the `@touch` smoke tests (`bun run e2e`) and look at a `--mobile` capture whenever the HUD or the controls change.

## 7. Loading and first paint

Aim for under 5 s to interactive on a mid-range phone with a cold cache.

- The shell starts the game as soon as the page loads, with no start button, so the first frame waits on `main.ts`. Keep it light and lazy-load big imports. Audio is silent until the first tap or key press.
- Load only what the first screen needs before the title. Load later scenes and music after the first frame, with visible progress, and keep `idle()` false while they load.
- Show progress for anything over about a second. A frozen screen reads as a crash.
- Compress: WebP or optimized PNG textures, short mono sound effects. Check the bundle sizes `bun run build` prints after adding assets.

## 8. Verifying feel

Feel can't be fully checked headlessly, but most of it can be pinned down:

- Logic feel (coyote, buffer, hit-stop) gets tick-exact Vitest tests and a scenario.
- Juice: `bun run see --scenario <name> --at <before>,<event tick>,<after>` captures each moment. Check that the effect is visible, short, and doesn't hide the player. Use `--mobile` for HUD and controls.
- Effect triggers are observable: add engine events (`fx.shake`, `audio.played`) if a test needs to assert that feedback happened.
- Ask the person for a hands-on play to tune values. Say which constants (`FEEL`, `PHYSICS`) to adjust.

## Checklist

- [ ] Rules that change outcomes (buffering, coyote, hit-stop, i-frames, assists) are in logic, counted in ticks, with edge tests.
- [ ] Effects fire from drained logic events, keep their own state, and use cosmetic rng only.
- [ ] Every player action has feedback within a tick or two; big effects only for big moments.
- [ ] Reduced-motion setting honored; nothing flashes more than 3 times per second.
- [ ] No meaning carried by color alone; HUD contrast and size checked in a `--mobile` capture.
- [ ] Gameplay-relevant sounds have a visual equivalent.
- [ ] Touch: targets 44 px or larger, no hover, HUD clear of the overlay.
- [ ] Only first-screen assets load before the title; everything else loads with progress shown.
