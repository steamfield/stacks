#import "APPSceneDelegate.h"

#import "APPBundledGreetingService.h"
#import "APPConfig.h"
#import "APPError.h"
#import "APPFailedGreetingService.h"
#import "APPGreetingViewController.h"
#import "APPLog.h"

@implementation APPSceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions {
    if (![scene isKindOfClass:[UIWindowScene class]]) {
        return;
    }
    APPGreetingViewController *greeting = [[APPGreetingViewController alloc] initWithService:[self makeService]];

    UIWindow *window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    window.rootViewController = [[UINavigationController alloc] initWithRootViewController:greeting];
    self.window = window;
    [window makeKeyAndVisible];
}

// An invalid setting is logged as a fault and shown on the screen as its APPUserMessage;
// the app never runs on defaults it silently swapped in.
- (id<APPGreetingService>)makeService {
    NSError *error = nil;
    APPConfig *config = [APPConfig configWithUserDefaults:[NSUserDefaults standardUserDefaults] error:&error];
    if (config == nil) {
        os_log_fault(APPLogConfig(), "invalid configuration: %{public}@", error.userInfo[NSDebugDescriptionErrorKey]);
        NSError *failure = error ?: APPErrorMake(APPErrorCodeInvalidConfiguration, @"config returned nothing", nil);
        return [[APPFailedGreetingService alloc] initWithError:failure];
    }
    return [[APPBundledGreetingService alloc] initWithBundle:[NSBundle mainBundle]
                                                resourceName:config.greetingResource];
}

@end
