import Testing

@testable import App

struct AppConfigTests {
    @Test func missingKeysTakeDefaults() throws {
        #expect(try AppConfig(info: [:]) == .defaults)
    }

    @Test func emptyValuesTakeDefaults() throws {
        let info = [AppConfig.Key.environment: "", AppConfig.Key.greetingSubject: "  "]
        #expect(try AppConfig(info: info) == .defaults)
    }

    @Test func readsEveryKey() throws {
        let info = [AppConfig.Key.environment: "staging", AppConfig.Key.greetingSubject: "team"]
        let config = try AppConfig(info: info)
        #expect(config == AppConfig(environment: .staging, greetingSubject: "team"))
    }

    @Test(arguments: ["prod", "Production", "test"])
    func rejectsAnUnknownEnvironment(value: String) {
        #expect(throws: AppError.invalidConfiguration(key: AppConfig.Key.environment, value: value)) {
            try AppConfig(info: [AppConfig.Key.environment: value])
        }
    }

    @Test func rejectsASubjectOverTheLimit() {
        let long = String(repeating: "x", count: AppConfig.maxSubjectLength + 1)
        #expect(throws: AppError.invalidConfiguration(key: AppConfig.Key.greetingSubject, value: long)) {
            try AppConfig(info: [AppConfig.Key.greetingSubject: long])
        }
    }
}
