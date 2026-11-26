---
paths:
  - "App/**/*ViewController*"
  - "App/APPSceneDelegate.*"
  - "App/APPAppDelegate.*"
---

# UIKit rules

- UI is built in code: no storyboards or XIBs. Views go in a stack view or Auto Layout anchors inside `NSLayoutConstraint activateConstraints:`; set `translatesAutoresizingMaskIntoConstraints = NO` on every view you constrain.
- `APPSceneDelegate` is the composition root: it reads `APPConfig`, builds services and injects them into controllers through their designated initializer. Controllers never create services or read `NSUserDefaults`.
- A screen that loads data has explicit states (loading, content, failed) and one method per state that sets every view's visibility, as `APPGreetingViewController` does. Error text comes from `APPUserMessage`, never from `error.localizedDescription` or the debug reason.
- Service completions arrive on the main queue (the `APPGreetingService` contract); update views directly in them, with the weak-self pattern.
- User-facing strings go through `NSLocalizedString` (the analyzer's localizability check flags literals). Fonts use text styles with `adjustsFontForContentSizeCategory`.
- Every element a UI test touches gets an `accessibilityIdentifier` constant declared in the controller's header; the UI tests repeat the string, since they can't import app code.

Reasons and examples: [docs/guidance/objc.md](../../../docs/guidance/objc.md).
