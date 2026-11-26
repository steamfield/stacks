#import <XCTest/XCTest.h>

#import "APPError.h"

@interface APPErrorTests : XCTestCase
@end

@implementation APPErrorTests

- (void)testErrorCarriesDomainCodeReasonAndCause {
    NSError *cause = [NSError errorWithDomain:NSCocoaErrorDomain code:NSFileReadNoSuchFileError userInfo:nil];

    NSError *error = APPErrorMake(APPErrorCodePayloadUnavailable, @"no file", cause);

    XCTAssertEqualObjects(error.domain, APPErrorDomain);
    XCTAssertEqual(error.code, APPErrorCodePayloadUnavailable);
    XCTAssertEqualObjects(error.userInfo[NSDebugDescriptionErrorKey], @"no file");
    XCTAssertEqualObjects(error.userInfo[NSUnderlyingErrorKey], cause);
}

- (void)testUnavailablePayloadIsRetryable {
    APPUserMessage *message = [APPUserMessage messageForError:APPErrorMake(APPErrorCodePayloadUnavailable, @"x", nil)];

    XCTAssertTrue(message.isRetryable);
    XCTAssertTrue([message.message containsString:@"Try again"]);
}

- (void)testMalformedPayloadAndBadConfigurationAreNotRetryable {
    XCTAssertFalse([APPUserMessage messageForError:APPErrorMake(APPErrorCodePayloadMalformed, @"x", nil)].isRetryable);
    XCTAssertFalse(
        [APPUserMessage messageForError:APPErrorMake(APPErrorCodeInvalidConfiguration, @"x", nil)].isRetryable);
}

- (void)testTheReasonNeverReachesTheUser {
    APPUserMessage *message =
        [APPUserMessage messageForError:APPErrorMake(APPErrorCodePayloadMalformed, @"field recipient missing", nil)];

    XCTAssertFalse([message.message containsString:@"recipient"]);
}

- (void)testForeignAndUnknownErrorsGetTheGenericMessage {
    NSError *timeout = [NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorTimedOut userInfo:nil];
    NSError *newerCode = [NSError errorWithDomain:APPErrorDomain code:999 userInfo:nil];

    APPUserMessage *foreign = [APPUserMessage messageForError:timeout];
    APPUserMessage *unknown = [APPUserMessage messageForError:newerCode];

    XCTAssertTrue(foreign.isRetryable);
    XCTAssertEqualObjects(foreign.message, unknown.message);
}

@end
