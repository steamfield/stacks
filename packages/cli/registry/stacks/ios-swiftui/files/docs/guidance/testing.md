# Testing

| Layer | Framework | Where | Runs with |
| --- | --- | --- | --- |
| Unit | Swift Testing | `AppTests/` | `make test`, or `make coverage` with the floor |
| UI | XCTest (XCUITest) | `AppUITests/` | `make test-ui` |

Both run on a simulator that `scripts/sim-destination.sh` picks. Unit tests are hosted in the app (they import it with `@testable import App`), so they also launch it once.

## Coverage

`make coverage` runs the unit tests with code coverage and `scripts/coverage-check.sh` fails it when the `App` target's line coverage is below `COVERAGE_MIN` (80 by default, in the Makefile). Files matching `COVERAGE_EXCLUDE` (`*View.swift`, `*Screen.swift`, `MainApp.swift`) don't count: view bodies are covered by the UI tests. So a view lives in a `*View` or `*Screen` file, and logic it needs goes in the view model, where unit tests reach it.

## Unit tests

Swift Testing: `import Testing`, `@Test` functions in a `struct`, `#expect` for checks and `#require` for preconditions that end the test.

```swift
@Test(arguments: ["prod", "Production", "test"])
func rejectsAnUnknownEnvironment(value: String) {
    #expect(throws: AppError.invalidConfiguration(key: AppConfig.Key.environment, value: value)) {
        try AppConfig(info: [AppConfig.Key.environment: value])
    }
}
```

- **Config**: a row per default, per valid value and per invalid value of each setting.
- **Errors**: each case's retry flag, and that `userMessage` never contains the detail `logDescription` carries.
- **View models**: `@MainActor` test structs. Pass a stub service, call the method, assert on `state`. The shipped stub is an actor that returns queued results, which covers retry after failure.
- **Services**: test an implementation directly when it has logic of its own.

Swift Testing runs tests in parallel. Each test builds its own view model and stub; anything that touches shared state (UserDefaults, the file system) goes in a `@Suite(.serialized)`.

Run one suite or test:

```sh
xcodebuild -project <name>.xcodeproj -scheme App -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO \
  -destination "$(bash scripts/sim-destination.sh)" test -only-testing:AppTests/AppConfigTests
```

## UI tests

XCUITest launches the built app and drives it from outside; Swift Testing has no equivalent, so these stay on XCTest. `LaunchTests` checks that the first screen shows the greeting.

- Find elements by accessibility identifier, never by visible text that a translation would change.
- Wait with `waitForExistence(timeout:)`, never `sleep`.
- End each test on a new screen with `try app.performAccessibilityAudit()`, which fails on missing labels, text that doesn't scale with Dynamic Type, clipped text and low contrast.
- Each test launches the app, which takes seconds. Add one only for a flow unit tests can't reach: navigation between screens, system permission prompts, a launch argument the app reads.

## What a new feature adds

Config rows for any new setting, a case test for any new `AppError`, view model tests for each state transition, and a UI test only if the feature adds a flow across screens.
