#import "APPBundledGreetingService.h"

#import "APPError.h"
#import "APPGreeting.h"
#import "APPLog.h"

@interface APPBundledGreetingService ()
@property (nonatomic, strong, readonly) NSBundle *bundle;
@property (nonatomic, copy, readonly) NSString *resourceName;
@end

@implementation APPBundledGreetingService

- (instancetype)initWithBundle:(NSBundle *)bundle resourceName:(NSString *)resourceName {
    self = [super init];
    if (self) {
        _bundle = bundle;
        _resourceName = [resourceName copy];
    }
    return self;
}

- (void)loadGreetingWithCompletion:(APPGreetingCompletion)completion {
    NSBundle *bundle = self.bundle;
    NSString *resourceName = self.resourceName;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSError *error = nil;
        APPGreeting *greeting = [APPBundledGreetingService readGreetingNamed:resourceName
                                                                  fromBundle:bundle
                                                                       error:&error];
        if (greeting == nil) {
            os_log_error(APPLogGreeting(), "load failed: %{public}@", error.userInfo[NSDebugDescriptionErrorKey]);
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            completion(greeting, greeting == nil ? error : nil);
        });
    });
}

+ (nullable APPGreeting *)readGreetingNamed:(NSString *)name fromBundle:(NSBundle *)bundle error:(NSError **)error {
    NSURL *url = [bundle URLForResource:name withExtension:@"json"];
    if (url == nil) {
        if (error != NULL) {
            *error = APPErrorMake(APPErrorCodePayloadUnavailable,
                                  [NSString stringWithFormat:@"no %@.json in the bundle", name], nil);
        }
        return nil;
    }
    NSError *readError = nil;
    NSData *data = [NSData dataWithContentsOfURL:url options:0 error:&readError];
    if (data == nil) {
        if (error != NULL) {
            *error = APPErrorMake(APPErrorCodePayloadUnavailable,
                                  [NSString stringWithFormat:@"%@.json could not be read", name], readError);
        }
        return nil;
    }
    return [APPGreeting greetingWithJSONData:data error:error];
}

@end
