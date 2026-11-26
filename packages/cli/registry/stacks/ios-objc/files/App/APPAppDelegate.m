#import "APPAppDelegate.h"

#import "APPLog.h"
#import "APPSceneDelegate.h"

@implementation APPAppDelegate

- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(nullable NSDictionary<UIApplicationLaunchOptionsKey, id> *)launchOptions {
    os_log_info(APPLogApp(), "launched");
    return YES;
}

// The scene manifest is generated (no Info.plist file), so the delegate class is
// chosen here rather than under UISceneConfigurations.
- (UISceneConfiguration *)application:(UIApplication *)application
    configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession
                                   options:(UISceneConnectionOptions *)options {
    UISceneConfiguration *configuration = [[UISceneConfiguration alloc] initWithName:@"Default"
                                                                         sessionRole:connectingSceneSession.role];
    configuration.delegateClass = [APPSceneDelegate class];
    return configuration;
}

@end
