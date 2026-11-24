---
name: verify-game
description: The loop for checking that a change to this game works, using the scoped tests, bun run see and bun run e2e. Use after editing anything under src/, scenarios/ or tests/, when asked to verify, debug or "look at" the game, when a scenario or smoke test fails, or before reporting a game change as done.
---

# Verify a game change

You can't watch the game, so verify through commands that print short summaries and write details to files. Run them in this order and read what they say before changing more code. `docs/guidance/phaser-game/verification.md` is the shared version of this loop.

## 1. Scoped checks (seconds)

Prove a change with the narrowest tests that cover it: `bun run test src/logic/world.test.ts` (add `-t "<name>"` for one test), then `bun run lint` and `bun run typecheck`. A filter that matches nothing exits 0 with every test skipped, so read the counts.

- Formatting errors: run `bun run format`, then lint again.
- A lint message names the fix (use `createRng`, save through `src/kit/save.ts`, move rendering to `src/engine/`). Do what it says rather than suppressing it. `biome-ignore` and `@ts-expect-error` show up in review.

## 2. `bun run see` (a few seconds)

Plays the last build headlessly in test mode to an exact state and captures it. Run `bun run build` first after any change; `see` refuses a build older than `src/`.

```sh
bun run see --scenario <name>                     # replay a scenario and check its expectations
bun run see --scene play --input "right*60 jump right*30"
bun run see --scenario <name> --at 0,30,end       # several moments, one frame each
bun run see --input "jump _*2 right*40" --mobile  # phone viewport and touch controls
bun run see --scene play --ascii                  # the level as text
bun run see --scene play --query stage=near-goal --debug   # a capture stage, with the overlay
```

`--scene` and `--query stage=` jump straight to a scene, which skips any state a player carries in from earlier scenes. When a bug report starts from the title screen, reproduce it from the title screen. The default 960x540 window is an exact multiple of 320x180; check a `--mobile` capture too.

Before a change that must not alter visuals (a refactor), capture a baseline with `--out .runs/baseline-<name>` from the old code, then rerun the same command into another folder and compare the frames. `.runs/` keeps only the last 20 dated runs; folders given with `--out` stay.

Read the printed summary first: the `run:` folder, the renderer, the game's `debugSummary()` at each captured tick, event counts and PROBLEMS. Then open `frame-<tick>.png` in that folder with your image tool to judge the visuals. `state.json`, `events.jsonl` and `console.log` have the full detail.

- **`renderer: canvas` or `none`:** WebGL failed. It is not your rendering code.
- **A PROBLEMS line:** a console error, a failed request, a game error or dropped events. Fix that first; it fails e2e too.
- **A black or empty frame with no problems:** the scene probably hasn't rendered. Check `scene` in the summary.
- **Visuals vs state:** state is authoritative. Pixels show what a player sees (layout, readability, feel). Assertions belong on state and events.

When `see` reproduces a bug, copy the input into `scenarios/<bug-name>.ts` with `todo: true` and an `expect` describing correct behavior. It is then a failing regression test. Remove `todo` when it's fixed.

## The person's dev server

When the person has the game open from `bun run dev`, that tab's save is theirs. Don't drive it with synthetic key presses to test something: a menu press lands in their real save. Verify with `see` or a scenario, and if you must use a browser, open a fresh tab with `?test=1` on another port.

## 3. `bun run e2e` and `bun run check` (before handing back)

`bun run e2e` builds and runs the Playwright suite against `vite preview`: every scenario, the `see` test and the smoke tests on desktop Chromium, plus the smoke tests on a phone and on WebKit. It catches missing assets, wrong paths and WebKit-only failures the dev server hides. `bun run check` runs lint, typecheck, tests and e2e. Failure output shows Playwright's assertion diff; traces and screenshots are in `test-results/`.

## Why runs repeat exactly

- **Ticks:** in test mode the shell drives fixed 1/60 s ticks through `window.__game.advance()`. The engine's own loop only renders.
- **Loads:** `advance()` stops when the game isn't idle (a scene loading, a save being written), and the driver waits for `idle()` before continuing, so load timing never changes the result.
- **Seeds:** randomness comes from `createRng(seed)`. Pass `--seed` to try another.

A scenario that passes sometimes and fails sometimes is a determinism bug in the game: something reads a clock, uses `Math.random`, or ticks logic from the render loop. Find it; don't retry until it's green.

## Writing or fixing tests

- **Logic behavior:** Vitest in `src/logic/*.test.ts`, through `createWorld`/`stepWorld`, with small inline ASCII levels.
- **Scene flow and saves:** `src/engine/runtime.test.ts`, the real `Runtime` over fake IndexedDB.
- **Whole-game behavior:** a scenario in `scenarios/`.
- **Load, render, input, save and touch:** `tests/smoke.spec.ts`. Touch-only tests get `@touch` in the title.
- **Watching a test fail:** break the behavior, confirm the test fails with a useful message, then restore the code.
