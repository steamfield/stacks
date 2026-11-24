---
name: verify-game
description: The loop for checking that a change to this game works, using the scoped Vitest run, bun run see and bun run e2e. Use after editing anything under src/, scenarios/ or tests/, when asked to verify, debug or "look at" the game, when a scenario or smoke test fails, or before reporting a game change as done.
---

# Verify a game change

You can't watch the game, so verify through commands that print short summaries and write details to files. Run them in this order and read what they say before changing more code.

## 1. The narrowest checks (seconds)

- `bun run test <file>` for the Vitest files covering what you changed, or `bun run test --project logic` for every logic test. Read the counts: a `-t` filter that matches nothing exits 0.
- `bun run typecheck` and `bun run lint`. A lint message names the fix (use `createRng`, use `src/kit/save.ts`, move rendering to `src/engine/`); do what it says rather than suppressing it. `biome-ignore` and `@ts-expect-error` show up in review.
- "File needs formatting": run `bun run format`, then lint again.

## 2. `bun run see` (a few seconds)

Plays the built game headlessly in test mode to an exact state and captures it. It serves `dist/`, so run `bun run build` after source changes.

```
bun run see --scenario <name>                          # replay a scenario and check its expectations
bun run see --input "forward*60 jump right*30"         # ad-hoc input
bun run see --scenario <name> --at 0,30,end            # a frame at each tick
bun run see --input "forward*40" --mobile              # phone viewport with the touch controls
bun run see --input "forward*50" --query stage=nearly-cleared
bun run see --scenario <name> --out .runs/baseline     # a run folder you name
```

Input tokens: `jump` taps for one tick, `right*30` holds for 30 ticks, `right+jump*10` holds both, `_*20` waits. Ticks past the end of the input wait with nothing pressed, so `--at` needs no padding.

The summary goes to stderr and the run folder's path to stdout. Read the summary first: the renderer, `debugSummary()` at each captured tick, event counts and PROBLEMS. Then open `frame-<tick>.png` in that folder with your image tool. `state.json`, `events.jsonl` and `console.log` hold the detail.

- `renderer:` anything but `webgl2`: WebGL failed to start. It isn't your rendering code.
- A PROBLEMS line: a console error, a failed request, a game error or dropped events. Fix that first; it also fails e2e.
- A black frame with no problems: nothing rendered yet. Check the state.
- State is authoritative. Frames show what a player sees; assertions belong on state and events.

When `see` reproduces a bug, copy the input into `scenarios/<bug-name>.ts` with `todo: true` and an `expect` describing correct behavior. It is then a failing regression test; remove `todo` when it's fixed.

## 3. `bun run e2e` (before handing back)

Builds, serves `dist/` with `vite preview`, and runs the Playwright suite (every scenario, `tests/smoke.spec.ts` and the `see` check) on desktop Chromium and a phone. It catches what dev mode hides: wrong base paths, missing assets, a renderer that fell back. Failure output shows Playwright's assertion diff; traces and screenshots are in `test-results/`.

Then `bun run check` runs lint, typecheck, test and e2e together, and `stacks verify` also serves the build and probes it.

## Why runs repeat exactly

- Ticks: in test mode the shell drives fixed 1/60 s ticks through `window.__game.advance()`. The engine's own loop only renders.
- Loads: `advance()` stops when the game isn't idle (physics loading, a save in flight), and the driver waits for `idle()` before continuing.
- Seeds: randomness comes from `createRng(seed)`. Pass `--seed` to try another layout.

A scenario that passes sometimes and fails sometimes is a determinism bug: something reads a clock, uses `Math.random`, or ticks logic from the render loop. Find it; don't retry until it's green.

## The person's own browser

When someone has the game open from `bun run dev`, that tab's save is theirs. Don't drive it with synthetic input. Use `see` or a scenario, or open a fresh tab with `?test=1`.

## Writing or fixing tests

- Logic behavior: Vitest in `src/logic/*.test.ts` through `createWorld` and `stepWorld`.
- Whole-game behavior: a scenario in `scenarios/`.
- Load, render, input, save and touch: `tests/smoke.spec.ts`. Touch-only tests get `@touch` in the title.
- To watch a test fail: break the behavior, confirm the test fails with a useful message, then restore the code.
