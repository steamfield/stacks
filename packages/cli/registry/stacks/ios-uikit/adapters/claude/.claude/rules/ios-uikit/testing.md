---
paths:
  - "AppTests/**"
  - "AppUITests/**"
---

# Tests

- Unit tests (`AppTests`, `make test`) cover view models, the coordinator, config and error mapping. A view model test passes a test double from `AppTests/Support/` and asserts on `state` and the callbacks; it never sleeps.
- UI tests (`AppUITests`, `make test-ui`) are smoke tests of whole journeys. Find elements by accessibility identifier and wait with `waitForExistence(timeout:)`. Drive alternate states through `launchEnvironment` keys `AppConfig` already reads, never a test-only code path in the app.
- Never delete or skip a failing test to get green; fix the code or ask.
- Run tests through the make targets, which pick a simulator with `scripts/sim-destination.sh`. Never hard-code a device name or OS version.

Reasons and examples: [docs/guidance/swift.md](../../../docs/guidance/swift.md), "Testing".
