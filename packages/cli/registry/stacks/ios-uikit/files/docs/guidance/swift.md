# Swift and UIKit guidance

Rules for every agent and person changing this app. The shipped code follows each one; the Claude rules under `.claude/rules/ios-uikit/` restate the must-keep parts.

## Concurrency

The build uses complete concurrency checking and treats warnings as errors, so a data race is a compile error.

- UI types are `@MainActor`. `UIViewController` already is; view models say so explicitly. This keeps every state change on the main thread without `DispatchQueue.main`, which SwiftLint denies.
- Services are `Sendable`: a struct of immutable values (`BundledItemService`) or an actor when it holds mutable state. Their async methods run off the main actor, so file and network work never blocks the UI.
- A view controller starts async work in a `Task` it stores, cancels the previous one before starting another, and captures `self` weakly (`ItemListViewController.reload()`).
- Errors cross the boundary as `AppError` through typed throws (`throws(AppError)`). Callers get the exact cases without casting.
- Don't silence a diagnostic with `@unchecked Sendable`, `nonisolated(unsafe)` or `@preconcurrency`. Each one moves a compile error to a runtime crash. If a framework type isn't `Sendable` yet, keep it inside one actor and pass values out.

## UIKit

- Every screen is built in code. Constraints use anchors with `translatesAutoresizingMaskIntoConstraints = false`, activated together with `NSLayoutConstraint.activate`. Text uses Dynamic Type (`preferredFont(forTextStyle:)` with `adjustsFontForContentSizeCategory`), and content sits on `readableContentGuide` or the safe area.
- No storyboards or nibs. The launch screen is the `UILaunchScreen` dictionary in Info.plist, which iOS renders from the app's background color.
- Navigation belongs to the coordinator. A view controller never calls `pushViewController` or `present`; its view model exposes a callback (`onSelect`), the coordinator sets it, and the coordinator creates the next screen with its dependencies. This keeps screens reusable and lets tests check navigation without a window.
- View models import Foundation, never UIKit. They expose a `State` enum and methods for user actions. View controllers render state and nothing else decides what's on screen.
- Lists use `UICollectionViewDiffableDataSource` with the model's `id` as the item identifier, a compositional list layout and a `CellRegistration`. Look the model up by id in the cell provider; don't put whole models in the snapshot when they change independently of identity.
- Empty, loading and error states use `contentUnavailableConfiguration`. Error text comes from `AppError.userMessage`, which has no keys, paths or type names.
- Elements a UI test needs get an `accessibilityIdentifier` from the screen's `AccessibilityID` enum, so tests don't depend on copy that might be localized.

## Testing

| Layer | Target | Command | Covers |
| --- | --- | --- | --- |
| Unit | `AppTests` | `make test` | View models, the coordinator, `AppConfig`, `AppError`, services |
| UI smoke | `AppUITests` | `make test-ui` | Launching the app and the journeys unit tests can't reach |

- Unit tests are hosted in the app, run on the main actor (`@MainActor` on the test class) and use test doubles from `AppTests/Support/`. Await the view model's async method directly; never sleep or poll.
- A new view model gets tests for each state it can reach and each callback. A new screen in the coordinator gets a test that the right view controller lands on the navigation stack.
- UI tests launch the real app. Keep them few: one per journey. Find elements by accessibility identifier and wait with `waitForExistence(timeout:)`. To reach an error state, set an `APP_*` key in `launchEnvironment` that `AppConfig` already reads; never add a test-only branch to app code.
- `scripts/sim-destination.sh` picks the simulator: `SIM_DESTINATION` or `SIM_UDID` when set, otherwise a booted iPhone on the newest iOS runtime, otherwise any iPhone there. Never write a device name or OS version into the Makefile or CI.

## Lint and format

- swift-format owns layout: `make fmt` rewrites, `make fmt-check` fails on any difference or finding. It runs with its default configuration.
- SwiftLint owns code rules (`.swiftlint.yml`) and runs with `--strict`. Its whitespace rules are off so the two tools don't disagree. The custom rules deny `print`/`NSLog`, `DispatchQueue.main`, and storyboard or nib loading.
- Keep every enabled rule when a new SwiftLint or swift-format release changes behavior. A rule that's wrong for one line gets `// swiftlint:disable:next <rule>` with a reason on the same line.

## Optional tools

XcodeBuildMCP is an MCP server that lets a coding agent build, run and inspect the app on a simulator through Xcode. It is optional and not configured here; the make targets cover every check.
