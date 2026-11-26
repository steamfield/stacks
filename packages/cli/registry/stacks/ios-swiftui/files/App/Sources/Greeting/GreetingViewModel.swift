import OSLog
import Observation

/// State for the greeting screen. It owns the load and its failure; the view only renders
/// `state` and calls `load()`.
@MainActor
@Observable
final class GreetingViewModel {
    enum State: Equatable {
        case idle
        case loading
        case loaded(Greeting)
        case failed(AppError)
    }

    private(set) var state: State = .idle
    private let service: any GreetingService

    init(service: any GreetingService) {
        self.service = service
    }

    func load() async {
        guard state != .loading else { return }
        state = .loading
        do {
            let greeting = try await service.greeting()
            state = .loaded(greeting)
            Log.greeting.info(
                "loaded environment=\(greeting.environment.rawValue, privacy: .public)"
            )
        } catch {
            state = .failed(error)
            Log.greeting.error("load failed: \(error.logDescription, privacy: .public)")
        }
    }
}
