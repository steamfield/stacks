#import <XCTest/XCTest.h>

#import "APPError.h"
#import "APPGreeting.h"

@interface APPGreetingTests : XCTestCase
@end

@implementation APPGreetingTests

- (nullable APPGreeting *)parse:(NSString *)json error:(NSError **)error {
    NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
    return [APPGreeting greetingWithJSONData:data error:error];
}

- (void)testParsesAValidGreeting {
    NSError *error = nil;
    APPGreeting *greeting = [self parse:@"{\"message\":\"Hi\",\"recipient\":\"Ada\"}" error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(greeting.message, @"Hi");
    XCTAssertEqualObjects(greeting.recipient, @"Ada");
}

- (void)testInitializerCopiesMutableStrings {
    NSMutableString *message = [@"Hi" mutableCopy];
    APPGreeting *greeting = [[APPGreeting alloc] initWithMessage:message recipient:@"Ada"];

    [message appendString:@" there"];

    XCTAssertEqualObjects(greeting.message, @"Hi");
}

- (void)testRejectsMalformedPayloads {
    NSArray<NSString *> *payloads = @[
        @"not json",
        @"[\"Hi\", \"Ada\"]",
        @"{\"message\":\"Hi\"}",
        @"{\"message\":\"\",\"recipient\":\"Ada\"}",
        @"{\"message\":1,\"recipient\":\"Ada\"}",
    ];
    for (NSString *payload in payloads) {
        NSError *error = nil;
        XCTAssertNil([self parse:payload error:&error], @"%@", payload);
        XCTAssertEqualObjects(error.domain, APPErrorDomain, @"%@", payload);
        XCTAssertEqual(error.code, APPErrorCodePayloadMalformed, @"%@", payload);
    }
}

@end
