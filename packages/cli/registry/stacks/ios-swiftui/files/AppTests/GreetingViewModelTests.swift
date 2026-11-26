import Testing

@testable import App

/// Returns the queued results in order, then repeats the last one.
private actor StubGreetingService: GreetingService {
    private var results: [Result<Greeting, AppError>]

    init(_ results: Result<Greeting, AppError>...) {
        self.results = results
    }

    func greeting() async throws(AppError) -> Greeting {
        let next = results.count > 1 ? results.removeFirst() : results[0]
        return try next.get()
    }
}

@MainActor
struct GreetingViewModelTests {
    private let hello = Greeting(message: "Hello, test!", environment: .development)

    @Test func startsIdle() {
        let model = GreetingViewModel(service: StubGreetingService(.success(hello)))
        #expect(model.state == .idle)
    }

    @Test func loadShowsTheGreeting() async {
        let model = GreetingViewModel(service: StubGreetingService(.success(hello)))
        await model.load()
        #expect(model.state == .loaded(hello))
    }

    @Test func loadShowsTheFailure() async {
        let failure = AppError.unavailable(reason: "offline")
        let model = GreetingViewModel(service: StubGreetingService(.failure(failure)))
        await model.load()
        #expect(model.state == .failed(failure))
    }

    @Test func retryAfterAFailureLoads() async {
        let service = StubGreetingService(.failure(.unavailable(reason: "offline")), .success(hello))
        let model = GreetingViewModel(service: service)
        await model.load()
        await model.load()
        #expect(model.state == .loaded(hello))
    }

    @Test func localServiceGreetsTheConfiguredSubject() async throws {
        let config = AppConfig(environment: .staging, greetingSubject: "team")
        let greeting = try await LocalGreetingService(config: config).greeting()
        #expect(greeting == Greeting(message: "Hello, team!", environment: .staging))
    }
}
