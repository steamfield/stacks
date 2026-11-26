#import "APPStubGreetingService.h"

#import "APPGreeting.h"

@interface APPStubGreetingService ()
@property (nonatomic, strong, readonly) NSMutableArray<id> *results;
@property (nonatomic, assign, readwrite) NSUInteger loadCount;
@end

@implementation APPStubGreetingService

- (instancetype)init {
    self = [super init];
    if (self) {
        _results = [NSMutableArray array];
    }
    return self;
}

- (void)enqueueGreeting:(APPGreeting *)greeting {
    [self.results addObject:greeting];
}

- (void)enqueueError:(NSError *)error {
    [self.results addObject:error];
}

- (void)loadGreetingWithCompletion:(APPGreetingCompletion)completion {
    self.loadCount += 1;
    id result = self.results.firstObject;
    NSAssert(result != nil, @"APPStubGreetingService: no result queued for load %lu", (unsigned long)self.loadCount);
    [self.results removeObjectAtIndex:0];
    if ([result isKindOfClass:[APPGreeting class]]) {
        completion(result, nil);
    } else {
        completion(nil, result);
    }
}

@end
