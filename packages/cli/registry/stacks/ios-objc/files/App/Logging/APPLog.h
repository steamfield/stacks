#import <Foundation/Foundation.h>
#import <os/log.h>

NS_ASSUME_NONNULL_BEGIN

/// One os_log handle per category, all under the app's bundle identifier as the
/// subsystem. Filter in Console.app or with
/// `xcrun simctl spawn booted log stream --predicate 'subsystem == "<bundle id>"'`.
///
/// Mark interpolated values `%{public}@` only when they hold no user data;
/// os_log redacts the rest in release builds.
FOUNDATION_EXPORT os_log_t APPLogApp(void);
FOUNDATION_EXPORT os_log_t APPLogConfig(void);
FOUNDATION_EXPORT os_log_t APPLogGreeting(void);

NS_ASSUME_NONNULL_END
