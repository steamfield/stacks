# Testing

Three layers, from fastest to slowest:

| Layer | Where | Runs with | Covers |
| --- | --- | --- | --- |
| Logic | `src/logic/*.test.ts`, `src/kit/core/*.test.ts` | `bun run test` (Vitest project `logic`) | Rules at exact ticks through `createWorld` and `stepWorld` |
| Unit | `src/kit/*.test.ts`, `src/engine/*.test.ts`, `tests/**/*.test.ts` | `bun run test` (Vitest project `unit`) | The kit, `Runtime`, saves, the test support code, the lint boundaries |
| Browser | `scenarios/*.ts`, `tests/*.spec.ts` | `bun run e2e` (builds, then Playwright) | The built game in Chromium on desktop and a phone |

Run one Vitest file with `bun run test src/logic/world.test.ts`, one project with `bun run test --project logic`, and one Playwright test with `bunx playwright test -g "same walk"` after `bun run build`.

## Logic tests

Every rule change gets a Vitest test through `createWorld` and `stepWorld`, with small inline setups and the edge cases at exact ticks ("jumps 6 ticks after leaving the ledge", "doesn't at 7"). Assert on state and emitted events.

## Scenarios

A scenario in `scenarios/<name>.ts` is a start state, an input script and expectations. It runs as a Playwright test (`tests/scenarios.spec.ts` registers every file except `kit.ts`) and on its own through `bun run see --scenario <name>`.

- Use the typed kit from `scenarios/kit.ts`: `scenario`, `hold`, `tap`, `wait`, plus shared sequences such as `WALK_TO_FIRST_ORB` and `savedGame()`. Durations are logic ticks (1/60 s), never milliseconds or frames.
- Assert on `summary`, `state` and `events`, never on pixels. Physics and trig values differ slightly between machines, so round them in `debugSummary` or use `toBeCloseTo`.
- Start states come from `start.save` (validated and migrated by the save store), `start.seed`, `start.scene` and `start.query`, never from poking state in the test.
- A scenario whose outcome depends on a default setting pins it with an explicit `start.save`, so changing the default doesn't break every such scenario at once.
- A rare moment (the last orb, a seed that seldom rolls an item) is reached through a capture stage, `start: { query: { stage: "<name>" } }`, not by hunting for a seed.
- A scenario that plays several times longer than the others sets `slow: true`; Playwright triples its timeout. Don't raise the global timeout for one test.
- A known bug is a scenario with `todo: true` and the correct expectation. It must keep failing; remove `todo` when the bug is fixed. Don't skip, focus or loosen tests to get green (Biome rejects `.skip` and `.only`).

## Smoke tests

`tests/smoke.spec.ts` covers what only a real browser shows: the renderer is `webgl2`, physics loads, progress survives a reload, a page opened without the test flag starts with no button, and the touch controls move the player. Tests tagged `@touch` in their title run only in the phone project.

The worldHash test plays a fixed input and expects `WALK_HASH`. Every project computes the same number because the hash covers logic only. When you change the rules on purpose, rerun, read the new value from the failure and update the constant in the same commit.

The `game` fixture in `tests/support/fixture.ts` fails a test after it finishes if anything went wrong without throwing: a console error, a failed request, a game error or dropped events. Fix the cause rather than filtering the problem out.

## Saves

Each save version keeps its fixture in `tests/fixtures/save-v<N>.json`, and `tests/save.test.ts` checks that every one loads with the current code. Never edit an old fixture to make it pass; write the migration.

## No sleeps

The driver waits on `ready`, `idle()`, ticks and events. A test that needs `waitForTimeout` is waiting on the wrong thing.
