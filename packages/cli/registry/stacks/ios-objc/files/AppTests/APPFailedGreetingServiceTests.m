#import <XCTest/XCTest.h>

#import "APPError.h"
#import "APPFailedGreetingService.h"
#import "APPGreetingViewController.h"

@interface APPFailedGreetingServiceTests : XCTestCase
@end

@implementation APPFailedGreetingServiceTests

- (void)testEveryLoadFailsWithTheGivenErrorOnTheMainQueue {
    NSError *invalid = APPErrorMake(APPErrorCodeInvalidConfiguration, @"bad setting", nil);
    APPFailedGreetingService *service = [[APPFailedGreetingService alloc] initWithError:invalid];
    XCTestExpectation *done = [self expectationWithDescription:@"completion"];

    [service loadGreetingWithCompletion:^(APPGreeting *_Nullable greeting, NSError *_Nullable error) {
        XCTAssertTrue(NSThread.isMainThread);
        XCTAssertNil(greeting);
        XCTAssertEqualObjects(error, invalid);
        [done fulfill];
    }];

    [self waitForExpectations:@[ done ] timeout:5];
}

- (void)testTheScreenGivenItEndsInTheFailedState {
    NSError *invalid = APPErrorMake(APPErrorCodeInvalidConfiguration, @"bad setting", nil);
    APPGreetingViewController *controller =
        [[APPGreetingViewController alloc] initWithService:[[APPFailedGreetingService alloc] initWithError:invalid]];
    [controller loadViewIfNeeded];

    XCTestExpectation *failed = [[XCTKVOExpectation alloc] initWithKeyPath:@"state"
                                                                    object:controller
                                                             expectedValue:@(APPGreetingViewStateFailed)];
    [self waitForExpectations:@[ failed ] timeout:5];
}

@end
