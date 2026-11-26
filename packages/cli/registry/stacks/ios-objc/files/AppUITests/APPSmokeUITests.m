#import <XCTest/XCTest.h>

/// Launches the built app in the simulator. Identifiers match
/// APPGreetingViewController's; UI tests can't import app code.
@interface APPSmokeUITests : XCTestCase
@end

@implementation APPSmokeUITests

- (void)setUp {
    [super setUp];
    self.continueAfterFailure = NO;
}

- (void)testShowsTheBundledGreeting {
    XCUIApplication *app = [[XCUIApplication alloc] init];
    [app launch];

    XCUIElement *headline = app.staticTexts[@"greeting.headline"];
    XCTAssertTrue([headline waitForExistenceWithTimeout:15]);
    XCTAssertEqualObjects(headline.label, @"Hello, world!");

    // Labels, contrast, Dynamic Type and clipped text on the loaded screen.
    NSError *error = nil;
    XCTAssertTrue([app performAccessibilityAuditWithAuditTypes:XCUIAccessibilityAuditTypeAll
                                                  issueHandler:nil
                                                         error:&error],
                  @"%@", error);
}

- (void)testAMissingPayloadShowsTheErrorAndRetry {
    XCUIApplication *app = [[XCUIApplication alloc] init];
    // A launch argument overrides the APPGreetingResource user default (APPConfig).
    app.launchArguments = @[ @"-APPGreetingResource", @"missing" ];
    [app launch];

    XCTAssertTrue([app.staticTexts[@"greeting.error"] waitForExistenceWithTimeout:15]);
    XCTAssertTrue(app.buttons[@"greeting.retry"].exists);
}

- (void)testAnInvalidSettingShowsTheErrorWithoutRetry {
    XCUIApplication *app = [[XCUIApplication alloc] init];
    // APPConfig rejects a resource name with a path, so the screen shows the config error.
    app.launchArguments = @[ @"-APPGreetingResource", @"../greeting" ];
    [app launch];

    XCTAssertTrue([app.staticTexts[@"greeting.error"] waitForExistenceWithTimeout:15]);
    XCTAssertFalse(app.buttons[@"greeting.retry"].exists);
}

@end
