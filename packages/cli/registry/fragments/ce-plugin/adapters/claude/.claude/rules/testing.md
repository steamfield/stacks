---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/*_test.*"
  - "**/test_*.py"
  - "**/tests/**"
  - "**/test/**"
  - "**/__tests__/**"
  - "**/e2e/**"
---

# Testing

Load the `ce:writing-tests` skill before writing or rewriting tests, and when a test passes alone but fails in the suite or fails intermittently (instead of adding retries or sleeps).

The project's test layers, runners, and harness files are in the Testing section of `AGENTS.md`; the commands are in its Commands table. Build on the existing harness rather than around it.

- Test behavior through the public surface, against real dependencies where practical. Fake only third-party network calls.
- Wait on conditions, never on fixed sleeps.
- A failing test is information. Don't weaken, skip, or delete it to get green without saying so.

| Symptom | Likely cause |
| --- | --- |
| Passes alone, fails in the suite | Shared state between tests |
| Fails at random | Timing or ordering dependence |
| Passes locally, fails in CI | Environment difference (env vars, ports, time zone, file order) |
