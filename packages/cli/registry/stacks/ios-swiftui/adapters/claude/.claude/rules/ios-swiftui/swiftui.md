---
paths:
  - "App/Sources/**/*.swift"
  - "App/Info.plist"
---

- A view renders its view model's state and calls its methods. No service calls, parsing or business rules in a view.
- A view that creates its view model holds it in `@State private var`; one that receives it takes a plain `let` (Observation tracks reads). No `ObservableObject`, `@Published`, `@StateObject` or `@ObservedObject`.
- Every state the view model can be in has a branch in the view, including the error state through `ErrorView`.
- Services and view models are built in `Launch.start` (the composition root) and passed down, never created inside a view body.
- Show `AppError.userMessage` only; log `logDescription` through `Log.<area>`, never `print`.
- Every element a UI test finds gets an `accessibilityIdentifier` (`feature.element`).
- A new setting: build setting in project.yml, `$(SETTING)` in App/Info.plist, key, default and validation in `AppConfig`, a test row. No secrets in Info.plist.

Reasons and examples: [docs/guidance/swiftui.md](../../../docs/guidance/swiftui.md).
