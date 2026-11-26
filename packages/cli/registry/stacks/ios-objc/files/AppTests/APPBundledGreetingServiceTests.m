#import <XCTest/XCTest.h>

#import "APPBundledGreetingService.h"
#import "APPError.h"
#import "APPGreeting.h"

@interface APPBundledGreetingServiceTests : XCTestCase
@end

@implementation APPBundledGreetingServiceTests

/// Loads through the real service and waits for its main-queue completion.
- (void)loadResource:(NSString *)name
            inBundle:(NSBundle *)bundle
            greeting:(APPGreeting *_Nullable *_Nonnull)greeting
               error:(NSError *_Nullable *_Nonnull)error {
    APPBundledGreetingService *service = [[APPBundledGreetingService alloc] initWithBundle:bundle resourceName:name];
    XCTestExpectation *done = [self expectationWithDescription:@"completion"];
    __block APPGreeting *loaded = nil;
    __block NSError *failure = nil;
    [service loadGreetingWithCompletion:^(APPGreeting *_Nullable result, NSError *_Nullable loadError) {
        XCTAssertTrue(NSThread.isMainThread);
        loaded = result;
        failure = loadError;
        [done fulfill];
    }];
    [self waitForExpectations:@[ done ] timeout:5];
    *greeting = loaded;
    *error = failure;
}

- (void)testLoadsTheGreetingShippedInTheApp {
    APPGreeting *greeting = nil;
    NSError *error = nil;
    [self loadResource:@"greeting" inBundle:[NSBundle mainBundle] greeting:&greeting error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(greeting.message, @"Hello");
    XCTAssertEqualObjects(greeting.recipient, @"world");
}

- (void)testAMissingResourceIsUnavailable {
    APPGreeting *greeting = nil;
    NSError *error = nil;
    [self loadResource:@"missing" inBundle:[NSBundle mainBundle] greeting:&greeting error:&error];

    XCTAssertNil(greeting);
    XCTAssertEqualObjects(error.domain, APPErrorDomain);
    XCTAssertEqual(error.code, APPErrorCodePayloadUnavailable);
}

- (void)testAMalformedResourceIsReportedAsMalformed {
    APPGreeting *greeting = nil;
    NSError *error = nil;
    [self loadResource:@"malformed-greeting"
              inBundle:[NSBundle bundleForClass:[self class]]
              greeting:&greeting
                 error:&error];

    XCTAssertNil(greeting);
    XCTAssertEqual(error.code, APPErrorCodePayloadMalformed);
}

@end
