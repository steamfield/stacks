---
paths:
  - "App/**/*.swift"
  - "AppTests/**/*.swift"
---

Swift 6 language mode with complete concurrency checking; warnings are errors.

- Views and view models are `@MainActor`. View models are `@MainActor @Observable final class`.
- Services are `Sendable` protocols with `async throws(AppError)` methods; value types crossing actors are `Sendable` structs or enums.
- Never silence a diagnostic with `@unchecked Sendable`, `nonisolated(unsafe)`, `@preconcurrency import` or `MainActor.assumeIsolated`. Fix the isolation instead; ask the user if you can't.
- Mutable shared state lives in an actor or on the main actor, never in a global `var`.

Reasons and examples: [docs/guidance/concurrency.md](../../../docs/guidance/concurrency.md).
