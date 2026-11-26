#import "APPLog.h"

static os_log_t APPLogMake(const char *category) {
    NSString *subsystem = [NSBundle mainBundle].bundleIdentifier ?: @"app";
    return os_log_create(subsystem.UTF8String, category);
}

os_log_t APPLogApp(void) {
    static os_log_t log;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        log = APPLogMake("app");
    });
    return log;
}

os_log_t APPLogConfig(void) {
    static os_log_t log;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        log = APPLogMake("config");
    });
    return log;
}

os_log_t APPLogGreeting(void) {
    static os_log_t log;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        log = APPLogMake("greeting");
    });
    return log;
}
