#import <Foundation/Foundation.h>

#import "APPGreetingService.h"

NS_ASSUME_NONNULL_BEGIN

/// Answers every load with the same error. APPSceneDelegate gives it to the screen when
/// APPConfig rejects a setting, so the user sees that error's APPUserMessage instead of
/// an app quietly running on defaults.
@interface APPFailedGreetingService : NSObject <APPGreetingService>

@property (nonatomic, strong, readonly) NSError *error;

- (instancetype)initWithError:(NSError *)error NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;

@end

NS_ASSUME_NONNULL_END
