import SwiftUI

/// Shows an `AppError`'s user message, with a retry button when a retry can help.
struct ErrorView: View {
    let error: AppError
    let retry: (@MainActor () async -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label("Something went wrong", systemImage: "exclamationmark.triangle")
        } description: {
            Text(error.userMessage)
                .accessibilityIdentifier("error.message")
        } actions: {
            if error.isRetryable, let retry {
                Button("Try again") {
                    Task { await retry() }
                }
                .accessibilityIdentifier("error.retry")
            }
        }
    }
}

#Preview("Retryable") {
    ErrorView(error: .unavailable(reason: "preview")) {}
}

#Preview("Configuration") {
    ErrorView(error: .invalidConfiguration(key: "AppEnvironment", value: "prod"), retry: nil)
}
