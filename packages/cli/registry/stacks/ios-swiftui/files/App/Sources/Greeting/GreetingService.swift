/// The payload the first screen shows.
struct Greeting: Equatable, Sendable {
    let message: String
    let environment: AppConfig.Environment
}

/// Where the greeting comes from. View models depend on this protocol, never on an
/// implementation, so tests and previews pass their own.
protocol GreetingService: Sendable {
    func greeting() async throws(AppError) -> Greeting
}

/// Builds the greeting from the config, on the device. A networked implementation replaces it
/// in `Launch.start` without touching the view model.
struct LocalGreetingService: GreetingService {
    let config: AppConfig

    func greeting() async throws(AppError) -> Greeting {
        Greeting(message: "Hello, \(config.greetingSubject)!", environment: config.environment)
    }
}
