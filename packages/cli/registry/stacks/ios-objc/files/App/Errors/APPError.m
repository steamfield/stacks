#import "APPError.h"

NSErrorDomain const APPErrorDomain = @"APPErrorDomain";

NSError *APPErrorMake(APPErrorCode code, NSString *reason, NSError *_Nullable underlying) {
    NSMutableDictionary<NSErrorUserInfoKey, id> *userInfo =
        [NSMutableDictionary dictionaryWithObject:reason forKey:NSDebugDescriptionErrorKey];
    if (underlying != nil) {
        userInfo[NSUnderlyingErrorKey] = underlying;
    }
    return [NSError errorWithDomain:APPErrorDomain code:code userInfo:userInfo];
}

@implementation APPUserMessage

- (instancetype)initWithMessage:(NSString *)message retryable:(BOOL)retryable {
    self = [super init];
    if (self) {
        _message = [message copy];
        _retryable = retryable;
    }
    return self;
}

+ (instancetype)messageForError:(NSError *)error {
    if ([error.domain isEqualToString:APPErrorDomain]) {
        switch ((APPErrorCode)error.code) {
        case APPErrorCodeInvalidConfiguration: {
            NSString *text = NSLocalizedString(@"The app's settings are invalid. Reinstall the app.",
                                               @"Invalid configuration message");
            return [[self alloc] initWithMessage:text retryable:NO];
        }
        case APPErrorCodePayloadUnavailable: {
            NSString *text =
                NSLocalizedString(@"The greeting couldn't be loaded. Try again.", @"Payload unavailable message");
            return [[self alloc] initWithMessage:text retryable:YES];
        }
        case APPErrorCodePayloadMalformed: {
            NSString *text =
                NSLocalizedString(@"The greeting is damaged and can't be shown.", @"Payload malformed message");
            return [[self alloc] initWithMessage:text retryable:NO];
        }
        }
    }
    NSString *text = NSLocalizedString(@"Something went wrong. Try again.", @"Unknown error message");
    return [[self alloc] initWithMessage:text retryable:YES];
}

@end
