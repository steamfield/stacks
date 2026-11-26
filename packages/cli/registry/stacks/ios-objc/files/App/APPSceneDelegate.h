#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Builds the window in code: loads APPConfig, wires the greeting service into
/// the first screen and shows it. This is the composition root; nothing else
/// creates services.
@interface APPSceneDelegate : UIResponder <UIWindowSceneDelegate>

@property (nonatomic, strong, nullable) UIWindow *window;

@end

NS_ASSUME_NONNULL_END
