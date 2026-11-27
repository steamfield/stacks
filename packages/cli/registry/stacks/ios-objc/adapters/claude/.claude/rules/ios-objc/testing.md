---
paths:
  - "AppTests/**"
  - "AppUITests/**"
---

# Testing rules

- Unit tests are XCTest in Objective-C, one `<Class>Tests.m` per class under test, hosted in the app (so `[NSBundle mainBundle]` is the app). Run them with `make test`, or one class with `make test ONLY=AppTests/<Class>`.
- Controllers are tested through their protocol: pass a stub service (`APPStubGreetingService` queues results and answers synchronously), call `loadViewIfNeeded`, then assert on `state` and on views found by accessibility identifier.
- Asynchronous code is awaited with `XCTestExpectation` and `waitForExpectations:timeout:`; never `sleep` or spin the run loop by hand.
- Config tests use a fresh `NSUserDefaults` suite and remove its domain in `tearDown`; never write to `standardUserDefaults`.
- Assert on error `domain` and `code`, not on message text, except where the test is about the user-facing mapping.
- `make coverage` fails below the Makefile's `COVERAGE_MIN`. Add tests to meet it; never lower the floor without asking the user.
- UI tests (`AppUITests`, `make test-ui`) stay a smoke check: launch, find elements by identifier with `waitForExistenceWithTimeout:`, drive alternate states with launch arguments (`-APPGreetingResource missing`), and run `performAccessibilityAuditWithAuditTypes:issueHandler:error:` on each new screen reached. Behavior belongs in unit tests.
- Simulator choice comes from `scripts/sim-destination.sh` (or `SIMULATOR_UDID`); never write a device name or iOS version into a test, the Makefile or CI.
