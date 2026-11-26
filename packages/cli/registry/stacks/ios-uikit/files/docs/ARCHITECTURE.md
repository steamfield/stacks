# Architecture

A UIKit iPhone app built in code: scene-based lifecycle, one coordinator for navigation, and MVVM screens on the main actor. XcodeGen generates the Xcode project from `project.yml`.

## Launch path

1. `AppDelegate` (`@main`) returns the default scene configuration.
2. `SceneDelegate` loads `AppConfig` from Info.plist and the environment, builds `BundledItemService`, creates the window and a `UINavigationController`, and calls `AppCoordinator.start(service:)`. An invalid config goes to `AppCoordinator.showStartupFailure(_:)` instead.
3. `AppCoordinator` puts `ItemListViewController` at the root. Its view model loads items and reports a tapped row through `onSelect`; the coordinator pushes `ItemDetailViewController`.

## Layers

| Folder | Holds | May import |
| --- | --- | --- |
| `App/Config` | `AppConfig`: typed settings, defaults, validation | Foundation |
| `App/Errors` | `AppError` and its `UserMessage` mapping | Foundation |
| `App/Logging` | `Log`: one `os.Logger` per category | Foundation, os |
| `App/Items` | The list feature: model, service protocol and bundled implementation, view model, view controllers | View models: Foundation only. View controllers: UIKit |
| `App/Navigation` | `Coordinator` and `AppCoordinator` | UIKit |
| `App/Resources` | Bundled data (`items.json`) | |

A new feature gets its own folder beside `Items/` with the same split: a model, a service protocol, a `@MainActor` view model, and view controllers that the coordinator creates.

## Data flow on the list screen

```text
ItemListViewController --load()/select(itemID:)--> ItemListViewModel --items()--> ItemService
        ^                                                |
        +------------- onStateChange(State) -------------+
                                                         +--onSelect(Item)--> AppCoordinator
```

`State` is `idle`, `loading`, `loaded([Item])` or `failed(UserMessage)`. The view controller maps each to the spinner, the list, the empty view or the error view; nothing else decides what's on screen.

## Errors

Services throw `AppError` with typed throws. View models map it to `UserMessage` (title, detail, whether a retry can help) and log the case. Users never see an error's `localizedDescription`, keys or paths.

## Logging

`Log.app`, `Log.items` and `Log.navigation` write to the unified log under the bundle identifier. Read them in Console.app, or `xcrun simctl spawn booted log stream --predicate 'subsystem == "<bundle id>"'`. Interpolations are private unless marked `.public`; mark only values that hold no user data.

## Project generation

`project.yml` declares three targets (`App`, `AppTests`, `AppUITests`), the `App` scheme and the build settings: complete concurrency checking, warnings as errors, no signing for simulator builds (the Makefile passes `CODE_SIGNING_ALLOWED=NO`). `make project` regenerates the `.xcodeproj` when the spec or the file list changes; every build and test target runs it first, so new files are picked up.
