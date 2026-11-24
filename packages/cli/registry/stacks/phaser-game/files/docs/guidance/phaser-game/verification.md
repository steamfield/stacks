# Before calling work done

You can't watch the game, so verify it through commands that print short summaries and write details to files. Read what they say before changing more code.

## While working

- `bun run test <file>` (or `-t "<name>"`) for the tests covering the change. A filter that matches nothing exits 0 with every test skipped; read the counts.
- `bun run lint` and `bun run typecheck`. A lint message names the fix (use `createRng`, save through `src/kit/save.ts`, move rendering to `src/engine/`); do what it says rather than suppressing it.
- `bun run build`, then `bun run see` to look at the result (below).

## Before handing back

Run `bun run check` (lint, typecheck, test, e2e) and read the output, then `stacks verify`, which also serves the build and probes it. `bun run e2e` is the only check that plays the built bundle in real browsers; it catches missing assets, wrong base paths and WebKit-only failures that the dev server hides.

## Looking at the game: `bun run see`

`see` plays the last build headlessly in test mode to exact ticks and captures it. Run `bun run build` first; `see` refuses a build older than `src/`.

```sh
bun run see --scenario collect-first-coin                 # replay a scenario and check its expectations
bun run see --scene play --input "right*60 jump right*30" # play input from a scene
bun run see --scenario complete-level --at 0,180,end      # capture several moments
bun run see --input "jump _*2 right*60" --mobile          # phone viewport with touch controls
bun run see --scene play --query stage=near-goal --debug  # start from a capture stage
bun run see --scene play --ascii                          # the level as text
```

Input tokens: `jump` taps for one tick, `right*30` holds for 30 ticks, `right+jump*10` holds both, `_*20` waits.

Read the printed summary first: the `run:` folder, the renderer, `debugSummary()` at each captured tick, event counts and any PROBLEMS. Then open `frame-<tick>.png` in that folder with your image tool to judge the visuals. `state.json`, `events.jsonl` and `console.log` hold the full detail. `.runs/` keeps the last 20 runs; pass `--out <dir>` for one to keep as a baseline.

- `renderer: canvas` or `none`: WebGL failed, not your rendering.
- A PROBLEMS line: a console error, a failed request, a game error or dropped events. Fix that first; it fails the e2e run too.
- A black frame with no problems: the scene probably hasn't rendered. Check `scene` in the summary.
- State is authoritative. Pixels show what a player sees (layout, readability, feel); assertions belong on state and events.
- `--scene` and `--query stage=` skip whatever a player carries in from earlier scenes. When a bug report starts from the title, reproduce it from the title.

When `see` reproduces a bug, copy the input into `scenarios/<bug-name>.ts` with `todo: true` and the correct expectation. It is then a failing regression test; remove `todo` when it's fixed.

## The person's own browser tab

When the person has the game open from `bun run dev`, that tab's save is theirs. Don't drive it with synthetic key presses: a menu press lands in their real save. Verify with `see` or a scenario, and if you need a browser, open a fresh tab with `?test=1` on another port.

## Reporting

- A clean exit code isn't a pass; read the counts and the summary.
- Run a dev or preview server in the background if you start one, and stop it when done.
- Don't report a cause you didn't observe. Quote the output you're basing it on.
