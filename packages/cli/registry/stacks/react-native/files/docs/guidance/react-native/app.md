# App structure

## Where things go

| Path | Owns |
| --- | --- |
| `index.js` | Registers `App` under `app.json`'s `name`, which must equal the Xcode scheme (`scripts/ios.sh build` checks it) |
| `src/app/app.tsx` | Root component: error boundary, settings, logger, services context, navigation container |
| `src/app/routes.ts` | Every route and its params |
| `src/app/navigation.tsx` | The native stack and its screens |
| `src/app/services.tsx` | `useServices()`: settings and logger for screens |
| `src/config.ts` | Settings: defaults and zod rules |
| `src/errors.ts` | `AppError`, `toAppError`, `userMessage`, `isRetryable` |
| `src/logging.ts` | Structured records; the only `console` user |
| `src/native/` | One file per native module: timeout, decoding, error mapping |
| `src/features/<name>/` | A screen and the hook that loads its data |
| `src/components/` | Shared views such as `ErrorState` |

## Settings

Settings arrive as the root component's initial properties under `config`. The native side passes them when it starts React Native (`initialProperties` in the generated delegate), and tests pass them as props. With none, the defaults apply: debug logging in development, info in release, and a 5 second native timeout.

To add a setting: a field in `AppConfig`, a default in `defaultConfig`, a rule in `overridesSchema`, and a row in `src/config.test.ts` for a valid and an invalid value. Unknown keys are rejected, so a typo fails at startup instead of being ignored.

An invalid value throws a `config` `AppError` while `Root` renders. The error boundary catches it, logs `render.failed` and shows which setting is wrong.

## Errors

Every failure becomes an `AppError` with one of these kinds:

| Kind | Cause | Retry |
| --- | --- | --- |
| `config` | An invalid setting | No |
| `unavailable` | The native module isn't linked into this build (Android until it has an implementation) | No |
| `timeout` | The native call took longer than `nativeTimeoutMs` | Yes |
| `native` | The native side rejected; `code` holds its rejection code | Yes |
| `decode` | The native answer didn't match the zod schema | No |
| `unexpected` | Anything else | Yes |

`userMessage` and `isRetryable` are the one table. A new kind adds a row to both and to `src/errors.test.ts`.

## Logging

`createLogger({ level })` writes one JSON line per record with `level`, `event` and `time` plus flat fields. Event names are `area.what_happened` (`app_info.failed`). Log kinds and codes, never user data or native payloads. The level comes from settings; tests pass a sink to capture records.

## Screens

A screen reads its data through a hook in its feature folder (`useAppInfo`) that returns a discriminated state and a reload. The screen renders each state: an `ActivityIndicator` with an accessibility label while loading, `ErrorState` with the mapped message on failure, and the data on success. The hook drops a result that arrives after unmount or a newer reload.
