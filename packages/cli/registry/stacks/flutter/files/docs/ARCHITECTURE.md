# Architecture

The app follows Flutter's architecture guide (docs.flutter.dev/app-architecture): a UI layer of views and view models over a data layer of repositories and services. Data flows up from services to views; user actions flow down as view model method calls.

```text
lib/
  main.dart                 entry: config, logging, root widget
  app.dart                  MaterialApp.router, theme
  config/                   AppConfig (--dart-define values), AppDependencies (repositories built once)
  routing/                  Routes (paths) and createRouter (go_router)
  ui/
    core/widgets/           shared widgets: ErrorView, NotFoundScreen, StartupErrorApp
    <feature>/view_models/  one ChangeNotifier per screen
    <feature>/widgets/      the screen and its pieces
  domain/models/            immutable app models (Greeting)
  data/
    services/               one interface per external source, plus fakes
    repositories/           the source of truth for each model: an interface plus implementations; returns Result
  utils/                    AppError, Result, logging
test/                       mirrors lib/
integration_test/           runs on a simulator or device
tool/                       Dart scripts the Makefile calls
```

## The layers

| Layer | Knows about | Never touches |
| --- | --- | --- |
| View (`ui/<feature>/widgets`) | its view model, shared widgets | repositories, services |
| View model (`ui/<feature>/view_models`) | repositories, domain models | widgets, `BuildContext`, services |
| Repository (`data/repositories`) | services, domain models | Flutter widgets |
| Service (`data/services`) | one external source (HTTP, storage, a plugin) | other services, models beyond JSON |

Each repository is an `abstract interface class` (`GreetingRepository`) with its implementations beside it (`GreetingRepositoryRemote`, over a service). View models and `AppDependencies` name the interface, so another environment or a test can pass a different implementation.

A view model exposes one sealed state type and methods for user actions. The view switches on that state exhaustively, so adding a state is a compile error until every view handles it.

## Errors

`AppError` (`utils/app_error.dart`) is the only error type that crosses a layer. Services throw it; repositories catch exceptions, log them once and return `Err(AppError)`; view models turn `Err` into a failure state; views show `AppError.userMessage` and offer "Try again" when `retryable` holds. `detail` and `cause` go to the log, never the screen. A new failure kind gets an `AppErrorKind` value and a message in the `userMessage` switch.

Startup is the other boundary: an invalid `--dart-define` makes `buildRoot` show `StartupErrorApp` with the message instead of starting the app with a wrong value.

## Logging

`package:logging` gives each class a named `Logger` with levels; `configureLogging` sends records at or above `LOG_LEVEL` to `dart:developer`'s `log`, which DevTools and the `flutter run` console show. Tests pass their own sink to read records. Never `print` (the analyzer rejects it).

## Dependency wiring

`AppDependencies` builds the repositories once in `buildRoot`. The router hands each screen a factory that builds its view model from them, and the screen owns and disposes it. There is no service locator; a test builds the objects it needs and passes them in.
