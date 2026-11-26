---
paths:
  - "AppTests/**"
  - "AppUITests/**"
---

# Tests

- Unit tests (`AppTests`, `make test`) use Swift Testing: `@Test`, `#expect`, `#require`, `arguments:` with `Sendable` values. No new XCTest unit tests. They cover view models, screens, the coordinator, config and error mapping. A view model or screen test passes a test double from `AppTests/Support/` and asserts on `state`, callbacks or the rendered `AccessibilityID`; it never sleeps.
- `make coverage` fails below the Makefile's `COVERAGE_MIN`. Add tests to meet it; never lower the floor without asking the user.
- UI tests (`AppUITests`, `make test-ui`) stay on XCTest and are smoke tests of whole journeys. Find elements by accessibility identifier, wait with `waitForExistence(timeout:)`, and run `performAccessibilityAudit()` on each screen reached. Drive alternate states through `launchEnvironment` keys `AppConfig` already reads, never a test-only code path in the app.
- Never delete or skip a failing test to get green; fix the code or ask.
- Run tests through the make targets, which pick a simulator with `scripts/sim-destination.sh`. Never hard-code a device name or OS version.

Reasons and examples: [docs/guidance/swift.md](../../../docs/guidance/swift.md), "Testing".
