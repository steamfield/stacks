/// Every failure the app shows or logs. A new failure is a new case with its user message,
/// whether a retry can help, and a log description.
enum AppError: Error, Equatable, Sendable {
    /// A setting in Info.plist is present but invalid. Only a new build fixes it.
    case invalidConfiguration(key: String, value: String)
    /// A service couldn't produce its payload. Trying again may work.
    case unavailable(reason: String)

    /// What the screen says. Never includes keys, values or reasons: those go to the log.
    var userMessage: String {
        switch self {
        case .invalidConfiguration:
            "This build of the app is misconfigured. Install an updated version."
        case .unavailable:
            "Couldn't load this right now. Check your connection and try again."
        }
    }

    var isRetryable: Bool {
        switch self {
        case .invalidConfiguration: false
        case .unavailable: true
        }
    }

    /// What the log says, with the detail the user message leaves out.
    var logDescription: String {
        switch self {
        case .invalidConfiguration(let key, let value):
            "invalid_configuration key=\(key) value=\(value)"
        case .unavailable(let reason):
            "unavailable reason=\(reason)"
        }
    }
}
