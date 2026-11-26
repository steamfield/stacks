---
paths:
  - "test/**"
  - "integration_test/**"
---

- Test through fakes in `lib/data/services/` and real repositories and view models; don't mock repositories or add a mocking package for what a fake covers.
- Widget tests pump the screen inside `MaterialApp` and assert on what the user sees. `pumpAndSettle` never returns while a spinner is on screen: check loading with `pump()`, then settle.
- A test that touches global state (logging, `FlutterError.onError`) restores it; flutter_test fails a test that leaves `FlutterError.onError` changed.
- A new screen gets view model tests for each transition, widget tests for loading, content and error, and one main-path case in `integration_test/`.
- Run one file with `flutter test <path>`; `make test-ios` builds for the simulator and takes minutes, so run it once the unit and widget tests pass.

Reasons and examples: [docs/guidance/flutter.md](../../../docs/guidance/flutter.md), "Testing".
