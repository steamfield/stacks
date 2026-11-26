#import "APPSceneDelegate.h"

#import "APPBundledGreetingService.h"
#import "APPConfig.h"
#import "APPGreetingViewController.h"
#import "APPLog.h"

@implementation APPSceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions {
    if (![scene isKindOfClass:[UIWindowScene class]]) {
        return;
    }
    APPConfig *config = [self loadConfig];
    APPBundledGreetingService *service = [[APPBundledGreetingService alloc] initWithBundle:[NSBundle mainBundle]
                                                                              resourceName:config.greetingResource];
    APPGreetingViewController *greeting = [[APPGreetingViewController alloc] initWithService:service];

    UIWindow *window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    window.rootViewController = [[UINavigationController alloc] initWithRootViewController:greeting];
    self.window = window;
    [window makeKeyAndVisible];
}

// An invalid setting is logged as a fault and the defaults are used, so a bad
// launch argument can't keep the app from starting.
- (APPConfig *)loadConfig {
    NSError *error = nil;
    APPConfig *config = [APPConfig configWithUserDefaults:[NSUserDefaults standardUserDefaults] error:&error];
    if (config != nil) {
        return config;
    }
    os_log_fault(APPLogConfig(), "invalid configuration, using defaults: %{public}@", error.localizedDescription);
    return [APPConfig defaultConfig];
}

@end
