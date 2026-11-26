---
paths:
  - "App/**/*.swift"
  - "AppTests/**/*.swift"
---

# Swift concurrency

- The project builds with complete concurrency checking (project.yml's `SWIFT_VERSION` and `SWIFT_STRICT_CONCURRENCY`) and warnings as errors. Fix a diagnostic at its cause; never add `@unchecked Sendable`, `nonisolated(unsafe)` or `@preconcurrency` to silence one without asking the user.
- View controllers and view models are `@MainActor` (view controllers through `UIViewController`, view models explicitly). Services are `Sendable` structs or actors and run off the main actor.
- No `DispatchQueue.main` (SwiftLint denies it). Async work from a view controller is a `Task` it keeps and cancels, capturing `self` weakly.
- Service methods use typed throws, `throws(AppError)`, so callers map errors without casting.

Reasons and examples: [docs/guidance/swift.md](../../../docs/guidance/swift.md), "Concurrency".
