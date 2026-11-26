---
paths:
  - "lib/ui/**"
  - "lib/data/**"
  - "lib/routing/**"
  - "lib/config/**"
---

- One `ChangeNotifier` view model per screen with a single sealed state and methods for user actions. Views read it with `ListenableBuilder` and switch on the state exhaustively.
- The screen creates its view model through a factory in `initState` and disposes it; after an `await`, the view model checks it isn't disposed before notifying.
- Views never take a repository or service. View models call repositories, never services. A repository is an abstract interface (`GreetingRepository`) with implementations beside it (`GreetingRepositoryRemote`); view models take the interface. Repositories return `Result<T>` and log each failure once.
- Errors reach the screen as `AppError`; show `userMessage` through `ErrorView`, never `detail` or an exception's text.
- New repositories go in `AppDependencies` and reach screens through `createRouter`. No singletons or service locators; no `provider` or Riverpod unless the user asked.
- Navigate with `context.go(Routes.x)`; add every path to `routing/routes.dart`.

Reasons and examples: [docs/guidance/flutter.md](../../../docs/guidance/flutter.md), "State management", and [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).
