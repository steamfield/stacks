// Objective-C++ glue for the AppInfo Turbo Module. Codegen generates NativeAppInfoSpec from
// src/NativeAppInfo.ts; this class conforms to it, hands the work to the Swift AppInfoReader,
// and returns the JSI binding React Native calls. Logic belongs in Swift, not here.
#import "RCTAppInfo.h"

#import <AppInfoSpec/AppInfoSpec.h>

#if __has_include(<AppInfo/AppInfo-Swift.h>)
#import <AppInfo/AppInfo-Swift.h>
#else
#import "AppInfo-Swift.h"
#endif

@interface RCTAppInfo () <NativeAppInfoSpec>
@end

@implementation RCTAppInfo

+ (NSString *)moduleName
{
  return @"AppInfo";
}

- (void)getAppInfo:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSError *error = nil;
  NSDictionary<NSString *, NSString *> *info = [[AppInfoReader current] readAndReturnError:&error];
  if (info == nil) {
    reject(AppInfoReader.missingKeyCode, error.localizedDescription, error);
    return;
  }
  resolve(info);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeAppInfoSpecJSI>(params);
}

@end
