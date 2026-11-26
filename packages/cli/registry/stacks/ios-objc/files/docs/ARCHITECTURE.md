# Architecture

An iPhone app in Objective-C and UIKit with one screen. The Xcode project is generated from `project.yml` by XcodeGen.

## Launch path

1. `App/main.m` starts `UIApplicationMain` with `APPAppDelegate`.
2. `APPAppDelegate` logs the launch and returns a scene configuration whose delegate class is `APPSceneDelegate` (the scene manifest is generated, so there is no Info.plist entry to edit).
3. `APPSceneDelegate` reads `APPConfig` from `NSUserDefaults` (falling back to defaults with a fault log if a setting is invalid), builds `APPBundledGreetingService` and passes it to `APPGreetingViewController`, inside a navigation controller.
4. `APPGreetingViewController` shows a spinner, asks the service for the greeting, and shows the headline (formatted in Swift by `GreetingFormatter`) or an error message with a retry button.

## Code map

| Path | Holds |
| --- | --- |
| `App/APPAppDelegate.*`, `App/APPSceneDelegate.*`, `App/main.m` | Process and scene lifecycle; the scene delegate is the composition root |
| `App/Config/` | `APPConfig`: settings read from user defaults and validated |
| `App/Errors/` | `APPErrorDomain`, `APPErrorCode`, `APPErrorMake` and `APPUserMessage` |
| `App/Logging/` | `os_log` handles per category |
| `App/Greeting/` | The payload: `APPGreeting` model, `APPGreetingService` protocol, the bundled service, the screen and the Swift formatter |
| `App/Resources/` | `greeting.json`, the payload the bundled service reads |
| `App/App-Bridging-Header.h` | Objective-C headers visible to Swift |
| `AppTests/` | XCTest unit tests, the stub service and test fixtures |
| `AppUITests/` | XCUITest smoke tests |
| `Config/Shared.xcconfig` | Language, warning and analyzer settings for every target |
| `scripts/` | `sim-destination.sh` (picks a simulator), `xcodebuild.sh` (one xcodebuild invocation style), `analyze.sh` (fails on analyzer findings) |

## Where new code goes

A new screen gets its own folder under `App/` with its controller, its model and a service protocol plus implementation if it loads data. The scene delegate, or the controller that presents it, injects the service. Shared helpers that aren't a feature go in a folder named for what they do (`App/Formatting/`), never a `Utils` grab bag.

A network-backed service implements the same protocol as the bundled one, maps transport and decoding failures to `APPErrorCode` values, and calls its completion on the main queue.
