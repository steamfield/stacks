# SwiftUI

## Views and view models

A screen is a `View` over one view model. The view renders `state` and calls methods; the view model holds the logic and talks to services. That split keeps logic testable without a simulator UI and keeps views small.

- **Observation, not Combine.** View models are `@Observable`. SwiftUI tracks the properties a `body` reads and re-renders when they change. `ObservableObject`, `@Published`, `@StateObject` and `@ObservedObject` are the older model; don't mix them in.
- **Ownership.** A view that creates its view model holds it in `@State private var model = ...`. A view handed one by its parent (as `GreetingScreen` is, from `Launch`) takes `let model`. Use `@Bindable` only when the view needs a binding (`$model.text`) into it.
- **State as an enum.** `GreetingViewModel.State` has `idle`, `loading`, `loaded` and `failed`. The view switches over it, so a new state fails to compile until the view handles it.
- **Errors.** `failed(AppError)` renders `ErrorView`, which shows `userMessage` and a retry button when `isRetryable`.

## Composition

`Launch.start` in `MainApp.swift` builds services and view models from `AppConfig`. A view never creates a service. To swap the local greeting for a networked one, write a new `GreetingService` and change one line in `Launch.start`.

## Navigation

Each top-level screen owns a `NavigationStack`. Push with `NavigationLink(value:)` and `.navigationDestination(for:)` so routes are data a view model can drive.

## Previews

Each screen has a `#Preview` built from a local service with `AppConfig.defaults`, plus previews for its error states. Previews compile with the app, so a broken preview breaks `make typecheck`.

## Accessibility

Every element a UI test finds gets `.accessibilityIdentifier("feature.element")`. Use system fonts (`.font(.title)`) so Dynamic Type works, and give image-only buttons a label.
