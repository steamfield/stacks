# Objective-C guidance

The rules new code in this project follows, with the reason for each. The shipped code under `App/` follows all of them; read it next to this page.

## Nullability and generics

Every header sits between `NS_ASSUME_NONNULL_BEGIN` and `NS_ASSUME_NONNULL_END`, so pointers are nonnull unless marked `nullable`. The compiler then warns when a nullable value flows into a nonnull parameter (`-Wnullable-to-nonnull-conversion`, an error here), and the analyzer tracks nil through code paths (`CLANG_ANALYZER_NONNULL`). Swift reads the same annotations: `APPGreeting.message` arrives in `GreetingFormatter.swift` as `String`, not `String?`.

Collections carry lightweight generics (`NSDictionary<NSString *, id> *`). They cost nothing at run time, catch the wrong element type at compile time, and import into Swift as typed collections.

When a value from outside the type system (JSON, user defaults) might be nil or the wrong class, check it with `isKindOfClass:` before casting, as `APPGreeting` and `APPConfig` do.

## Initializers and immutability

A class with required state has one initializer marked `NS_DESIGNATED_INITIALIZER`, and `init`/`new` marked `NS_UNAVAILABLE`, so an object can't exist half-built. View controllers also mark `initWithNibName:bundle:` and `initWithCoder:` unavailable, because the UI is built in code. Public properties are `readonly`; `NSString`, block and collection properties are `copy`, so a caller's later mutation of an `NSMutableString` can't change the object (`APPGreetingTests` checks this).

## Errors

The app has one error domain, `APPErrorDomain`, with codes in `APPErrorCode` (`App/Errors/APPError.h`). A method that can fail returns `nil` or `NO` and fills an `NSError **` parameter, checking it for `NULL` first. Create errors with `APPErrorMake(code, reason, underlying)`: the reason is a developer-facing string stored under `NSDebugDescriptionErrorKey`, and the underlying error keeps the framework's cause.

What the user reads comes from `+[APPUserMessage messageForError:]`, which maps each code to localized text and says whether retrying can help. Errors from other domains, and codes a newer build added, fall through to a generic retryable message. Never show `localizedDescription` or the reason on screen; they're written for developers.

To add a failure: append a code to the enum (never renumber), add its case to `messageForError:`, and add a test for each in `APPErrorTests`.

## Configuration

`APPConfig` is the only reader of settings. It registers defaults on `NSUserDefaults`, reads each key, validates it and returns an immutable object, or `nil` with an `APPErrorCodeInvalidConfiguration` error. `NSUserDefaults` already layers registered defaults under saved values under launch arguments, so `-APPGreetingResource missing` on the command line, in an Xcode scheme or in a UI test's `launchArguments` overrides a setting with no extra code.

A new setting gets a key constant, a default in `registeredDefaults`, a validation rule, a property, and tests in `APPConfigTests` for the default, an override and a rejected value.

## Logging

`os_log` through the handles in `App/Logging/APPLog.h`, one per category, all under the bundle identifier. Use `os_log_info` for lifecycle, `os_log_error` for recoverable failures and `os_log_fault` for states that indicate a bug. Interpolated objects are private by default and show as `<private>` in release logs; write `%{public}@` only for values that carry no user data. No `NSLog`: it is slower and has no levels or privacy.

## Concurrency

GCD and blocks. Work that can block (file or network I/O, parsing) runs on a global queue; the result is delivered on the main queue, and that is part of the service's contract (`APPGreetingService`). UIKit is touched only on the main queue.

A block stored or run later captures `self` weakly: `__weak typeof(self) weakSelf = self;` outside, `__strong typeof(weakSelf) strongSelf = weakSelf;` and a nil check inside. `-Wimplicit-retain-self` flags an ivar used inside a block, which captures `self` strongly without saying so; use the property or the strong local.

## Swift interop

The `App` target compiles one Swift file to show the seam a mixed codebase uses:

- Swift sees Objective-C through `App/App-Bridging-Header.h`. Import only the headers Swift needs.
- Objective-C sees Swift through the generated `App-Swift.h`, imported in `.m` files only (never in a header, which would make the header depend on a Swift build). Only `@objc` declarations on `NSObject` subclasses appear in it; `@objc(APPGreetingFormatter)` keeps the Objective-C class name prefixed.
- The module name is fixed at `App` (`PRODUCT_MODULE_NAME`), so the generated header's name doesn't change with the product name.

`make lint` runs `swift-format lint --strict` over Swift files and Swift warnings are errors too. If the project should stay pure Objective-C, delete `GreetingFormatter.swift`, the bridging header, the `SWIFT_OBJC_BRIDGING_HEADER` setting and the `App-Swift.h` import, and build the headline in Objective-C.

## Formatting

`clang-format` with the shipped `.clang-format` (LLVM base, 4-space indent, 120 columns). `make format` rewrites, `make format-check` fails on drift. `swift-format` with its defaults formats Swift.

## Tooling

XcodeBuildMCP is an optional MCP server that lets an agent build, run and screenshot the app in a simulator. The project doesn't need it: every check runs through `make`.
