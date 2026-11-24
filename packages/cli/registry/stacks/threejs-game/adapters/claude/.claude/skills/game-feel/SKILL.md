---
name: game-feel
description: Craft that makes a browser game feel finished rather than like a prototype, done in a way that keeps this game deterministic. Use when tuning controls (coyote time, jump buffering, acceleration), adding juice (screen shake, hit-stop, particles, squash and stretch, flashes, sound), designing the HUD or menus, adding accessibility (reduced motion, colorblind-safe palettes, captions, assist options), improving touch and mobile ergonomics, or cutting load time. Also use when someone says the game "feels floaty", "feels stiff", "lacks impact" or "isn't readable".
---

# Game feel, juice and UX

Polish here has one constraint the usual advice doesn't: logic is deterministic and tested by scenarios. Every technique below says which side of the logic and engine split it belongs on. three.js specifics are in the `threejs-game` skill; the check loop is in `verify-game`.

## 1. Where feel lives

| It changes... | It lives in | Timed in | Examples |
| --- | --- | --- | --- |
| What happens: positions, collisions, outcomes, timing of rules | `src/logic/` | Ticks (1/60 s) | Coyote time, jump buffer, hit-stop, invulnerability frames, acceleration curves, knockback |
| Only what the player sees or hears | `src/engine/` | Ticks preferred, wall time allowed | Screen shake, particles, squash and stretch, flashes, damage numbers, camera lookahead, sounds |

The test: if turning the effect off could change a scenario's events or `debugSummary`, it belongs in logic. Hit-stop pauses the simulation, so it's logic. Shake moves only the camera, so it's engine.

Rules for engine-side effects:

- Triggered by logic events, never by input directly. The jump sound plays on the jump event, not on the key press, so a buffered jump plays its sound at the right moment and a blocked jump plays none.
- Visual state kept apart from logic state. Effects keep their own state (trauma, particle lists, flash timers) in `engine/` and never write into the world.
- Advanced per tick where possible. An effect stepped in the tick looks the same in `bun run see` at tick N however the harness split its `advance()` calls. Wall-clock effects don't advance between test ticks the same way, so their captures don't repeat.
- Cosmetic randomness from its own seeded rng, such as `createRng(ctx.params.seed ^ 0x9e3779b9)`, so captures repeat.

### Reading events in the engine

`EventLog.drain(cursor)` doesn't remove anything, and each reader keeps its own cursor, so the effects layer reads alongside the test harness:

```ts
let fxCursor = 0;
function runEffects() { // call at the end of each tick, after stepWorld
  const { events, cursor } = runtime.events.drain(fxCursor);
  fxCursor = cursor;
  for (const e of events) {
    switch (e.type) {
      case "player.jumped": fx.squash(0.8, 1.2); sfx.play(Sfx.jump); break;
      case "orb.collected": fx.sparkle(e.index); sfx.play(Sfx.pickup); break;
    }
  }
  fx.tick(); // decay trauma, advance particles, count down flashes
}
```

## 2. Controls that feel good (logic)

These change outcomes, so they go in `stepWorld` with Vitest tests. Values are in ticks; the ranges are common starting points, and the real numbers come from playing.

- Coyote time (5 to 7 ticks): jumping is still allowed for a few ticks after walking off a ledge.
- Jump buffer (6 to 9 ticks): a jump pressed shortly before landing fires on landing.
- Variable jump height: cut upward speed when jump is released.
- Asymmetric gravity: stronger falling than rising (about 1.5 to 2 times), for a snappy arc with hang time.
- Acceleration and friction: separate ground and air values. Instant velocity from input is fine for a prototype and stiff for a finished game.
- Corner correction: when a jump clips a ledge or ceiling edge, nudge the player past it instead of stopping dead.
- A maximum fall speed, so long falls stay readable.
- Invulnerability ticks after damage, with a visible flicker in the engine driven by the logic counter.

```ts
// logic: Player gains { coyote: number; jumpBuffer: number }
export const FEEL = { coyoteTicks: 6, jumpBufferTicks: 8 } as const;

p.jumpBuffer = input.jumpPressed ? FEEL.jumpBufferTicks : Math.max(0, p.jumpBuffer - 1);
p.coyote = p.grounded ? FEEL.coyoteTicks : Math.max(0, p.coyote - 1);
if (p.jumpBuffer > 0 && p.coyote > 0) {
  p.vy = PHYSICS.jumpVelocity;
  p.grounded = false;
  p.jumpBuffer = 0;
  p.coyote = 0;
  events.emit({ type: "player.jumped" });
}
```

Test each at its edges in Vitest: "jumps when pressed 6 ticks after leaving the ledge", "doesn't at 7", "a press 8 ticks before landing jumps on the landing tick". These counters usually stay out of the save; if they're persisted, bump the save version and add a migration.

Hit-stop (logic): freeze the simulation for 2 to 6 ticks on a heavy hit with a `freezeTicks` counter that `stepWorld` decrements before returning early. Keep buffering input during the freeze, or presses get eaten.

## 3. Juice (engine), with restraint

Every player action gets feedback within a tick or two: a sound, a visual, or both. Big effects are for big moments only.

- Screen shake: a trauma model. Events add trauma (0 to 1), it decays linearly per tick, and the offset is max offset times trauma squared times noise. Squaring keeps small hits subtle. Cap it at a few centimeters in world space and don't roll the camera.
- Squash and stretch: scale the model on jump (tall), land (wide) and hit, easing back over 6 to 10 ticks. The collider doesn't change.
- Particles: dust on landing and turning, sparkles on pickups, debris on breaks. Short-lived, few, pooled, and drawn as one `InstancedMesh` or `Points`.
- Flash: a 2 to 4 tick emissive flash on the hit model, not the whole screen.
- Anticipation: a short wind-up before big enemy attacks. The wind-up is a gameplay telegraph, so its timing is logic.
- Sound: vary pitch slightly (about 5%) with the cosmetic rng so repeats don't grate, and keep each sound short. Duck music under important cues.
- Camera: a deadzone so small moves don't swing it, lookahead toward the movement direction, and smoothing per tick (see `threejs-game`).

Don't shake on every pickup, flash the full screen, slow time on routine events, or let particles hide hazards. If you can't see the player during an effect, tone it down.

## 4. Readable screens

- Contrast: HUD text at least 4.5:1 against what's behind it, with a backing panel or outline over busy scenes. Hazards and interactive objects at least 3:1 against the background.
- Size: HUD text no smaller than about 16 CSS px on a phone.
- Hierarchy: player, hazards and pickups read first. Scenery is lower contrast and less saturated than gameplay objects. Check a capture in grayscale.
- Telegraphing: dangerous things look dangerous (red alone isn't enough, see section 5), and attacks wind up before they hit.
- State on screen: pause, game over, level complete and saving each get a clear screen with one obvious next action, reachable from keyboard and touch.
- Keep the HUD clear of the touch controls in the bottom corners.

## 5. Accessibility

- Reduced motion: read `matchMedia("(prefers-reduced-motion: reduce)")` at boot and offer an in-game toggle that overrides it. When on: no shake, no camera bob, no full-screen flashes, shorter transitions. Gameplay doesn't change.
- Flashing: nothing flashes more than three times in any one second, at any setting.
- Color: never let hue alone carry meaning. Pair it with shape, icon, pattern or position. A colorblind-safe palette such as Okabe-Ito avoids most red-green confusions.
- Captions: a sound that carries gameplay information (an off-screen enemy, a timer warning) gets a visual equivalent. Music and ambience don't need one.
- Controls: `src/kit/input.ts` takes its key map once in `createInput` and has no runtime remapping. Until it does, give every action at least two default keys (arrows and WASD, as the game does), and never require simultaneous presses a one-handed player can't make.
- Assist options where they fit: slower game speed, extra health, toggle instead of hold. Assists change outcomes, so they're logic settings passed into `createWorld` and covered by tests.
- Pause anywhere. The shell already pauses and saves when the page is hidden.
- Settings persist through `src/kit/save.ts` as part of the save schema: bump `SAVE_VERSION`, add a migration that fills defaults, and commit a fixture of the old version.

## 6. Touch and mobile

- The kit provides the touch overlay (d-pad and buttons) inset from edges and safe areas, gesture suppression and the rotate prompt. Don't add a second touch layer.
- Touch targets at least 44 CSS px; the overlay's are larger.
- Map the most important action to the button nearest the right thumb's resting position (the first entry in `touch.buttons`). Two buttons, three at most.
- Nothing depends on hover, right-click or keyboard-only shortcuts.
- Touch has no tactile edges, so make buffer and coyote windows generous, and check with `bun run see --mobile`.
- Phones throttle when hot. A game that holds 60 fps for a minute may not after ten. Prefer the cheaper option (fewer particles, blob shadows) when in doubt.
- Run the `@touch` smoke tests and look at a `--mobile` capture whenever the HUD or controls change.

## 7. Loading and first paint

Aim for under 10 s to interactive on a mid-range phone with a cold cache.

- The shell starts the game as soon as the page loads, so the first frame waits on `src/main.ts`. Keep it light and lazy-load big imports, as the game does with Rapier. Audio is silent until the first tap or key press.
- Load only what the first screen needs. Load later scenes, music and physics after the first frame, with visible progress, and keep `idle()` false while they load.
- Show progress for anything over about a second. A frozen screen reads as a crash.
- Compress: KTX2 or WebP textures, meshopt geometry, short mono sound effects. Check the build output sizes after adding assets.

## 8. Checking feel

Feel can't be fully checked headlessly, but most of it can be pinned down:

- Logic feel (coyote, buffer, hit-stop) gets tick-exact Vitest tests and a scenario.
- Juice: `bun run see --scenario <name> --at <before>,<event tick>,<after>` gives a frame at each moment. Check the effect is visible, short, and doesn't hide the player. Use `--mobile` for HUD and controls.
- Make effect triggers observable: add engine events (`fx.shake`, `audio.played`) when a test needs to assert that feedback happened.
- Ask the owner for a hands-on play to tune values, and say which constants (`FEEL`, `PHYSICS`) to adjust.

## Checklist

- [ ] Rules that change outcomes (buffering, coyote, hit-stop, invulnerability, assists) are in logic, counted in ticks, with edge tests.
- [ ] Effects fire from drained logic events, keep their own state, and use a cosmetic rng only.
- [ ] Every player action has feedback within a tick or two; big effects only for big moments.
- [ ] Reduced motion honored; nothing flashes more than 3 times per second.
- [ ] No meaning carried by color alone; HUD contrast and size checked in a `--mobile` capture.
- [ ] Gameplay sounds have a visual equivalent.
- [ ] Touch targets 44 px or larger, no hover, HUD clear of the overlay.
- [ ] Only first-screen assets load before play; everything else loads with progress shown.
