---
schema_version: 1
id: flutter
kind: stack
name: Flutter app (iOS and Android)
description: A Flutter app in Dart for iOS and Android, built the way Flutter's architecture guide lays out (ChangeNotifier view models, repositories over services), with go_router navigation, strict flutter_lints analysis, unit and widget tests, and an integration test on the iOS simulator.
tags: [dart, flutter, mobile, ios, android, make]
tools: [flutter, dart, make, git, xcrun]
decisions:
  - "Organization for the iOS bundle id and the Android application id, in reverse-domain form: ask the user (default `com.example`, recorded in AGENTS.md under Pending user actions, since the App Store and Google Play reject it)."
  - "Dart package name: `app` (default), fixed so the shipped `package:app/` imports need no rename. To rename it, change `name:` in pubspec.yaml and every `package:app/` import in test/ and integration_test/ in one change, then run `make analyze test`."
  - "State management: ChangeNotifier view models read through ListenableBuilder, both in the Flutter SDK (default). Use provider or Riverpod only when the user asks; keep one view model per screen and the repository layer either way."
  - "Coverage floor: 80% (default), `COVERAGE_MIN` in the Makefile, over the lines of `lib/` under unit and widget tests."
  - "Platforms: iOS and Android (default). Add web or desktop only when the user asks, by generating that platform folder the same way as Setup step 1 and adding a build target."
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: analyze, layer: typecheck, run: make analyze }
  - { name: test, layer: test, run: make coverage }
  - { name: build-ios, layer: build, run: make build-ios, timeout: 20m }
  - { name: test-ios, layer: test, run: make test-ios, timeout: 20m }
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Check ios/ and android/ exist, then flutter pub get
  fmt: Format Dart sources
  fmt-check: Fail if dart format would change any file
  analyze: flutter analyze with analysis_options.yaml; infos fail too
  test: Unit and widget tests, no device
  coverage: Unit and widget tests with lcov output in coverage/, failing below COVERAGE_MIN
  simulator: Print the iPhone simulator the iOS targets use, booting it if needed
  test-ios: Integration tests on an iPhone simulator
  build-ios: Unsigned debug build for the iOS simulator
  build-android: Debug APK (needs the Android SDK)
  ci: "Everything verify runs on a Mac (fmt-check, analyze, coverage, build-ios, test-ios)"
  clean: Remove build output
---

# Flutter app (iOS and Android)

One Dart codebase for iPhone and Android phones. Views and `ChangeNotifier` view models sit over repositories and services, as Flutter's architecture guide lays out, and the `Makefile` is the entry point for every task. Verify runs on a Mac with Xcode and proves the iOS build; Android builds from the same code with `make build-android`.

## What stacks wrote

A working slice that passes every check once Setup has generated the platform folders and added the packages. `lib/main.dart` calls `buildRoot`, which reads `AppConfig` from `--dart-define` values (defaults, validation, an `AppError` on a bad value), starts logging (`utils/logging.dart`, `package:logging` into `dart:developer`) and returns `App`, or `StartupErrorApp` when the config is invalid. `app.dart` holds `MaterialApp.router`; `routing/` holds the paths and `createRouter` (go_router, with `NotFoundScreen` as the error page). The payload is the home screen: `HomeScreen` reads `HomeViewModel`'s sealed state (loading, content, failure) and shows a spinner, the greeting, or `ErrorView` with `AppError.userMessage` and "Try again". The view model calls the `GreetingRepository` interface. Its implementation, `GreetingRepositoryRemote`, decodes JSON from the `GreetingService` interface, implemented by `FakeGreetingService`, and returns `Result<Greeting>`. `utils/` has `AppError`, `Result` and logging. `config/defines.example.json` lists every define for `--dart-define-from-file`. `test/` mirrors `lib/` with unit, view model, widget and accessibility tests; `integration_test/app_test.dart` runs the app on a simulator; `tool/ios_simulator.dart` picks the simulator. `docs/` has ARCHITECTURE, DEVELOPMENT (commands, simulators, Android, settings) and `guidance/flutter.md`. Read the code before extending it.

## Setup

`ios/` and `android/` come from `flutter create`; they can't ship as files because they carry the current Flutter release's templates. Everything else ships.

1. Read `flutter create --help`, then generate into a scratch subdirectory, never the project root: `.flutter-create/`, platforms iOS and Android only, the project name set to the project slug with hyphens turned into underscores, the organization from the decision, and no `pub get`. Copy its `ios/`, `android/` and `.metadata` into the project root, copy the `version:` line and the `environment:` block from its `pubspec.yaml` into the shipped `pubspec.yaml` (iOS reads the build name and number from `version:`), then delete `.flutter-create/`. Keep the shipped `lib/`, `test/`, `pubspec.yaml` and `analysis_options.yaml`.
2. Add the packages so each resolves to its current release: `flutter pub add go_router logging material_ui`, then `flutter pub add dev:flutter_lints`. Never type a version into `pubspec.yaml`.
3. `make install`, then `make fmt-check analyze coverage`. Where an installed release rejects shipped code or config (a renamed go_router API, a lint rule renamed or removed), update the code or the rule name and keep every rule, the strict language modes and the coverage floor. Run `make fmt` after editing.
4. `make build-ios test-ios`. The first iOS build takes several minutes. If no iPhone simulator exists, `make simulator` says how to add one.
5. Set the name people see: `App.title` in `lib/app.dart`, `CFBundleDisplayName` in `ios/Runner/Info.plist` and `android:label` in `android/app/src/main/AndroidManifest.xml`.
6. Record the toolchain in `docs/DEVELOPMENT.md` under Toolchain: Flutter and Dart from `flutter --version`, Xcode from `xcodebuild -version`, the iOS deployment target from the generated project, and whether an Android SDK is installed (`flutter doctor`). Commit `pubspec.lock`.
7. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/flutter.md` from AGENTS.md, then run `stacks verify` until it passes.

## Conventions

`docs/guidance/flutter.md` holds the Dart style, state management and testing rules; the shipped code follows each one. The ones an agent most often breaks:

- **Layers.** Views read one view model; view models call repositories; repositories call services. Each repository is an abstract interface with its implementations beside it (`GreetingRepository`, `GreetingRepositoryRemote`), and view models depend on the interface. A view never takes a repository, and nothing but a repository decodes service JSON.
- **State.** A view model exposes one sealed state and methods for user actions; the view switches on it exhaustively. The screen creates its view model in `initState` through the factory the router passes and disposes it.
- **Errors.** `AppError` is the only error that crosses a layer. Repositories catch exceptions, log once and return `Err`; screens show `userMessage` through `ErrorView`, never `detail`.
- **Config.** A new setting gets a key constant in `AppConfig` (added to `AppConfig.keys`), a read in `fromEnvironment`, a default, a validation rule that throws `AppError.config`, a test, an entry in `config/defines.example.json` and a row in `docs/DEVELOPMENT.md`. Local values go in the gitignored `config/defines.json`. Defines are compiled into the binary, and anything in the binary can be extracted, so never pass a secret through one; runtime secrets come from the app's backend.
- **Wiring.** New repositories go in `AppDependencies` and reach screens through `createRouter`. No singletons or service locators.
- **Packages** come from `flutter pub add`. Material is `package:material_ui/material_ui.dart`.

## Testing

`make test` runs everything under `test/` on the Dart VM in seconds: `AppConfig` parsing and the defines example, `AppError` mapping, the repository over `FakeGreetingService` (payload, invalid payload, network failure, unexpected exception and its log level), the view model's state sequence including a load that finishes after dispose, widget tests for each home screen state and the retry, the router's not-found page, `buildRoot` for a good and a bad config, and the simulator picker. `test/ui/accessibility_test.dart` checks Flutter's guidelines (tap targets, labels, text contrast) on the home screen, and the error view at 3x text scale. Verify runs these through `make coverage`, which fails when line coverage of `lib/` drops below 80%. `make test-ios` builds the app and runs `integration_test/` on an iPhone simulator through `buildRoot`, so config parsing, logging and the fake service's delay run on iOS. A new screen adds view model tests for each transition, widget tests for loading, content and error, a guideline case in the accessibility test, and one main-path case in `integration_test/`. Android has no device test: verify proves iOS on a Mac, the widget tests run the same Dart code for both platforms, and an emulator job would add CI minutes for little extra coverage.

## Commands

The shipped Makefile (`make help`) has install, fmt, fmt-check, analyze, test, coverage, simulator, test-ios, build-ios, build-android, ci, clean. Adapt recipes, keep the names, and mirror them in AGENTS.md with `flutter test test/ui/home/home_screen_test.dart` as the single-file command. No target starts `flutter run`.
<!-- stacks:when with=agent-ops -->

**Claude Code.** The stack's `.claude/` adds two hooks and three path-scoped rules under `.claude/rules/flutter/`. `protect-xcode-project.sh` denies Edit and Write on `*.pbxproj` and anything inside `*.xcodeproj/` or `*.xcworkspace/`, because Flutter, Swift Package Manager and CocoaPods rewrite those; `Info.plist` and `AppDelegate.swift` stay editable. `lint-dart.sh` runs `dart analyze` on each `.dart` file written, since agent-ops' `lint-on-write.sh` has no Dart linter; confirm it reports a deliberate error, then revert. List both hooks in `.claude/README.md`, and add these cases to `.claude/hooks/smoke.sh` beside the other guards:

```sh
denies "a project.pbxproj edit" '{"tool_input":{"file_path":"ios/Runner.xcodeproj/project.pbxproj","content":"x"}}' $h/protect-xcode-project.sh
allows "an Info.plist edit" '{"tool_input":{"file_path":"ios/Runner/Info.plist","content":"x"}}' $h/protect-xcode-project.sh
```

The settings allow the make targets and read-only flutter, dart and simctl commands. XcodeBuildMCP is optional (docs/DEVELOPMENT.md); don't add a `.mcp.json`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->

**CI.** Two jobs behind `ci-ok`. Install Flutter with the Flutter setup action on the stable channel at the version recorded in `docs/DEVELOPMENT.md`, with its cache on. `checks` on `ubuntu-latest`: `make install fmt-check analyze coverage build-android` (the Linux image has the Android SDK and a JDK, so this is where Android builds; add a Java setup step if the Gradle build asks for a different JDK). `ios` on macOS (ci-github's Xcode steps, with the Xcode version recorded at setup): `make install build-ios test-ios`, and nothing else.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** pre-commit runs `dart format` on the staged `.dart` files and restages them, then `make analyze`; pre-push runs `make test`. `make test-ios` stays out of the hooks: it takes minutes.
<!-- stacks:end -->
<!-- stacks:when with=rr -->

**rr.** `make fmt-check analyze test` run on any host with Flutter. `make build-ios` and `make test-ios` need a macOS host with Xcode and a simulator runtime, so give them their own task with `xcodebuild` and `xcrun` under `require:`, and send them only to such a host.
<!-- stacks:end -->

## Gotchas

- Don't run `flutter create .` in the project root. Wherever a file is missing it writes the counter app's, such as `test/widget_test.dart`, which references a `MyApp` the slice doesn't have, and `make analyze` fails. Generate into a scratch directory and copy, as Setup does.
- Material moved out of the framework into the `material_ui` package; examples online import `package:flutter/material.dart`, which the analyzer flags as deprecated. Cupertino widgets likewise come from `cupertino_ui`.
- `flutter run` stays attached for hot reload and never exits, so an agent's shell hangs on it. Use the tests, `make build-ios`, or ask the user to run the app.
- `pumpAndSettle` times out while a `CircularProgressIndicator` is on screen, because the spinner always schedules another frame. Check loading with `pump()`.
- `flutter test integration_test` with no `-d` picks any connected device, including a physical phone or Chrome. `make test-ios` always passes the simulator's UDID.
- `flutter` sees only booted simulators. `tool/ios_simulator.dart` boots one when none is running and never shuts one down.
- `dart run` prints pub's resolution lines on stdout when `pubspec.lock` is out of date; the Makefile keeps only the last line of the simulator tool's output for that reason.
- A plugin with native iOS code makes Flutter add it to the Xcode project through Swift Package Manager or CocoaPods during the next build. That's expected; commit the changes it makes under `ios/`.
