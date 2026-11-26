import Testing

@testable import App

struct AppErrorTests {
    @Test func configurationErrorsAreNotRetryable() {
        #expect(!AppError.invalidConfiguration(key: "k", value: "v").isRetryable)
        #expect(AppError.unavailable(reason: "offline").isRetryable)
    }

    @Test(arguments: [
        AppError.invalidConfiguration(key: "AppEnvironment", value: "secret-value"),
        AppError.unavailable(reason: "secret-reason"),
    ])
    func userMessagesLeaveDetailsToTheLog(error: AppError) {
        #expect(!error.userMessage.contains("secret"))
        #expect(error.logDescription.contains("secret"))
    }
}
