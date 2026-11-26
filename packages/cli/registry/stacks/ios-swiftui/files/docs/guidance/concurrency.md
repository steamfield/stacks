# Concurrency

The project builds in Swift 6 language mode with `SWIFT_STRICT_CONCURRENCY: complete` and warnings as errors, so every data race the compiler can see fails the build.

## Isolation

- **Views and view models run on the main actor.** SwiftUI's `View` is main-actor isolated; view models are `@MainActor @Observable final class`, so the state a view reads is only ever written on the main actor.
- **Services are nonisolated and `Sendable`.** A service protocol's methods are `async throws(AppError)`. An implementation with no mutable state is a `struct`; one that caches or counts is an `actor`.
- **Values crossing actors are `Sendable`.** Payloads (`Greeting`) and errors (`AppError`) are structs and enums of `Sendable` fields.

```swift
protocol GreetingService: Sendable {
    func greeting() async throws(AppError) -> Greeting
}

@MainActor
@Observable
final class GreetingViewModel {
    private(set) var state: State = .idle
    func load() async { ... }   // awaits the service, then sets state on the main actor
}
```

`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` stays off. Turning it on changes what every unannotated declaration in every target means, so it's the user's call.

## What not to do

| Don't | Why | Do |
| --- | --- | --- |
| `@unchecked Sendable` on a class | Hides a race the compiler found | Make it an actor, or a struct of `Sendable` fields |
| `nonisolated(unsafe) var` | A global the compiler can no longer check | Move the state into an actor or the main actor |
| `@preconcurrency import` | Turns another module's errors into nothing | Wrap the API in an actor or a `@MainActor` type |
| `MainActor.assumeIsolated` | Crashes when the assumption is wrong | Make the caller `@MainActor`, or `await` the call |
| `DispatchQueue.main.async` | Bypasses the checker | `@MainActor` functions and `await` |
| `Task.detached` | Drops the caller's isolation and priority | `Task { }` in the view model, or `.task` in the view |

## Tasks

Start work from a view with `.task { await model.load() }`; SwiftUI cancels it when the view disappears. A button that starts async work calls `Task { await model.action() }`. Long work checks `Task.isCancelled` or calls `try Task.checkCancellation()`.

## Typed throws

Service methods use `throws(AppError)`, so a `catch` in a view model gets an `AppError` without casting. Code that calls a system API with untyped errors maps them to an `AppError` case at the service boundary.
