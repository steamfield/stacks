# Development

## Toolchain

<!-- Recorded at setup: Flutter and Dart (`flutter --version`), Xcode (`xcodebuild -version`), the iOS deployment target from ios/Runner.xcodeproj, and the Android SDK if installed. -->

## Commands

| Command | What it does |
| --- | --- |
| `make install` | Checks `ios/` and `android/` exist, runs `flutter pub get` |
| `make fmt` / `make fmt-check` | `dart format` on lib, test, integration_test and tool |
| `make lint-fix` | `dart fix --apply` for the analyzer's fixable findings, then `dart format` |
| `make analyze` | `flutter analyze`; any finding fails, infos included |
| `make test` | Unit and widget tests, no device |
| `make coverage` | The same with lcov output in `coverage/lcov.info`; fails when line coverage of `lib/` is below `COVERAGE_MIN` (80 by default, in the Makefile). Verify and CI run this |
| `make simulator` | Prints the iPhone simulator the iOS targets use, booting it if needed |
| `make test-ios` | `integration_test/` on that simulator |
| `make build-ios` | Unsigned debug build for the simulator |
| `make build-android` | Debug APK; needs the Android SDK |
| `make audit` | osv-scanner over `pubspec.lock`; needs the network, so `make ci` leaves it out |
| `make ci` | Everything verify runs on a Mac |

One test file: `flutter test test/ui/home/home_screen_test.dart`. One test by name: `flutter test --plain-name 'retry'`.

## Simulators

`tool/ios_simulator.dart` picks a booted iPhone simulator, or the first iPhone on the newest installed iOS runtime, and boots it. Nothing names a device model or an OS version. Set `SIMULATOR_UDID=<udid>` to choose one (`xcrun simctl list devices available`). The tool never shuts a simulator down.

`flutter run` with no `-d` asks which device to use when several are connected; pass `-d <udid>` to skip the prompt. An agent shouldn't start `flutter run` in the foreground: it stays attached for hot reload and never exits.

Simulator builds need no signing. A build for a physical iPhone needs a development team set in Xcode (`open ios/Runner.xcworkspace`, Runner target, Signing & Capabilities); that change is the user's to make.

## Android

Android is a real target, but verify on a Mac proves iOS. `make build-android` needs the Android SDK (Android Studio, or the command-line tools with `flutter config --android-sdk`). `flutter doctor` says what is missing. Unit and widget tests are the same on both platforms.

## Settings

Values are compiled in with `--dart-define`, or from a file with `--dart-define-from-file=config/defines.json`, and read once by `AppConfig`. Copy `config/defines.example.json` to `config/defines.json` (gitignored) for local values; a test keeps the example's keys in step with `AppConfig.keys`. Each has a default, and an invalid value stops startup with a message naming the key.

| Key | Default | Rule |
| --- | --- | --- |
| `GREETING_NAME` | `world` | At most 40 characters |
| `SERVICE_DELAY_MS` | `300` | Whole number from 0 to 10000 |
| `LOG_LEVEL` | `INFO` | A `package:logging` level name: ALL, FINEST, FINER, FINE, CONFIG, INFO, WARNING, SEVERE, SHOUT, OFF |

```sh
flutter run --dart-define=LOG_LEVEL=FINE --dart-define=SERVICE_DELAY_MS=0
```

Defines are compiled into the app binary, and anything in the binary can be extracted, so never pass a secret this way. Runtime secrets come from the app's backend.

## The Xcode project

`ios/Runner.xcodeproj` and `ios/Runner.xcworkspace` came from `flutter create`, and Flutter, Swift Package Manager and CocoaPods rewrite them. Prefer changing them through Flutter (`flutter pub add` for a plugin, then a build) or in Xcode; when `project.pbxproj` must change as text, keep the edit small and check it with `make build-ios`. `ios/Flutter/ephemeral/`, `ios/Flutter/Generated.xcconfig`, `GeneratedPluginRegistrant.*`, `ios/Pods/` and `Podfile.lock` are regenerated on every build or pod install, so edit their sources instead. To restore a lost platform file, run `flutter create` into a scratch directory and copy the file over; `flutter create .` in the project root also writes a counter-app test the analyzer rejects. `ios/Runner/Info.plist` and `AppDelegate.swift` are ordinary files to edit.

XcodeBuildMCP is an optional MCP server that lets an agent drive simulators and Xcode builds. It isn't configured here; add it to your own agent settings if you want it.
