import Foundation
import os

/// One `Logger` per area, all under the bundle identifier as subsystem, so Console.app and
/// `log stream --predicate 'subsystem == "<bundle id>"'` show only this app.
/// Interpolated values are private by default; mark one `.public` only when it holds no user data.
enum Log {
  static let subsystem = Bundle.main.bundleIdentifier ?? "App"

  static let app = Logger(subsystem: subsystem, category: "app")
  static let items = Logger(subsystem: subsystem, category: "items")
  static let navigation = Logger(subsystem: subsystem, category: "navigation")
}
