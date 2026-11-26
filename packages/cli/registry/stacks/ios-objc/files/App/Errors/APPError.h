#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// The app's one error domain. Every failure the app creates uses it; errors
/// from Apple frameworks travel as NSUnderlyingErrorKey.
FOUNDATION_EXPORT NSErrorDomain const APPErrorDomain;

/// Codes are stable: never renumber one, add new codes at the end.
typedef NS_ERROR_ENUM(APPErrorDomain, APPErrorCode) {
    /// A setting failed validation in APPConfig.
    APPErrorCodeInvalidConfiguration = 1,
    /// The payload could not be read (missing resource, I/O failure).
    APPErrorCodePayloadUnavailable = 2,
    /// The payload was read but is not the expected shape.
    APPErrorCodePayloadMalformed = 3,
};

/// An APPErrorDomain error. `reason` is for logs and tests (NSDebugDescriptionErrorKey),
/// never shown to the user; APPUserMessage decides what the user reads.
FOUNDATION_EXPORT NSError *APPErrorMake(APPErrorCode code, NSString *reason, NSError *_Nullable underlying);

/// What a screen shows for an error: a message and whether retrying can help.
@interface APPUserMessage : NSObject

@property (nonatomic, copy, readonly) NSString *message;
@property (nonatomic, assign, readonly, getter=isRetryable) BOOL retryable;

- (instancetype)initWithMessage:(NSString *)message retryable:(BOOL)retryable NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;

/// Maps any error to user-facing text. Errors outside APPErrorDomain, and codes
/// this build doesn't know, get a generic retryable message.
+ (instancetype)messageForError:(NSError *)error;

@end

NS_ASSUME_NONNULL_END
