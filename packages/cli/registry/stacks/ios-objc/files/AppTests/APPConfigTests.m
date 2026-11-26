#import <XCTest/XCTest.h>

#import "APPConfig.h"
#import "APPError.h"

@interface APPConfigTests : XCTestCase
@property (nonatomic, copy) NSString *suiteName;
@property (nonatomic, strong) NSUserDefaults *defaults;
@end

@implementation APPConfigTests

- (void)setUp {
    [super setUp];
    self.suiteName = [NSString stringWithFormat:@"APPConfigTests.%@", [NSUUID UUID].UUIDString];
    self.defaults = [[NSUserDefaults alloc] initWithSuiteName:self.suiteName];
}

- (void)tearDown {
    [self.defaults removePersistentDomainForName:self.suiteName];
    [super tearDown];
}

- (void)testDefaultsApplyWhenNothingIsSet {
    NSError *error = nil;
    APPConfig *config = [APPConfig configWithUserDefaults:self.defaults error:&error];

    XCTAssertNil(error);
    XCTAssertEqualObjects(config.greetingResource, [APPConfig defaultConfig].greetingResource);
    XCTAssertEqualObjects(config.greetingResource, APPConfig.registeredDefaults[APPConfigGreetingResourceKey]);
}

- (void)testAStoredValueOverridesTheDefault {
    [self.defaults setObject:@"holiday-greeting" forKey:APPConfigGreetingResourceKey];

    APPConfig *config = [APPConfig configWithUserDefaults:self.defaults error:NULL];

    XCTAssertEqualObjects(config.greetingResource, @"holiday-greeting");
}

- (void)testRejectsAResourceNameWithAPath {
    [self.defaults setObject:@"../secrets" forKey:APPConfigGreetingResourceKey];

    NSError *error = nil;
    APPConfig *config = [APPConfig configWithUserDefaults:self.defaults error:&error];

    XCTAssertNil(config);
    XCTAssertEqualObjects(error.domain, APPErrorDomain);
    XCTAssertEqual(error.code, APPErrorCodeInvalidConfiguration);
    XCTAssertTrue([error.userInfo[NSDebugDescriptionErrorKey] containsString:APPConfigGreetingResourceKey]);
}

- (void)testRejectsANonStringValue {
    [self.defaults setObject:@42 forKey:APPConfigGreetingResourceKey];

    NSError *error = nil;
    XCTAssertNil([APPConfig configWithUserDefaults:self.defaults error:&error]);
    XCTAssertEqual(error.code, APPErrorCodeInvalidConfiguration);
}

@end
