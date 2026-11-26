---
paths:
  - "AppTests/**/*.swift"
  - "AppUITests/**/*.swift"
---

- Unit tests use Swift Testing: `import Testing`, `@Test`, `#expect`, `#require`. No new XCTest unit tests.
- Cases that differ only by data are one `@Test(arguments:)`.
- View model tests are `@MainActor` and pass a stub service (an actor conforming to the protocol). No network, no sleeps.
- Tests run in parallel; anything sharing state (UserDefaults, files) gets `@Suite(.serialized)` or its own instance.
- UI tests stay on XCTest (XCUITest), find elements by accessibility identifier, wait with `waitForExistence(timeout:)`, and cover only flows unit tests can't reach. A test on a new screen ends with `try app.performAccessibilityAudit()`.
- Run `make test` for unit tests, `make coverage` for them with the floor, and `make test-ui` for UI tests; never weaken an assertion or lower `COVERAGE_MIN` to get green.

Reasons and examples: [docs/guidance/testing.md](../../../docs/guidance/testing.md).
