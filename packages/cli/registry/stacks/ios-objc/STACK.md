---
schema_version: 1
id: ios-objc
kind: stack
name: iOS app in Objective-C (UIKit)
description: A native iPhone app in Objective-C with UIKit, for teams maintaining or extending Objective-C code. Built in code on the scene lifecycle with an XcodeGen project, nullability annotations, warnings as errors, the Clang static analyzer, XCTest, XCUITest, clang-format and one Swift file called from Objective-C.
tags: [objective-c, ios, uikit, mobile, make]
deps: {}
tools: [xcodebuild, xcrun, xcodegen, clang-format, make, git]
decisions:
  - "Bundle identifier: `com.example.<project-slug>` (default), in project.yml for all three targets. Ask for the user's reverse-DNS prefix; keep the `.tests` and `.uitests` suffixes on the test targets."
  - "iOS deployment target: one major release below the newest iOS SDK in the installed Xcode (default), written to project.yml as `options.deploymentTarget.iOS`. Never below the release that added `UIButtonConfiguration`, which the screen uses."
  - "Swift language mode: the newest the installed compiler supports (default), as `SWIFT_VERSION` under project.yml's `settings.base`."
  - "Swift seam: keep `GreetingFormatter.swift` and the bridging header (default), or a pure Objective-C project, removed as `docs/guidance/objc.md` (Swift interop) lists. Removing it leaves `SWIFT_VERSION` unused; still record it."
  - "Class prefix: `APP` (default). If the user names another three-letter prefix, rename every class, file, function and constant in one change before adding features, then run `make ci`."
  - "Devices: iPhone only (default; `TARGETED_DEVICE_FAMILY: \"1\"`), or iPhone and iPad (`\"1,2\"`), which then needs the screen checked at iPad sizes and a UI test run on an iPad simulator."
env: {}
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - name: project-filled
    layer: check
    run: "! grep -n 'stacks:fill' project.yml"
  - { name: lint, layer: lint, run: make lint }
  - { name: build, layer: typecheck, timeout: 15m, run: make build }
  - { name: analyze, layer: lint, timeout: 15m, run: make analyze }
  - { name: test, layer: test, timeout: 15m, run: make test }
  - { name: test-ui, layer: test, timeout: 20m, run: make test-ui }
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Check the toolchain, generate the Xcode project and install git hooks
  project: Generate the .xcodeproj from project.yml with XcodeGen (skipped when nothing changed)
  format: Format Objective-C with clang-format and Swift with swift-format
  format-check: Fail if clang-format would change any Objective-C file
  lint: format-check, then swift-format lint in strict mode
  build: Compile the app and both test bundles for a simulator, warnings as errors
  analyze: Clang static analyzer in deep mode; fails on any finding
  test: XCTest unit tests (AppTests) on a simulator; ONLY=AppTests/<Class> runs one class
  test-ui: XCUITest smoke tests (AppUITests); launches the app on a simulator
  ci: "Everything CI runs (lint, build, analyze, test, test-ui)"
  destination: Print the simulator destination xcodebuild will use
  clean: Remove build output and the generated project
---

# iOS app in Objective-C (UIKit)

A native iPhone app in modern Objective-C: ARC, nullability and lightweight generics, UIKit views built in code, every compiler warning an error and the static analyzer as a gate. XcodeGen generates the Xcode project, and the `Makefile` is the entry point for every task. Choose this stack to maintain or extend an Objective-C codebase, or when a team needs Objective-C (C and C++ libraries through Objective-C++, an existing Objective-C module); a new app is better started with `ios-swiftui` or `ios-uikit`.

## What stacks wrote

A working slice that passes every check once project.yml's `stacks:fill` values are set. `project.yml` declares the `App`, `AppTests` and `AppUITests` targets and the `App` scheme; `Config/Shared.xcconfig` holds ARC, the warning set (`-Wall -Wextra` and the `CLANG_WARN_*` settings, warnings as errors) and the analyzer settings. In `App/`: `main.m`, `APPAppDelegate` (returns the scene configuration in code, since the Info.plist is generated) and `APPSceneDelegate`, the composition root, which loads `Config/APPConfig` (registered defaults, saved values, then launch arguments, through `NSUserDefaults`, validated), builds the service and shows the screen. `Errors/APPError` holds `APPErrorDomain`, the `APPErrorCode` enum and `APPUserMessage`, which maps each code to what the user reads; `Logging/APPLog` holds one `os_log` handle per category. The payload is `Greeting/`: the `APPGreeting` model parsed from `Resources/greeting.json`, the `APPGreetingService` protocol and `APPBundledGreetingService`, and `APPGreetingViewController` with loading, content and failed states and a retry button. `GreetingFormatter.swift` is the Swift seam: Objective-C calls it through `App-Swift.h`, and it reads `APPGreeting` through `App-Bridging-Header.h`. `AppTests/` covers config, errors, parsing, the service and the screen (through `APPStubGreetingService`); `AppUITests/APPSmokeUITests` launches the app for the content and error states. `scripts/` picks a simulator, wraps xcodebuild and fails the analyzer on findings; `docs/` has ARCHITECTURE and `guidance/objc.md`. Read the code before extending it.

## Setup

No generator; the agent runs XcodeGen through `make project`. No dependency manager either: the slice uses only Apple frameworks.

1. Check the toolchain: `xcode-select -p` points at a full Xcode (not the command line tools), and `xcodebuild -version`, `xcodegen --version`, `clang-format --version` and `xcrun swift-format --version` work. Install a missing XcodeGen or clang-format with Homebrew; xcbeautify is optional and only changes log output. `bash scripts/sim-destination.sh` must print a destination; if it finds no iPhone simulator, create one with `xcrun simctl create` from `xcrun simctl list devicetypes` and `runtimes`.
2. Fill project.yml from the decisions: `options.deploymentTarget.iOS` and `SWIFT_VERSION` under `settings.base`, then the bundle identifiers. Delete the `stacks:fill` comment (`project-filled` checks).
3. `make install`, then `make lint build analyze test test-ui`. Where the installed Xcode, clang-format or swift-format rejects shipped code (a deprecated or renamed UIKit API, a new warning, a changed format), fix the code and keep every setting in `Config/Shared.xcconfig`. A clang-format release that formats differently is fixed with `make format`, then read the diff. Where XcodeGen rejects a project.yml key, check its current spec documentation and keep the setting's effect.
4. Record in AGENTS.md the Xcode, iOS SDK, clang-format and XcodeGen versions you set up with.
5. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/objc.md` from AGENTS.md, then run `stacks verify` until it passes.

## Conventions

`docs/guidance/objc.md` holds the language rules with their reasons; the shipped code follows each one. The ones agents most often break:

- **Headers**: `NS_ASSUME_NONNULL_BEGIN`/`END` around every header, `nullable` where nil is allowed, generics on every collection, one `NS_DESIGNATED_INITIALIZER` with `init` and `new` unavailable, `readonly` public properties, `copy` for strings and blocks.
- **Errors**: return `nil`/`NO` and fill `NSError **` with `APPErrorMake`. A new failure gets a code at the end of `APPErrorCode` and a case in `+[APPUserMessage messageForError:]`. The screen shows only `APPUserMessage` text.
- **Config**: only `APPConfig` reads `NSUserDefaults`; a new setting gets a key, a default, validation and tests. Services and controllers receive values through their initializers from `APPSceneDelegate`.
- **Screens**: built in code with Auto Layout anchors or stack views, no storyboards. A screen that loads data has explicit states and talks to a service protocol whose completion runs on the main queue. Identifiers the UI tests use are constants in the controller's header.
- **Warnings**: never lower a setting in `Config/Shared.xcconfig`, never add `-Wno-` flags project-wide. One line that needs an exception gets a `#pragma clang diagnostic` push, ignored and pop, with a comment.
- **Logging**: `os_log` through `APPLog*()`; `%{public}@` only for values without user data.
- **The project**: change `project.yml` and run `make project`; never edit the `.xcodeproj`, which is gitignored.

## Testing

`AppTests` is hosted in the app, so `[NSBundle mainBundle]` is the app bundle and tests import app headers directly. Model, config and error tests are plain XCTest; `APPConfigTests` uses a throwaway `NSUserDefaults` suite. `APPBundledGreetingServiceTests` runs the real service against the app's and the test bundle's resources and waits with `XCTestExpectation`. `APPGreetingViewControllerTests` passes `APPStubGreetingService`, calls `loadViewIfNeeded` and asserts on `state` and on views found by accessibility identifier, which also exercises the Swift formatter. A new screen gets the same: a stub of its service and one test per state. Iterate on one class with `make test ONLY=AppTests/APPConfigTests`.

`AppUITests` stays a smoke check. Each test launches the app and waits for elements by identifier; alternate states come from launch arguments (`-APPGreetingResource missing` overrides the config). Put behavior in unit tests, since every UI test launches the app and adds seconds.

Every xcodebuild call disables parallel testing, so xcodebuild never clones simulators, and builds unsigned. `make test` and `make test-ui` boot the simulator `scripts/sim-destination.sh` picks; set `SIM_DESTINATION` to use a specific one.

## Commands

The shipped Makefile (`make help`) has install, project, format, format-check, lint, build, analyze, test, test-ui, ci, destination and clean. Adapt recipes, keep the names, mirror them in AGENTS.md. The full xcodebuild log of each step is in `build/logs/<step>.log`.
<!-- stacks:when with=agent-ops -->

The Claude Code adapter adds `protect-xcodeproj.sh` (denies edits inside `*.xcodeproj` and `*.xcworkspace`) and `lint-objc.sh` (compiles the written `.h` or `.m` with the project's warning flags and reports clang-format drift), plus path-scoped rules under `.claude/rules/ios-objc/`. List both hooks in `.claude/README.md`, and add their cases to `.claude/hooks/smoke.sh`:

```sh
denies "an edit inside the generated project" '{"tool_input":{"file_path":"App.xcodeproj/project.pbxproj"}}' $h/protect-xcodeproj.sh
allows "an edit to the XcodeGen spec" '{"tool_input":{"file_path":"project.yml"}}' $h/protect-xcodeproj.sh
```
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->

**CI.** iOS jobs need a macOS runner (`macos-latest`, or the newest Xcode image GitHub lists), which costs more than Linux minutes. Select Xcode with `xcode-select` or a setup action, install XcodeGen and clang-format with Homebrew, then `make install` and `make ci`. `scripts/sim-destination.sh` picks the runner's simulator, so pass no device name. A Linux job can run only what needs no Xcode, which here is `make format-check`. Upload `build/logs/` and the `.xcresult` bundles under `build/DerivedData/Logs/Test/` when a job fails.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make install` runs `lefthook install` outside CI once `lefthook.yml` exists. pre-commit runs `clang-format -i` on staged `.h` and `.m` files and `xcrun swift-format format --in-place` on staged `.swift` files, restaging both; pre-push runs `make lint build test`. Leave `test-ui` and `analyze` to `stacks verify` and CI; they take minutes.
<!-- stacks:end -->

## Gotchas

- `xcodebuild analyze` prints "Analyze Succeeded" even with findings, and skips unchanged files on a rerun. `scripts/analyze.sh` reads Xcode's per-file result plists instead, so a finding fails until the file is fixed. `make clean` clears stale results for deleted files.
- Unit tests import app headers by name (`#import "APPConfig.h"`) through Xcode's header map; `App-Swift.h` is generated for the `App` target only, so test files reach Swift code through the Objective-C class that uses it.
- `#import "App-Swift.h"` belongs in `.m` files. In a header it creates a cycle when the Swift code also imports that header through the bridging header.
- A new source file needs `make project` before Xcode or xcodebuild sees it; every Makefile build target runs it first.
- The scene manifest is generated (`INFOPLIST_KEY_UIApplicationSceneManifest_Generation`), so the scene delegate class is set in `-application:configurationForConnectingSceneSession:options:`, not in an Info.plist.
- Several agents or projects on one machine can share a booted simulator. When runs collide (an "Application failed preflight checks" or a busy-device error), create a simulator for this project and set `SIM_DESTINATION`.
- Old Objective-C examples online use manual retain and release, `NSLog`, `@synthesize` and nib-based view controllers; ARC, `os_log`, auto-synthesis and code-built views replace all four.
