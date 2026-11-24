---
paths:
  - "scenarios/**"
  - "tests/**"
  - "src/**/*.test.ts"
---

# Scenarios and tests

- Scenarios use the typed kit in `scenarios/kit.ts` (`scenario`, `hold`, `tap`, `wait`). Durations are logic ticks (1/60 s), never milliseconds or rendered frames.
- Assert on `summary`, `state` and `events`. Never on pixels, and never on exact floats from physics: round in `debugSummary` or use `toBeCloseTo`.
- Start states come from `start.save` fixtures, `start.scene`, `start.seed` and `start.query`, not from poking state from the test. A scenario that depends on a default setting pins it in `start.save`.
- A rare moment comes from a capture stage (`start: { query: { stage: "<name>" } }`), not a hunted seed.
- No sleeps or timeouts. The driver waits on `ready`, `idle()`, ticks and events.
- A long scenario sets `slow: true`; don't raise the global timeout for one test.
- A known bug is a scenario with `todo: true` and the correct expectation. Don't skip, focus or loosen tests to get green.
- Touch-only smoke tests carry `@touch` in the title so they run in the phone projects.
- Each save version keeps its fixture in `tests/fixtures/`, and `tests/save.test.ts` must keep passing.
- `WALL_JUMP_HASH` in `tests/smoke.spec.ts` changes only with a deliberate level or physics change, and only once every browser project agrees.

Detail: [testing guidance](../../../docs/guidance/phaser-game/testing.md).
