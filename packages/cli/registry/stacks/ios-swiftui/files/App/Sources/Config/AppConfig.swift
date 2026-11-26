import Foundation

/// Settings read once at launch from Info.plist, where project.yml's build settings fill them.
/// A missing or empty value takes its default; a value that is present but invalid is an error.
struct AppConfig: Equatable, Sendable {
    enum Environment: String, CaseIterable, Sendable {
        case development
        case staging
        case production
    }

    /// Info.plist keys, each filled from the build setting named in the comment.
    enum Key {
        /// `APP_ENVIRONMENT`
        static let environment = "AppEnvironment"
        /// `APP_GREETING_SUBJECT`
        static let greetingSubject = "AppGreetingSubject"
    }

    static let defaults = AppConfig(environment: .development, greetingSubject: "world")
    static let maxSubjectLength = 40

    let environment: Environment
    let greetingSubject: String

    init(environment: Environment, greetingSubject: String) {
        self.environment = environment
        self.greetingSubject = greetingSubject
    }

    init(info: [String: Any]) throws(AppError) {
        var environment = Self.defaults.environment
        if let raw = Self.value(in: info, for: Key.environment) {
            guard let parsed = Environment(rawValue: raw) else {
                throw .invalidConfiguration(key: Key.environment, value: raw)
            }
            environment = parsed
        }
        var subject = Self.defaults.greetingSubject
        if let raw = Self.value(in: info, for: Key.greetingSubject) {
            guard raw.count <= Self.maxSubjectLength else {
                throw .invalidConfiguration(key: Key.greetingSubject, value: raw)
            }
            subject = raw
        }
        self.init(environment: environment, greetingSubject: subject)
    }

    /// The trimmed string at `key`, or nil when it is absent or empty. A build setting that
    /// project.yml doesn't define expands to an empty string, so empty means unset.
    private static func value(in info: [String: Any], for key: String) -> String? {
        guard let raw = info[key] as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
