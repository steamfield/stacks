---
paths:
  - "scenarios/**"
  - "tests/**"
  - "src/**/*.test.ts"
---

# Scenarios and tests

Read [testing](../../../docs/guidance/threejs-game/testing.md) before writing or changing tests.

- Scenarios use the typed kit in `scenarios/kit.ts` (`scenario`, `hold`, `tap`, `wait`). Durations are logic ticks (1/60 s), never milliseconds or frames.
- Assert on `summary`, `state` and `events`. Never on pixels, and never on exact floats from physics or trig: round in `debugSummary` or use `toBeCloseTo`.
- Start states come from `start.save`, `start.seed`, `start.scene` and `start.query`. A rare moment uses a capture stage (`start: { query: { stage: "<name>" } }`), not a hunted seed.
- No sleeps or timeouts; the driver waits on `ready`, `idle()`, ticks and events.
- A known bug is a scenario with `todo: true` and the correct expectation. Don't skip, focus or loosen tests to get green.
- Touch-only smoke tests carry `@touch` in the title.
- Each save version keeps its fixture in `tests/fixtures/`. Never edit an old fixture to make it pass.
- A deliberate rules change that moves `WALK_HASH` in `tests/smoke.spec.ts` updates it in the same commit, with the reason.
