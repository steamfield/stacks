import SwiftUI

/// The first screen: a spinner while loading, then the greeting or the error.
struct GreetingScreen: View {
    let model: GreetingViewModel

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Greeting")
        }
        .task { await model.load() }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .idle, .loading:
            ProgressView()
                .accessibilityIdentifier("greeting.loading")
        case .loaded(let greeting):
            VStack(spacing: 8) {
                Text(greeting.message)
                    .font(.largeTitle)
                    .accessibilityIdentifier("greeting.message")
                Text(greeting.environment.rawValue)
                    .font(.footnote)
            }
        case .failed(let error):
            ErrorView(error: error) { await model.load() }
        }
    }
}

#Preview {
    GreetingScreen(model: GreetingViewModel(service: LocalGreetingService(config: .defaults)))
}
