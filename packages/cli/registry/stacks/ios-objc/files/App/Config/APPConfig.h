#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// User defaults key for the bundled JSON resource the greeting screen loads.
FOUNDATION_EXPORT NSString *const APPConfigGreetingResourceKey;

/// The app's settings, validated once at launch. Read through NSUserDefaults, so
/// precedence is registered defaults < values the app saved < launch arguments
/// (`-APPGreetingResource other`), which is how UI tests and Xcode schemes
/// override a setting. Screens and services receive values from this object and
/// never read NSUserDefaults themselves.
@interface APPConfig : NSObject

/// Name of a JSON resource in the app bundle, without the extension. Letters,
/// digits, `-` and `_` only.
@property (nonatomic, copy, readonly) NSString *greetingResource;

- (instancetype)initWithGreetingResource:(NSString *)greetingResource NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;

/// The settings with every default applied.
+ (instancetype)defaultConfig;

/// The defaults APPConfig registers, keyed by user defaults key.
+ (NSDictionary<NSString *, id> *)registeredDefaults;

/// Registers the defaults on `defaults`, reads every setting and validates it.
/// Returns nil with an APPErrorCodeInvalidConfiguration error naming the first bad setting.
+ (nullable instancetype)configWithUserDefaults:(NSUserDefaults *)defaults error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
