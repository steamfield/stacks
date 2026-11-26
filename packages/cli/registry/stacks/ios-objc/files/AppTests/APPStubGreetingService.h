#import <Foundation/Foundation.h>

#import "APPGreetingService.h"

@class APPGreeting;

NS_ASSUME_NONNULL_BEGIN

/// Test double: answers every load synchronously with the queued results, in order.
@interface APPStubGreetingService : NSObject <APPGreetingService>

@property (nonatomic, assign, readonly) NSUInteger loadCount;

- (void)enqueueGreeting:(APPGreeting *)greeting;
- (void)enqueueError:(NSError *)error;

@end

NS_ASSUME_NONNULL_END
