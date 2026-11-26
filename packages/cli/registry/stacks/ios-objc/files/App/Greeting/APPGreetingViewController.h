#import <UIKit/UIKit.h>

#import "APPGreetingService.h"

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, APPGreetingViewState) {
    APPGreetingViewStateLoading,
    APPGreetingViewStateContent,
    APPGreetingViewStateFailed,
};

/// Accessibility identifiers the UI tests query.
FOUNDATION_EXPORT NSString *const APPGreetingHeadlineIdentifier;
FOUNDATION_EXPORT NSString *const APPGreetingErrorIdentifier;
FOUNDATION_EXPORT NSString *const APPGreetingRetryIdentifier;

/// The one screen: loads a greeting through its service on appearance and shows
/// a spinner, the greeting, or an error with a retry button when retrying can help.
@interface APPGreetingViewController : UIViewController

@property (nonatomic, assign, readonly) APPGreetingViewState state;

- (instancetype)initWithService:(id<APPGreetingService>)service NS_DESIGNATED_INITIALIZER;
- (instancetype)initWithNibName:(nullable NSString *)nibNameOrNil
                         bundle:(nullable NSBundle *)nibBundleOrNil NS_UNAVAILABLE;
- (nullable instancetype)initWithCoder:(NSCoder *)coder NS_UNAVAILABLE;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;

/// Starts a load, replacing whatever the screen shows with the spinner.
- (void)reload;

@end

NS_ASSUME_NONNULL_END
