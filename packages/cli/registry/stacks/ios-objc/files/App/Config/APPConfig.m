#import "APPConfig.h"

#import "APPError.h"

NSString *const APPConfigGreetingResourceKey = @"APPGreetingResource";

static NSString *const APPDefaultGreetingResource = @"greeting";

@implementation APPConfig

- (instancetype)initWithGreetingResource:(NSString *)greetingResource {
    self = [super init];
    if (self) {
        _greetingResource = [greetingResource copy];
    }
    return self;
}

+ (instancetype)defaultConfig {
    return [[self alloc] initWithGreetingResource:APPDefaultGreetingResource];
}

+ (NSDictionary<NSString *, id> *)registeredDefaults {
    return @{APPConfigGreetingResourceKey : APPDefaultGreetingResource};
}

+ (nullable instancetype)configWithUserDefaults:(NSUserDefaults *)defaults error:(NSError **)error {
    [defaults registerDefaults:[self registeredDefaults]];

    id resource = [defaults objectForKey:APPConfigGreetingResourceKey];
    if (![self isValidResourceName:resource]) {
        if (error != NULL) {
            *error = APPErrorMake(APPErrorCodeInvalidConfiguration,
                                  [NSString stringWithFormat:@"%@ must be a resource name of letters, digits, - or _",
                                                             APPConfigGreetingResourceKey],
                                  nil);
        }
        return nil;
    }
    return [[self alloc] initWithGreetingResource:resource];
}

+ (BOOL)isValidResourceName:(nullable id)value {
    if (![value isKindOfClass:[NSString class]] || [(NSString *)value length] == 0) {
        return NO;
    }
    NSMutableCharacterSet *allowed = [NSMutableCharacterSet alphanumericCharacterSet];
    [allowed addCharactersInString:@"-_"];
    return [(NSString *)value rangeOfCharacterFromSet:allowed.invertedSet].location == NSNotFound;
}

@end
