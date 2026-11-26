# Flutter and Dart guidance

Rules every agent follows in this project. The shipped code under `lib/` and `test/` already keeps each one; read it before adding to it.

## Dart style

- `make fmt` before finishing; `make fmt-check` fails on any unformatted file. Don't hand-align code the formatter will rewrite.
- `make analyze` must report nothing. Fix a finding rather than adding `// ignore:`; if an ignore is the only way, put the reason on the same line.
- The analyzer runs with strict casts, inference and raw types: no implicit `dynamic`. Decode JSON by checking types (`if (value is! String)`) and turn a mismatch into `AppError(AppErrorKind.invalidResponse, ...)`.
- Files inside `lib/` import each other with relative paths; tests and `integration_test/` import `package:app/...`.
- Material comes from `package:material_ui/material_ui.dart`. `package:flutter/material.dart` is deprecated and the analyzer flags it; use `package:flutter/widgets.dart` or `foundation.dart` where no Material widget is needed.
- `final` locals and fields by default; `final class` for types nobody should extend; `sealed` for a closed set of states.
- Futures are awaited or wrapped in `unawaited(...)` on purpose (`unawaited_futures` is on).
- No `print`; use a `Logger('<ClassName>')` from `package:logging`.

## State management

- One view model per screen, a `ChangeNotifier` that exposes a single sealed state and methods for user actions. The view reads it through `ListenableBuilder` and switches on the state exhaustively.
- The screen creates its view model through a factory in `initState` and disposes it in `dispose`. A view model checks it isn't disposed before notifying after an `await`.
- View models call repositories, never services. Repositories return `Result<T>` (`Ok` or `Err`), so a view model handles failure with a `switch`, not `try`/`catch`.
- Views take no repositories and do no I/O. Navigation uses `context.go(Routes.x)` with paths from `routing/routes.dart`.
- No global singletons or service locators. A new repository goes in `AppDependencies`, built once in `buildRoot`, and reaches screens through the router.
- Add `provider` or Riverpod only when the user asks for it; the layering above stays.

## Testing

- Unit tests sit under `test/` mirroring `lib/`: config parsing, error mapping, repositories over `FakeGreetingService`, view model state sequences.
- Widget tests pump a screen inside `MaterialApp` with a real view model and repository over a fake service. Assert on what the user sees (text, widget types, a tapped button's effect), not on private state.
- Use the fakes in `data/services/`; don't mock repositories or add a mocking package for what a fake covers.
- `pumpAndSettle` waits for animations to finish, so it never returns while a `CircularProgressIndicator` is on screen. Check the loading state with `pump()`, then settle once the data arrives.
- A test that changes global state (logging, `FlutterError.onError`) restores it or goes through a function that replaces it, such as `configureLogging`.
- `integration_test/` runs the app as `main` builds it on a simulator (`make test-ios`). Add a case there for each new screen's main path; keep edge cases in widget tests, which run in seconds.
- A new screen gets: a view model test for each state transition, a widget test for loading, content and error, and a route in the router test if it has its own path.
