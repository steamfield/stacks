---
paths:
  - "App/**/*ViewController.swift"
  - "App/**/*ViewModel.swift"
  - "App/Navigation/**"
  - "App/Info.plist"
---

# UIKit layer

- Screens are built in code with Auto Layout (`translatesAutoresizingMaskIntoConstraints = false`, `NSLayoutConstraint.activate`). No storyboards or nibs; the launch screen is the `UILaunchScreen` key in Info.plist.
- A view controller renders its view model's state and forwards user actions. It never pushes, presents or creates another screen: the view model reports intent through a callback (`onSelect`), and `AppCoordinator` navigates.
- View models import Foundation only, never UIKit, so they test without a window.
- Lists use a diffable data source keyed by the model's `id`, with cells built from a `CellRegistration`.
- Loading, empty and error states use `contentUnavailableConfiguration`. Error text comes from `AppError.userMessage`; never show `localizedDescription`.
- Every element a UI test finds gets an `accessibilityIdentifier` from the screen's `AccessibilityID` enum.

Reasons and examples: [docs/guidance/swift.md](../../../docs/guidance/swift.md), "UIKit".
