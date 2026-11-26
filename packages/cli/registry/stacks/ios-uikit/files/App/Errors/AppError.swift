import Foundation

/// Every failure the app shows or logs. Services throw it with typed throws; view models turn
/// it into a `UserMessage` and never show `localizedDescription` or a raw error to the user.
enum AppError: Error, Equatable, Sendable {
  case invalidConfig(key: String, reason: String)
  case itemsNotFound(resource: String)
  case itemsUnreadable
  case unexpected(String)

  /// Wraps an error from code that doesn't throw `AppError` (a framework call, say).
  init(_ error: any Error) {
    if let appError = error as? AppError {
      self = appError
    } else {
      self = .unexpected(String(describing: type(of: error)))
    }
  }

  /// What the user reads. Keep it free of keys, paths and type names; those go to the log.
  var userMessage: UserMessage {
    switch self {
    case .invalidConfig:
      UserMessage(
        title: String(localized: "Something is misconfigured"),
        detail: String(localized: "This build can't start. Reinstall the app or contact support."),
        canRetry: false
      )
    case .itemsNotFound, .itemsUnreadable:
      UserMessage(
        title: String(localized: "Couldn't load items"),
        detail: String(localized: "The item list is missing or damaged in this build."),
        canRetry: false
      )
    case .unexpected:
      UserMessage(
        title: String(localized: "Something went wrong"),
        detail: String(localized: "Try again in a moment."),
        canRetry: true
      )
    }
  }
}

/// The user-facing side of an `AppError`: a title, one sentence of detail, and whether a
/// retry could succeed (which decides if the screen shows a Try Again button).
struct UserMessage: Equatable, Sendable {
  let title: String
  let detail: String
  let canRetry: Bool
}
