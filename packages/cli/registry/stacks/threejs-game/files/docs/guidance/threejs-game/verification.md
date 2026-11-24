# Before calling work done

You can't watch the game, so verify through commands that print short summaries and write details to files. Read what they say before changing more code.

1. The narrowest checks first: `bun run test <file>` for the files you touched, `bun run typecheck` and `bun run lint`.
2. `bun run see` for anything visual or about feel (below).
3. Before handing back: `bun run check` (lint, typecheck, test, e2e), then `stacks verify`, which also serves the build and probes it.

- A clean exit code isn't a pass. A `-t` filter that matches nothing exits 0 with every test skipped; read the counts.
- `bun run e2e` is the only check that runs the built bundle in a browser. Run it after a change to `vite.config.ts`, `index.html`, the shell, saves, input or anything `src/main.ts` imports.
- Don't report a cause you didn't observe. Quote the output you're basing it on.

## `bun run see`

Plays the built game headlessly in test mode to exact ticks and captures it. Run `bun run build` first; `see` serves `dist/`.

```
bun run see --scenario collect-first-orb                 # replay a scenario and check its expectations
bun run see --input "forward*50 right*40 jump _*30"      # ad-hoc input: action*ticks, a+b*ticks, _*ticks
bun run see --scenario push-crate --at 0,60,end          # a frame at each tick
bun run see --input "forward*30" --mobile                # phone viewport with the touch controls
bun run see --input "forward*50" --query stage=nearly-cleared
bun run see --scenario restore-save --out .runs/baseline # a run folder you name, kept until you delete it
```

It prints the summary on stderr and the run folder on stdout. The folder holds `frame-<tick>.png`, `summary.txt`, `state.json`, `events.jsonl` and `console.log`. Runs under `.runs/` keep only the most recent 30.

Read the summary first: the renderer, `debugSummary()` at each captured tick, event counts and any PROBLEMS. Then open the frames with your image tool to judge what a player sees.

- `renderer: none` or anything but `webgl2`: WebGL failed to start. It isn't your rendering code.
- A PROBLEMS line: a console error, a failed request, a game error or dropped events. Fix it first; it also fails `bun run e2e`.
- A black frame with no problems: nothing rendered yet. Check the summary's state.
- State is authoritative. Frames show layout, readability and feel; assertions belong on state and events.

When `see` reproduces a bug, copy the input into `scenarios/<bug-name>.ts` with `todo: true` and an `expect` describing the correct behavior. It is then a failing regression test.

## The person's own browser

When someone has the game open from `bun run dev`, that tab's save is theirs. Don't drive it with synthetic input to test something. Use `see` or a scenario, or open a fresh tab with `?test=1`.
