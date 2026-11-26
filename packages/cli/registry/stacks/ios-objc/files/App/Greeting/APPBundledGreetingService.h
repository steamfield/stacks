#import <Foundation/Foundation.h>

#import "APPGreetingService.h"

NS_ASSUME_NONNULL_BEGIN

/// Reads the greeting from a JSON resource in a bundle. There is no network
/// backend; this is the service a remote one would replace.
@interface APPBundledGreetingService : NSObject <APPGreetingService>

- (instancetype)initWithBundle:(NSBundle *)bundle resourceName:(NSString *)resourceName NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;

@end

NS_ASSUME_NONNULL_END
