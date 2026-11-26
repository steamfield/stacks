// The AppInfo Turbo Module's Objective-C class. The header stays free of C++ so the pod's
// module map imports cleanly from Swift (tests included); the codegen protocol conformance
// lives in RCTAppInfo.mm.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface RCTAppInfo : NSObject
@end

NS_ASSUME_NONNULL_END
