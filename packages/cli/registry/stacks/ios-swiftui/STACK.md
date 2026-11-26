---
schema_version: 1
id: ios-swiftui
kind: stack
name: iOS app (SwiftUI)
description: A native iPhone app in Swift with SwiftUI, Observation view models and Swift 6 strict concurrency. XcodeGen generates the Xcode project; Swift Testing unit tests and an XCUITest launch test run on a simulator, with SwiftLint and swift-format.
tags: [swift, ios, mobile, make]
tools: [xcodebuild, xcrun, xcodegen, swiftlint, make, git]
decisions:
  - "iOS deployment target: one major below the installed Xcode's newest iOS SDK (default), never below the first release with the Observation framework. It goes in project.yml's `options.deploymentTarget.iOS` as `major.0`."
  - "Bundle identifier: `com.example.<project-slug>` (default) in project.yml, with `.tests` and `.uitests` for the test targets. Use the user's reverse domain when they give one."
  - "Devices: iPhone only (default, `TARGETED_DEVICE_FAMILY` 1). iPhone and iPad sets it to `\"1,2\"` and adds the iPad orientations."
  - "Target and module name: `App` (default), fixed so the shipped `@testable import App` lines need no rename. To rename, change the three targets and the scheme in project.yml, `SCHEME` in the Makefile, every `@testable import App`, and the folder names, in one change, then `make project typecheck`."
  - "Actor isolation: explicit (default): views and view models are `@MainActor`, everything else is `Sendable` and nonisolated. Turning on `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` is the user's call, for every target at once."
  - "Coverage floor: 80% (default), `COVERAGE_MIN` in the Makefile, over the `App` target's lines outside `COVERAGE_EXCLUDE`."
env: {}
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: project, phase: setup, layer: install, run: make project }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: lint, layer: lint, run: make lint }
  - { name: typecheck, layer: typecheck, run: make typecheck, timeout: 15m }
  - { name: test, layer: test, run: make coverage, timeout: 15m }
  - { name: test-ui, layer: test, run: make test-ui, timeout: 15m }
  - { name: build, layer: build, run: make build, timeout: 15m }
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  doctor: Check the toolchain and that project.yml has a deployment target
  project: Generate the Xcode project from project.yml with XcodeGen, and install the git hooks outside CI when lefthook.yml exists
  typecheck: Compile the app and both test targets for a simulator, warnings as errors
  build: Release build for the simulator, warnings as errors
  lint: SwiftLint in strict mode
  fmt: Format Swift sources with swift-format
  fmt-check: Fail if swift-format would change any Swift source
  test: Unit tests (Swift Testing) on a simulator
  coverage: Unit tests with line coverage, failing below COVERAGE_MIN
  test-ui: UI tests (XCUITest) on a simulator, ending in an accessibility audit
  ci: "Everything CI runs: fmt-check, lint, typecheck, coverage, test-ui, build"
  clean: Remove build output and the generated project
---

# iOS app (SwiftUI)

A native iPhone app: SwiftUI views over `@Observable` view models, services behind protocols, Swift 6 language mode with complete concurrency checking and approachable concurrency, and warnings as errors. `project.yml` defines the Xcode project and XcodeGen generates it; the `Makefile` runs every task.

## What stacks wrote

A working slice that passes every check once Setup fills the deployment target. `project.yml` declares three targets: `App`, `AppTests` (Swift Testing, hosted in the app) and `AppUITests` (XCUITest), plus the `App` scheme. `App/Sources/MainApp.swift` is the entry point; `Launch.start` there is the composition root. `Config/AppConfig.swift` reads typed settings from `App/Info.plist`, which project.yml's build settings fill per configuration, with validated defaults. `Support/` holds `AppError` (each case's user message, retry flag and log text), `ErrorView` and `Log` (one `os.Logger` per area). `Greeting/` is the payload: `GreetingService` (a protocol with `LocalGreetingService`, no network), `GreetingViewModel` and `GreetingScreen` with its loading, loaded and error states. Tests sit in `AppTests/` and `AppUITests/LaunchTests.swift`, which ends in an accessibility audit. `scripts/sim-destination.sh` picks a simulator at run time, and `scripts/coverage-check.sh` holds `make coverage` to the floor. `.swiftlint.yml`, `.swift-format` and `docs/` (ARCHITECTURE, DEVELOPMENT, `guidance/`) complete it. Read the code before extending it.

## Layout

A feature gets a folder under `App/Sources/` like `Greeting/`: its service protocol and implementations, its view model, its screens. Shared types go in `Support/`, settings in `Config/`. Tests mirror the folder in `AppTests/`. XcodeGen picks up new files by folder, so adding a file needs only `make project`, never a project edit. When logic grows big enough to test without a simulator, move it into a local Swift package and add a `swift test` target and verify step for it.

## Setup

No generator: the project file comes from `project.yml`.

1. **Toolchain.** `xcodebuild -version`, `xcrun --show-sdk-version --sdk iphonesimulator`, `xcrun swift --version`, `xcodegen --version`, `swiftlint version`, `xcrun swift-format --version`. Install a missing tool with Homebrew (`brew install xcodegen swiftlint xcbeautify`); swift-format comes with Xcode. Write the deployment target decision into project.yml's `options.deploymentTarget.iOS`.
2. `make project`, then `make fmt-check lint typecheck coverage test-ui build`. Where the installed Xcode rejects shipped code or a setting (a deprecated API, a new concurrency diagnostic, a renamed lint rule), fix the code; keep Swift 6 mode, complete checking, approachable concurrency, member import visibility, warnings as errors, the coverage floor and every enabled lint rule. `make fmt` after editing Swift.
3. Record the Xcode, iOS SDK, Swift, XcodeGen, SwiftLint and deployment target versions in the README's toolchain section and in AGENTS.md.
4. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/` from AGENTS.md, then run `stacks verify` until it passes.

## Conventions

The shipped code follows each of these; `docs/guidance/` has the reasons.

- **Project file**: change targets, settings and schemes in `project.yml`, then `make project`. Never edit or commit `*.xcodeproj`; a Claude Code hook denies edits inside it.
- **Concurrency**: no `@unchecked Sendable`, `nonisolated(unsafe)` or `@preconcurrency import` to silence a diagnostic; fix the isolation. View models are `@MainActor @Observable final class`; services are `Sendable` protocols with `async throws(AppError)` methods.
- **State**: views read view model state and call its methods; they hold no business logic. A view that owns a view model holds it in `@State`; one that receives it takes a plain `let`.
- **Views** live in `*View` or `*Screen` files. XCUITest covers them, so the coverage floor leaves them out (`COVERAGE_EXCLUDE`); logic in a view file escapes the floor.
- **Errors**: services throw `AppError`. The screen shows `userMessage` only; keys, values and reasons go to the log through `logDescription`. A new failure is a new case with all three properties and a test.
- **Config**: a new setting is a build setting in project.yml, a `$(SETTING)` entry in `App/Info.plist`, a key and default in `AppConfig`, validation if it can be wrong, and a test row. No secret goes in Info.plist, a build setting or source: anything compiled into the bundle can be extracted, so runtime secrets come from the app's backend.
- **Logging**: `Log.<area>` loggers, never `print`. Interpolated values are private by default; mark only non-sensitive values `privacy: .public`.
- **Accessibility**: identifiers on every element a UI test finds (`greeting.message`), system text styles, and primary-color text, so the audit passes.

## Testing

Unit tests use Swift Testing (`import Testing`, `@Test`, `#expect`), parameterized with `arguments:` where cases differ only by data. View model tests are `@MainActor` and pass a stub service (an actor conforming to the protocol). A new feature adds config rows, error cases and view model tests here. Verify runs them through `make coverage`, which fails when the `App` target's lines outside views fall below 80%. `AppUITests/LaunchTests.swift` is the only XCUITest: it launches the app, finds the greeting by identifier, then runs `performAccessibilityAudit()` (labels, Dynamic Type, clipped text, contrast). Add UI tests only for flows unit tests can't reach, each ending in the audit; each costs a simulator launch. Run one test with `xcodebuild ... test -only-testing:AppTests/AppConfigTests` using the Makefile's flags.

## Commands

The shipped Makefile (`make help`) has doctor, project, typecheck, build, lint, fmt, fmt-check, test, coverage, test-ui, ci, clean. xcodebuild output goes through `xcbeautify` when it's installed. `SIMULATOR_UDID=<udid> make test` picks a simulator; otherwise `scripts/sim-destination.sh` takes a booted iPhone, then any available iPhone on the newest runtime. Mirror the targets in AGENTS.md.
<!-- stacks:when with=ci-github -->

**CI.** iOS jobs need a macOS runner, so the runner decision's default here is `macos-latest` (or the image with the Xcode version you recorded); select Xcode with `sudo xcode-select -s` when the image has several. The `CI` variable makes `make project` skip `lefthook install`. Install XcodeGen, SwiftLint and xcbeautify with Homebrew, then call `make project` and `make ci`. A Linux job can't run xcodebuild or the simulator; it could run SwiftLint alone, which isn't worth a second job. macOS minutes cost more, so set `timeout-minutes` and cancel superseded runs.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make project` runs `lefthook install` outside CI once `lefthook.yml` exists, so don't add another install line. pre-commit runs `xcrun swift-format format --in-place` on staged `*.swift` with `stage_fixed: true`, then `swiftlint lint --strict` on the same files; pre-push runs `make test`. Builds and UI tests stay out of hooks.
<!-- stacks:end -->

## Claude Code

The Claude adapter adds `.claude/rules/ios-swiftui/` (concurrency, SwiftUI, testing, project files), `.claude/hooks/protect-xcodeproj.sh` (PreToolUse `Edit|Write`: denies writes inside `*.xcodeproj` and `*.xcworkspace`, pointing at project.yml) and `.claude/hooks/swiftlint-on-write.sh` (PostToolUse `Edit|Write`: SwiftLint on the written Swift file, findings back as context), plus allow rules for the make targets and read-only Xcode commands. List both hooks in `.claude/README.md`. Add to `.claude/hooks/smoke.sh`, before the config checks:

```sh
denies "a project file edit" '{"tool_input":{"file_path":"app.xcodeproj/project.pbxproj","content":"x"}}' $h/protect-xcodeproj.sh
allows "a project.yml edit" '{"tool_input":{"file_path":"project.yml","content":"x"}}' $h/protect-xcodeproj.sh
```

XcodeBuildMCP is an optional MCP server that lets an agent build, run and screenshot the simulator; `docs/DEVELOPMENT.md` says how to add it. Don't commit a `.mcp.json` for it.

## Gotchas

- An undefined build setting expands to an empty string in Info.plist, so `AppConfig` treats empty as unset. A misspelled setting name in project.yml or Info.plist therefore takes the default without any test failing; check the `launch environment=` log line after adding a setting.
- `make typecheck` and `make test` share `build/DerivedData`, so `test` reuses the typecheck build. Delete `build/` when Xcode reports stale module errors after a project.yml change.
- The first test run on a simulator boots it, which can take a minute or more. Two runs on one simulator at once interfere; give each terminal or agent its own with `SIMULATOR_UDID` (`docs/DEVELOPMENT.md`).
- Swift Testing runs tests in parallel by default. Tests that share state (UserDefaults, files) need `@Suite(.serialized)` or separate instances.
- agent-ops' Stop formatter has no Swift formatter: run `make fmt` before `make fmt-check`.
- macOS ships GNU Make 3.81, which ignores `.SHELLFLAGS`. Piped xcodebuild recipes start with `$(STRICT)`; a new one without it passes when the build fails.
- `#Preview` blocks compile with the app, so a preview that no longer builds fails `make typecheck`.
