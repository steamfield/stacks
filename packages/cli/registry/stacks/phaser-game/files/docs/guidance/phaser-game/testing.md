# Testing

Three layers, each asserting on state and events rather than pixels.

## Vitest

`bun run test` runs two projects on Node:

- `unit`: `src/logic/**/*.test.ts`, `src/kit/**/*.test.ts` and `tests/*.test.ts`. Logic tests go through `createWorld` and `stepWorld` with small inline ASCII levels and check edge cases at exact ticks. `tests/save.test.ts` loads every save fixture; `tests/boundaries.test.ts` proves each Biome boundary rule fires.
- `runtime`: `src/engine/**/*.test.ts`, which drives the real `Runtime` tick by tick over a real save store on fake IndexedDB, with scenes standing in for Phaser.

Every rule change in logic gets a Vitest test. Run one file with `bun run test src/logic/world.test.ts`, or one test with `-t "<name>"`.

## Scenarios

A file in `scenarios/` is a start state, an input script and expectations, built from the typed kit in `scenarios/kit.ts` (`scenario`, `hold`, `tap`, `wait`). Each becomes a Playwright test in `tests/scenarios.spec.ts` and can be replayed with `bun run see --scenario <name>`.

- Durations are logic ticks (1/60 s), never milliseconds or rendered frames.
- Assert on `summary`, `state` and `events`. Never on pixels, and never on exact floats from physics: round in `debugSummary` or use `toBeCloseTo`, since local and CI machines differ.
- Start states come from `start.save` fixtures (validated and migrated by the save store), `start.scene`, `start.seed` and `start.query`, not from poking state from the test.
- A scenario whose outcome depends on a default setting pins it with an explicit `start.save`, so changing the default doesn't break every scenario at once.
- A rare moment is set up through a capture stage (`start: { query: { stage: "<name>" } }`), not by hunting for a seed.
- No sleeps or timeouts. The driver waits on `ready`, `idle()`, ticks and events.
- A long scenario sets `slow: true`, which triples its timeout; don't raise the global timeout for one test.
- A known bug is a scenario with `todo: true` and the correct expectation. Remove `todo` when it's fixed. Don't skip, focus or loosen tests to get green.

## Smoke tests

`tests/smoke.spec.ts` runs in all three browser projects: desktop Chromium, a phone (Chromium) and WebKit. It checks the renderer is `webgl`, that the game plays and saves, that a reload offers Continue, that a player arriving from a link sees no start gate, and that one fixed input reaches the pinned `WALL_JUMP_HASH` in every project. Tests that need touch carry `@touch` in the title and run only in the phone and WebKit projects.

The `game` fixture (`tests/support/fixture.ts`) fails any test that logged a console error, had a failed request, reported a game error or dropped events, and attaches the console log.

`tests/see.spec.ts` runs `bun run see` once against the build and checks the run folder it writes.

## Determinism

The tests only mean something if the same input gives the same state every time. In test mode the shell owns time: the engine's loop only renders, and logic advances only through `window.__game.advance(n)`, which stops early when the game isn't idle. Randomness comes from `createRng(seed)`. A scenario that passes sometimes and fails sometimes is a determinism bug: something reads a clock, uses `Math.random`, or ticks logic from the render loop. Find it; don't retry until it's green. On CI, Playwright retries once and fails the run if a test passed only on the retry.
