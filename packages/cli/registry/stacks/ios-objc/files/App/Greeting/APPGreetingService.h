#import <Foundation/Foundation.h>

@class APPGreeting;

NS_ASSUME_NONNULL_BEGIN

/// Exactly one of `greeting` and `error` is non-nil.
typedef void (^APPGreetingCompletion)(APPGreeting *_Nullable greeting, NSError *_Nullable error);

/// Where the greeting screen gets its payload. Screens depend on this protocol,
/// never on a concrete service, so tests pass a stub and a network-backed
/// service can replace the bundled one without touching the screen.
@protocol APPGreetingService <NSObject>

/// Loads the greeting off the main thread and calls `completion` once, on the main queue.
- (void)loadGreetingWithCompletion:(APPGreetingCompletion)completion;

@end

NS_ASSUME_NONNULL_END
