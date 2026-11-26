import Foundation
import OSLog

/// One `Logger` per area, all under the bundle identifier, so Console.app and
/// `log stream --predicate 'subsystem == "<bundle id>"'` show only this app.
enum Log {
    private static let subsystem = Bundle.main.bundleIdentifier ?? "app"

    static let app = Logger(subsystem: subsystem, category: "app")
    static let greeting = Logger(subsystem: subsystem, category: "greeting")
}
