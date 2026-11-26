#import <XCTest/XCTest.h>

#import "APPError.h"
#import "APPGreeting.h"
#import "APPGreetingViewController.h"
#import "APPStubGreetingService.h"

@interface APPGreetingViewControllerTests : XCTestCase
@property (nonatomic, strong) APPStubGreetingService *service;
@property (nonatomic, strong) APPGreetingViewController *controller;
@end

@implementation APPGreetingViewControllerTests

- (void)setUp {
    [super setUp];
    self.service = [[APPStubGreetingService alloc] init];
    self.controller = [[APPGreetingViewController alloc] initWithService:self.service];
}

- (nullable __kindof UIView *)viewWithIdentifier:(NSString *)identifier {
    NSMutableArray<UIView *> *pending = [NSMutableArray arrayWithObject:self.controller.view];
    while (pending.count > 0) {
        UIView *view = pending.lastObject;
        [pending removeLastObject];
        if ([view.accessibilityIdentifier isEqualToString:identifier]) {
            return view;
        }
        [pending addObjectsFromArray:view.subviews];
    }
    return nil;
}

- (void)testShowsTheGreetingThroughTheSwiftFormatter {
    [self.service enqueueGreeting:[[APPGreeting alloc] initWithMessage:@"Hi" recipient:@"Ada"]];

    [self.controller loadViewIfNeeded];

    UILabel *headline = [self viewWithIdentifier:APPGreetingHeadlineIdentifier];
    XCTAssertEqual(self.controller.state, APPGreetingViewStateContent);
    XCTAssertEqualObjects(headline.text, @"Hi, Ada!");
    XCTAssertFalse(headline.hidden);
    XCTAssertTrue([self viewWithIdentifier:APPGreetingRetryIdentifier].hidden);
}

- (void)testARetryableErrorShowsTheMessageAndRetryButton {
    [self.service enqueueError:APPErrorMake(APPErrorCodePayloadUnavailable, @"offline", nil)];

    [self.controller loadViewIfNeeded];

    UILabel *message = [self viewWithIdentifier:APPGreetingErrorIdentifier];
    XCTAssertEqual(self.controller.state, APPGreetingViewStateFailed);
    NSString *expected =
        [APPUserMessage messageForError:APPErrorMake(APPErrorCodePayloadUnavailable, @"", nil)].message;
    XCTAssertEqualObjects(message.text, expected);
    XCTAssertFalse([self viewWithIdentifier:APPGreetingRetryIdentifier].hidden);
    XCTAssertTrue([self viewWithIdentifier:APPGreetingHeadlineIdentifier].hidden);
}

- (void)testAPermanentErrorHidesRetry {
    [self.service enqueueError:APPErrorMake(APPErrorCodePayloadMalformed, @"bad shape", nil)];

    [self.controller loadViewIfNeeded];

    XCTAssertEqual(self.controller.state, APPGreetingViewStateFailed);
    XCTAssertTrue([self viewWithIdentifier:APPGreetingRetryIdentifier].hidden);
}

- (void)testRetryLoadsAgainAndRecovers {
    [self.service enqueueError:APPErrorMake(APPErrorCodePayloadUnavailable, @"offline", nil)];
    [self.service enqueueGreeting:[[APPGreeting alloc] initWithMessage:@"Hello" recipient:@"again"]];
    [self.controller loadViewIfNeeded];

    UIButton *retry = [self viewWithIdentifier:APPGreetingRetryIdentifier];
    [retry sendActionsForControlEvents:UIControlEventPrimaryActionTriggered];

    XCTAssertEqual(self.service.loadCount, 2U);
    XCTAssertEqual(self.controller.state, APPGreetingViewStateContent);
    XCTAssertEqualObjects([[self viewWithIdentifier:APPGreetingHeadlineIdentifier] text], @"Hello, again!");
}

@end
