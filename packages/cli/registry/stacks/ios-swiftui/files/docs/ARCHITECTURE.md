# Architecture

A SwiftUI app with one composition root, `@Observable` view models and services behind protocols.

## Launch

`MainApp` (the `@main` type) calls `Launch.start` once with the bundle's Info.plist:

1. `AppConfig(info:)` reads typed settings. Missing or empty values take defaults; an invalid value throws `AppError.invalidConfiguration`.
2. On success it builds the services (`LocalGreetingService`) and view models (`GreetingViewModel`) and shows `GreetingScreen`.
3. On failure it logs the detail and shows `ErrorView` without a retry button, since only a new build fixes a bad setting.

Nothing else builds services. A new feature adds its service and view model to `Launch.start` and passes them down.

## Layers

| Folder | Holds | May import |
| --- | --- | --- |
| `App/Sources/Config/` | `AppConfig`: settings, keys, defaults, validation | Foundation |
| `App/Sources/Support/` | `AppError`, `ErrorView`, `Log` | Foundation, SwiftUI, OSLog |
| `App/Sources/<Feature>/` | A service protocol and its implementations, a view model, screens | Support, Config |
| `App/Sources/MainApp.swift` | The entry point and `Launch` | everything |

Features don't import each other's view models. Shared data types move to `Support/` when a second feature needs them.

## Data flow

A screen holds its view model and renders `state`. User actions call view model methods, which call the service and set `state`. Services throw `AppError` and return `Sendable` values; view models catch, set `.failed(error)` and log `logDescription`.

## Errors

| Case | User sees | Retry | Logged as |
| --- | --- | --- | --- |
| `invalidConfiguration(key:value:)` | "This build of the app is misconfigured..." | no | `invalid_configuration key=... value=...` |
| `unavailable(reason:)` | "Couldn't load this right now..." | yes | `unavailable reason=...` |

## Settings

| Build setting (project.yml) | Info.plist key | Default | Valid values |
| --- | --- | --- | --- |
| `APP_ENVIRONMENT` | `AppEnvironment` | `development` | `development`, `staging`, `production` (Debug sets development, Release production) |
| `APP_GREETING_SUBJECT` | `AppGreetingSubject` | `world` | up to 40 characters |

Info.plist ships inside the app bundle and anyone can read it, so it never holds secrets. Nor does any other file or build setting: anything compiled into the bundle can be extracted, so a secret the app needs at run time comes from its backend.

## Logging

`Log.app` and `Log.greeting` are `os.Logger`s under the bundle identifier. Read them in Console.app or with:

```sh
xcrun simctl spawn booted log stream --level info --predicate 'subsystem == "<bundle id>"'
```

Interpolated values are redacted unless marked `privacy: .public`; only non-sensitive values get that mark.
