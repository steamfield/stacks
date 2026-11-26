#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// The payload: an immutable value parsed from JSON of the form
/// `{"message": "Hello", "recipient": "world"}`.
@interface APPGreeting : NSObject

@property (nonatomic, copy, readonly) NSString *message;
@property (nonatomic, copy, readonly) NSString *recipient;

- (instancetype)initWithMessage:(NSString *)message recipient:(NSString *)recipient NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;

/// Parses and validates JSON data. Returns nil with APPErrorCodePayloadMalformed
/// when the data isn't an object with non-empty string `message` and `recipient`.
+ (nullable instancetype)greetingWithJSONData:(NSData *)data error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
