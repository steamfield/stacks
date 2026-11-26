import SwiftUI

/// The entry point. It reads the configuration once and shows the first screen, or the
/// configuration error when the build's settings are invalid.
@main
struct MainApp: App {
    private let launch = Launch.start(info: Bundle.main.infoDictionary ?? [:])

    var body: some Scene {
        WindowGroup {
            switch launch {
            case .ready(let model):
                GreetingScreen(model: model)
            case .failed(let error):
                ErrorView(error: error, retry: nil)
            }
        }
    }
}

/// The composition root: the one place that builds services and view models from the config.
enum Launch {
    case ready(GreetingViewModel)
    case failed(AppError)

    @MainActor
    static func start(info: [String: Any]) -> Launch {
        do {
            let config = try AppConfig(info: info)
            Log.app.info(
                "launch environment=\(config.environment.rawValue, privacy: .public)"
            )
            return .ready(GreetingViewModel(service: LocalGreetingService(config: config)))
        } catch {
            Log.app.error("launch failed: \(error.logDescription, privacy: .public)")
            return .failed(error)
        }
    }
}
