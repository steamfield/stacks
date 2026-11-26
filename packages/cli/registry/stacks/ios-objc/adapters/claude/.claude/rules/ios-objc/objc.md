---
paths:
  - "App/**/*.h"
  - "App/**/*.m"
  - "AppTests/**/*.h"
  - "AppTests/**/*.m"
---

# Objective-C rules

- Every header wraps its declarations in `NS_ASSUME_NONNULL_BEGIN`/`END`; mark what can be nil `nullable` (or `_Nullable` inside block and pointer types). Never return nil from a method the header calls nonnull.
- A class with required state declares one `NS_DESIGNATED_INITIALIZER` and marks `init` and `new` `NS_UNAVAILABLE` (view controllers also `initWithNibName:bundle:` and `initWithCoder:`). Public properties are `readonly`; `copy` for NSString, blocks and collections.
- Collections carry lightweight generics (`NSArray<APPGreeting *> *`, `NSDictionary<NSString *, id> *`).
- Failures return `nil` or `NO` and set `NSError **` from `APPErrorMake` with an `APPErrorCode`. Check `error != NULL` before writing it. A new failure gets a new code at the end of the enum and a case in `+[APPUserMessage messageForError:]`.
- Class names start with `APP`. Swift-facing names stay readable: add `NS_SWIFT_NAME` when the imported name is awkward.
- Log with `os_log` through the `APPLog*()` handles; `%{public}@` only for values without user data. No `NSLog`.
- Warnings are errors and the analyzer must stay clean. Never lower a setting in `Config/Shared.xcconfig`; a warning that is wrong for one line gets a `#pragma clang diagnostic` push/ignored/pop with a comment saying why.
- Blocks that outlive the call capture `self` weakly (`__weak typeof(self) weakSelf`, then a strong local and a nil check). UIKit is touched only on the main queue.

Reasons and examples: [docs/guidance/objc.md](../../../docs/guidance/objc.md).
