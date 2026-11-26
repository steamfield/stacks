#import "APPGreetingViewController.h"

#import "App-Swift.h"
#import "APPError.h"
#import "APPGreeting.h"
#import "APPLog.h"

NSString *const APPGreetingHeadlineIdentifier = @"greeting.headline";
NSString *const APPGreetingErrorIdentifier = @"greeting.error";
NSString *const APPGreetingRetryIdentifier = @"greeting.retry";

@interface APPGreetingViewController ()
@property (nonatomic, strong, readonly) id<APPGreetingService> service;
@property (nonatomic, assign, readwrite) APPGreetingViewState state;
@property (nonatomic, strong) UIActivityIndicatorView *spinner;
@property (nonatomic, strong) UILabel *headlineLabel;
@property (nonatomic, strong) UILabel *errorLabel;
@property (nonatomic, strong) UIButton *retryButton;
@end

@implementation APPGreetingViewController

- (instancetype)initWithService:(id<APPGreetingService>)service {
    self = [super initWithNibName:nil bundle:nil];
    if (self) {
        _service = service;
        _state = APPGreetingViewStateLoading;
        self.title = NSLocalizedString(@"Greeting", @"Greeting screen title");
    }
    return self;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor systemBackgroundColor];
    [self buildViews];
    [self reload];
}

- (void)buildViews {
    self.spinner = [[UIActivityIndicatorView alloc] initWithActivityIndicatorStyle:UIActivityIndicatorViewStyleLarge];

    self.headlineLabel = [self labelWithStyle:UIFontTextStyleLargeTitle identifier:APPGreetingHeadlineIdentifier];
    self.errorLabel = [self labelWithStyle:UIFontTextStyleBody identifier:APPGreetingErrorIdentifier];

    UIButtonConfiguration *retry = [UIButtonConfiguration filledButtonConfiguration];
    retry.title = NSLocalizedString(@"Try again", @"Retry button");
    self.retryButton = [UIButton buttonWithConfiguration:retry primaryAction:nil];
    self.retryButton.accessibilityIdentifier = APPGreetingRetryIdentifier;
    [self.retryButton addTarget:self
                         action:@selector(retryTapped:)
               forControlEvents:UIControlEventPrimaryActionTriggered];

    UIStackView *stack = [[UIStackView alloc]
        initWithArrangedSubviews:@[ self.spinner, self.headlineLabel, self.errorLabel, self.retryButton ]];
    stack.axis = UILayoutConstraintAxisVertical;
    stack.alignment = UIStackViewAlignmentCenter;
    stack.spacing = 16;
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:stack];

    UILayoutGuide *margins = self.view.layoutMarginsGuide;
    [NSLayoutConstraint activateConstraints:@[
        [stack.centerYAnchor constraintEqualToAnchor:margins.centerYAnchor],
        [stack.leadingAnchor constraintEqualToAnchor:margins.leadingAnchor],
        [stack.trailingAnchor constraintEqualToAnchor:margins.trailingAnchor],
    ]];
}

- (UILabel *)labelWithStyle:(UIFontTextStyle)style identifier:(NSString *)identifier {
    UILabel *label = [[UILabel alloc] init];
    label.font = [UIFont preferredFontForTextStyle:style];
    label.adjustsFontForContentSizeCategory = YES;
    label.numberOfLines = 0;
    label.textAlignment = NSTextAlignmentCenter;
    label.accessibilityIdentifier = identifier;
    return label;
}

- (void)reload {
    [self showLoading];
    __weak typeof(self) weakSelf = self;
    [self.service loadGreetingWithCompletion:^(APPGreeting *_Nullable greeting, NSError *_Nullable error) {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (strongSelf == nil) {
            return;
        }
        if (greeting != nil) {
            [strongSelf showGreeting:greeting];
            return;
        }
        NSError *failure = error ?: APPErrorMake(APPErrorCodePayloadUnavailable, @"service returned nothing", nil);
        [strongSelf showError:failure];
    }];
}

- (void)retryTapped:(UIButton *)sender {
    os_log_info(APPLogGreeting(), "retry");
    [self reload];
}

- (void)showLoading {
    self.state = APPGreetingViewStateLoading;
    [self.spinner startAnimating];
    self.spinner.hidden = NO;
    self.headlineLabel.hidden = YES;
    self.errorLabel.hidden = YES;
    self.retryButton.hidden = YES;
}

- (void)showGreeting:(APPGreeting *)greeting {
    self.state = APPGreetingViewStateContent;
    [self.spinner stopAnimating];
    self.spinner.hidden = YES;
    self.headlineLabel.text = [APPGreetingFormatter headlineForGreeting:greeting];
    self.headlineLabel.hidden = NO;
    self.errorLabel.hidden = YES;
    self.retryButton.hidden = YES;
}

- (void)showError:(NSError *)error {
    APPUserMessage *message = [APPUserMessage messageForError:error];
    self.state = APPGreetingViewStateFailed;
    [self.spinner stopAnimating];
    self.spinner.hidden = YES;
    self.headlineLabel.hidden = YES;
    self.errorLabel.text = message.message;
    self.errorLabel.hidden = NO;
    self.retryButton.hidden = !message.isRetryable;
}

@end
