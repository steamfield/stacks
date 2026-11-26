#import "APPFailedGreetingService.h"

@implementation APPFailedGreetingService

- (instancetype)initWithError:(NSError *)error {
    self = [super init];
    if (self) {
        _error = error;
    }
    return self;
}

- (void)loadGreetingWithCompletion:(APPGreetingCompletion)completion {
    NSError *error = self.error;
    dispatch_async(dispatch_get_main_queue(), ^{
        completion(nil, error);
    });
}

@end
