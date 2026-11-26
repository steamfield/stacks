# Configuration

`AppConfig` is read once at launch by `SceneDelegate`. Later sources win:

1. `AppConfig.defaults` in `App/Config/AppConfig.swift`
2. The `AppConfig` dictionary in `App/Info.plist`
3. Environment variables, set in the Xcode scheme (Edit Scheme, Run, Arguments) or a UI test's `launchEnvironment`

An invalid value stops startup with the "Something is misconfigured" screen and a fault in the log naming the key. There is no silent fallback to the default.

| Setting | Info.plist key | Environment variable | Default | Valid values |
| --- | --- | --- | --- | --- |
| `itemsResource` | `ItemsResource` (string) | `APP_ITEMS_RESOURCE` | `items` | Name of a bundled `.json` file, without the extension; not blank |
| `loadDelay` | `LoadDelayMilliseconds` (integer) | `APP_LOAD_DELAY_MS` | `0` | 0 to 10000 milliseconds |

## Adding a setting

1. Add the property to `AppConfig` and its default to `defaults`.
2. Read it in `load(info:environment:)` from both sources, rejecting the wrong type with `AppError.invalidConfig`.
3. Add its range or format check to `validate()`.
4. Add rows to `AppConfigTests` (precedence and every rejection) and to the table above.

Per-build values (a staging and a production API host, say) go in build settings in `project.yml`, referenced from Info.plist as `$(SETTING_NAME)`, so each configuration gets its own value without code changes.

Secrets never go in Info.plist or the environment of a shipped build; anything in the app bundle is readable by anyone who downloads it.
