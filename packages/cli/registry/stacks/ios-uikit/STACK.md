---
schema_version: 1
id: ios-uikit
kind: stack
name: iOS app (UIKit)
description: A native iPhone app in Swift with UIKit built in code, for teams with UIKit codebases or screens SwiftUI handles poorly. Scene lifecycle, a navigation coordinator, MVVM under strict concurrency, a diffable list, XcodeGen, SwiftLint, swift-format, Swift Testing with a coverage floor, and XCUITest.
tags: [swift, ios, uikit, mobile, make]
tools: [xcodebuild, xcrun, xcodegen, swiftlint, make, git]
decisions:
  - "Bundle identifier: `com.example.<project-slug>` (default), in project.yml for all three targets; use the user's reverse-DNS prefix when they give one. Keep the `.tests` and `.uitests` suffixes on the test targets."
  - "iOS deployment target: the major iOS release before the one the installed Xcode's newest SDK targets, that is, the previous year's release (default), written to project.yml's `deploymentTarget`. Never below the release that added `UIContentUnavailableConfiguration`, which the list screen uses."
  - "Swift language mode: the newest the installed compiler supports (default), as project.yml's `SWIFT_VERSION`. Never a mode where data races are warnings rather than errors."
  - "Devices: iPhone only (default; `TARGETED_DEVICE_FAMILY: \"1\"`), or iPhone and iPad (`\"1,2\"`), which then needs every screen checked at iPad sizes and a UI test run on an iPad simulator."
  - "Target and module names: `App`, `AppTests`, `AppUITests` (default), fixed so `@testable import App`, the Makefile and Info.plist's `$(PRODUCT_MODULE_NAME).SceneDelegate` work unchanged. The home screen shows `APP_DISPLAY_NAME`. To rename the module, change the folders, the targets in project.yml, every `@testable import`, and the Makefile's `SCHEME` and `-only-testing` values in one change, then run `make test test-ui`."
env: {}
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: lint, layer: lint, run: make lint }
  - { name: build, layer: typecheck, timeout: 15m, run: make build }
  - { name: coverage, layer: test, timeout: 15m, run: make coverage }
  - { name: test-ui, layer: test, timeout: 20m, run: make test-ui }
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  help: List the targets
  env: Check the toolchain and that project.yml has no unfilled values
  install: Check the toolchain, generate the Xcode project and install the git hooks
  project: Regenerate the .xcodeproj from project.yml when the spec or file list changed
  build: Build the app and both test bundles for a simulator, warnings as errors
  lint: SwiftLint with --strict
  fmt: Format Swift sources with swift-format
  fmt-check: Fail on any swift-format difference or lint finding
  test: Unit tests (AppTests) on a simulator
  coverage: Unit tests with line coverage; fails below the Makefile's COVERAGE_MIN
  test-ui: UI smoke tests and accessibility audits (AppUITests); launches the app on a simulator
  ci: "Everything CI runs (fmt-check, lint, build, coverage, test-ui)"
  clean: Remove build output and the generated project
---

# iOS app (UIKit)

A native iPhone app in Swift: UIKit views built in code, a coordinator that owns navigation, and MVVM screens checked by the compiler for data races. XcodeGen generates the Xcode project, and the `Makefile` is the entry point for every task. Choose this over a SwiftUI stack when the team already maintains UIKit code or needs what UIKit does better: custom collection layouts, TextKit editing, view controller containment and exact control of navigation transitions.

## What stacks wrote

A working slice that passes every check once project.yml's two `stacks:fill` values are set. `project.yml` declares the `App`, `AppTests` and `AppUITests` targets and the `App` scheme, with complete concurrency checking and warnings as errors. In `App/`: `AppDelegate` (`@main`) and `SceneDelegate`, which loads `Config/AppConfig` (defaults, then Info.plist's `AppConfig` dictionary, then `APP_*` environment variables, all validated), builds the service and starts `Navigation/AppCoordinator`. `Errors/AppError` maps every failure to a `UserMessage`; `Logging/Log` holds one `os.Logger` per category. The payload is `Items/`: `ItemService` and `BundledItemService`, which decodes `Resources/items.json`; `ItemListViewModel` (`@MainActor`, loading, loaded, empty and failed states); `ItemListViewController` (a diffable compositional list, `contentUnavailableConfiguration` for the other states); and `ItemDetailViewController`, which the coordinator pushes. The launch screen is Info.plist's `UILaunchScreen` key. `AppTests/` (Swift Testing) covers the view model, both screens, the coordinator, config, errors and the service; `AppUITests/SmokeUITests` (XCUITest) launches the app for the list-to-detail journey with accessibility audits, and for the error state. `scripts/sim-destination.sh` picks a simulator and `scripts/coverage.sh` checks the coverage floor. `.swiftlint.yml` holds the code rules, `.swift-format` the layout, and `docs/` has ARCHITECTURE, configuration and `guidance/swift.md`. Read the code before extending it.

## Setup

No generator; the agent runs XcodeGen through `make project`.

1. Check the toolchain: `xcode-select -p` points at a full Xcode (not the command line tools), and `xcodebuild -version`, `xcodegen --version` and `swiftlint version` work. Install a missing XcodeGen or SwiftLint with Homebrew; xcbeautify is optional and only changes log output. `bash scripts/sim-destination.sh` must print a destination; if it finds no iPhone simulator, create one with `xcrun simctl create` from `xcrun simctl list devicetypes` and `runtimes`.
2. Fill project.yml's `stacks:fill` values from the decisions: `deploymentTarget.iOS` and `SWIFT_VERSION`. Set the bundle identifier. Delete the `stacks:fill` comment lines.
3. `make install`, then `make fmt-check lint build coverage test-ui`. Where the installed Xcode, SwiftLint or swift-format rejects shipped code (a deprecated API, a new lint rule, a changed format, a new accessibility audit finding), fix the code and keep every rule, `SWIFT_STRICT_CONCURRENCY: complete`, both warnings-as-errors settings and `COVERAGE_MIN`. Where XcodeGen rejects a project.yml key, check its current spec documentation and keep the setting's effect.
4. Record the Xcode, Swift and deployment target versions in the README's Requirements line and in AGENTS.md.
5. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/swift.md` from AGENTS.md, then run `stacks verify` until it passes.

## Conventions

`docs/guidance/swift.md` holds the rules with their reasons; the shipped code follows each one.

- **Generated project.** project.yml is the source of truth. The `.xcodeproj` is gitignored and never edited, in Xcode's settings editor or as text. Every build and test target runs `make project` first.
- **Concurrency.** View controllers and view models are `@MainActor`; services are `Sendable` structs or actors with `@concurrent` `throws(AppError)` methods, so their work stays off the main actor whatever the concurrency build settings. No `DispatchQueue.main`, `@unchecked Sendable` or `nonisolated(unsafe)`.
- **Navigation.** Only `AppCoordinator` pushes or presents. A view model reports intent through a callback the coordinator sets.
- **Screens.** Built in code with Auto Layout anchors and Dynamic Type; no storyboards or nibs (SwiftLint denies loading them). View models import Foundation only.
- **Errors.** Users see `AppError.userMessage`, never `localizedDescription`. A new failure is a new case with its message and a test.
- **Config.** Only `SceneDelegate` reads Info.plist and the environment. A new setting follows `docs/configuration.md`. The app holds no secrets and ships no `.env.example`: anything in the app bundle is readable by whoever downloads it, so an API key belongs on a server the app calls.
- **Logging.** `Log.<category>`; no `print` or `NSLog` (SwiftLint denies both). Interpolations stay private unless the value holds no user data.

## Testing

Unit tests use Swift Testing (`@Test`, `#expect`, `#require`, `arguments:` for cases that differ only by data); test arguments must be `Sendable`. `make test` runs `AppTests`, hosted in the app: view model and screen suites are `@MainActor`, drive `load()` and `select(itemID:)` against the test doubles in `AppTests/Support/` and assert on `state`, the callbacks and the rendered state's `AccessibilityID`; coordinator tests check the navigation stack after each action; config tests cover precedence and every rejection. A new screen adds a test per state and a coordinator test for how it's reached. `make coverage` runs the same tests with coverage and fails when the `App` target's line coverage drops below `COVERAGE_MIN` (80 by default) in the Makefile; meet it with tests, never by lowering it. `make test-ui` runs `AppUITests` on XCTest, since Swift Testing has no UI automation: one test per journey, finding elements by the `AccessibilityID` enums, reaching error states through `launchEnvironment`, and calling `performAccessibilityAudit()` on each new screen. All targets use `scripts/sim-destination.sh`: set `SIM_UDID` or `SIM_DESTINATION` to choose a simulator. Run one suite or test with `make test ONLY='AppTests/<Suite>/<test>()'`.

## Commands

The shipped Makefile (`make help`) has env, install, project, build, lint, fmt, fmt-check, test, coverage, test-ui, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md.
<!-- stacks:when with=agent-ops -->

**Agent hooks.** The stack's Claude adapter adds two hooks on agent-ops' `_lib.sh`, and its settings allow the make targets and read-only Xcode commands. `protect-xcodeproj.sh` denies Edit, Write and shell writes (in-place `sed`/`perl`, redirection, `tee`, PlistBuddy, `plutil -replace`) inside `*.xcodeproj`, `*.xcworkspace` or a `.pbxproj`. `lint-swift.sh` runs SwiftLint and swift-format on each Swift file written and returns findings as context; agent-ops' `lint-on-write.sh` skips Swift. List both in `.claude/README.md`, and add their cases to `.claude/hooks/smoke.sh` before its `parses` function:

```sh
if [ -f $h/protect-xcodeproj.sh ]; then
  denies "a pbxproj edit" '{"tool_input":{"file_path":"App.xcodeproj/project.pbxproj"}}' $h/protect-xcodeproj.sh
  allows "a project.yml edit" '{"tool_input":{"file_path":"project.yml"}}' $h/protect-xcodeproj.sh
fi
if [ -f $h/lint-swift.sh ]; then
  allows "a non-Swift file" '{"tool_input":{"file_path":"project.yml"}}' $h/lint-swift.sh
fi
```

The path-scoped rules in `.claude/rules/ios-uikit/` (concurrency, UI layer, tests) restate the must-keep parts of `docs/guidance/swift.md`. XcodeBuildMCP is optional (the guidance doc names it); don't add a `.mcp.json`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->

**CI.** One job on a macOS runner (`macos-latest`, or the image whose Xcode matches the version AGENTS.md records), because building and testing need Xcode and a simulator; the runners decision's `ubuntu-latest` default can't build this app. Select that Xcode with `xcode-select` from the image's documented path, `brew install xcodegen swiftlint xcbeautify`, then `make install ci` with `timeout-minutes` around 45; `make ci` runs `coverage` in place of `test`, which answers the coverage decision. Don't name a simulator in the workflow; `scripts/sim-destination.sh` finds one on the image. A Linux job could run only SwiftLint, so keep everything in the macOS job. macOS minutes cost more than Linux ones; note that under Deferred if the user wants UI tests on pull requests only.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make install` runs `lefthook install` outside CI once `lefthook.yml` exists, so don't add another install line. pre-commit, glob `*.swift`: `xcrun swift-format format --in-place {staged_files}` with `stage_fixed: true`, then `swiftlint lint --strict --quiet {staged_files}`. pre-push runs `make lint test`; `make test-ui` stays out of hooks because it launches a simulator.
<!-- stacks:end -->
<!-- stacks:when with=rr -->

**rr.** Every task needs Xcode, so rr hosts must be Macs with Xcode, XcodeGen and SwiftLint (`require:` them). Wrap `make test`, `make coverage`, `make test-ui` and `make ci`; pass `SIM_UDID` only when a host needs a specific simulator.
<!-- stacks:end -->

## Gotchas

- XcodeGen lists files when it generates, so a new Swift file is invisible to Xcode until `make project` runs ("cannot find type in scope"). The make targets regenerate first; after adding files while working in Xcode, run `make project` and reopen.
- Xcode's "Update to recommended settings" prompt and its target editor change the generated project, and the next `make project` discards those edits. Put the setting in project.yml instead.
- Info.plist names the scene delegate as `$(PRODUCT_MODULE_NAME).SceneDelegate`. If the module or class is renamed without it, the app launches to a black screen with no error.
- Unit tests are hosted in the app, so `SceneDelegate` runs during `make test` with the real config. Keep launch free of network calls and other side effects a test run shouldn't trigger.
- `UIContentUnavailableConfiguration` covers the collection view; set it to `nil` when there's content, or it hides the list.
- Without xcbeautify the targets pass `-quiet`, which prints nothing until a failure. A first run that boots a simulator can sit silent for minutes.
- `xcodebuild` reports "Unable to find a destination matching the provided destination specifier" when the chosen simulator's runtime isn't installed for this Xcode. Run `bash scripts/sim-destination.sh` and check `xcrun simctl list runtimes`.
- Simulator builds pass `CODE_SIGNING_ALLOWED=NO`. A device build or an archive needs a development team and signing set in project.yml; nothing in verify does either.
