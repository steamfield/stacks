#import "APPGreeting.h"

#import "APPError.h"

static NSString *_Nullable APPNonEmptyString(NSDictionary<NSString *, id> *object, NSString *key) {
    id value = object[key];
    if (![value isKindOfClass:[NSString class]] || [(NSString *)value length] == 0) {
        return nil;
    }
    return value;
}

@implementation APPGreeting

- (instancetype)initWithMessage:(NSString *)message recipient:(NSString *)recipient {
    self = [super init];
    if (self) {
        _message = [message copy];
        _recipient = [recipient copy];
    }
    return self;
}

+ (nullable instancetype)greetingWithJSONData:(NSData *)data error:(NSError **)error {
    NSError *parseError = nil;
    id object = [NSJSONSerialization JSONObjectWithData:data options:0 error:&parseError];
    if (![object isKindOfClass:[NSDictionary class]]) {
        if (error != NULL) {
            *error = APPErrorMake(APPErrorCodePayloadMalformed, @"greeting JSON is not an object", parseError);
        }
        return nil;
    }
    NSDictionary<NSString *, id> *fields = object;
    NSString *message = APPNonEmptyString(fields, @"message");
    NSString *recipient = APPNonEmptyString(fields, @"recipient");
    if (message == nil || recipient == nil) {
        if (error != NULL) {
            *error = APPErrorMake(APPErrorCodePayloadMalformed,
                                  @"greeting JSON needs non-empty string message and recipient", nil);
        }
        return nil;
    }
    return [[self alloc] initWithMessage:message recipient:recipient];
}

@end
