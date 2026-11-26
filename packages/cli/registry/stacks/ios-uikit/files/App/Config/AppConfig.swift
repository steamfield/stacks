import Foundation

/// Settings the app reads once, at launch, in `SceneDelegate`.
///
/// Precedence, lowest first: `defaults`, the `AppConfig` dictionary in Info.plist, then
/// `APP_*` environment variables (set by an Xcode scheme or a UI test's `launchEnvironment`).
/// Every value is validated; an invalid one is an `AppError.invalidConfig`, never a silent
/// fallback. docs/configuration.md lists the keys.
struct AppConfig: Equatable, Sendable {
  /// Name of the bundled JSON file `BundledItemService` reads, without the extension.
  var itemsResource: String
  /// Artificial latency before the items load, so the loading state can be seen and tested.
  var loadDelay: Duration

  static let infoKey = "AppConfig"
  static let defaults = AppConfig(itemsResource: "items", loadDelay: .zero)
  static let maximumLoadDelay: Duration = .seconds(10)

  enum Key {
    static let itemsResourceInfo = "ItemsResource"
    static let loadDelayInfo = "LoadDelayMilliseconds"
    static let itemsResourceEnv = "APP_ITEMS_RESOURCE"
    static let loadDelayEnv = "APP_LOAD_DELAY_MS"
  }

  static func load(
    info: [String: Any],
    environment: [String: String]
  ) throws(AppError) -> AppConfig {
    var config = defaults

    if let value = info[Key.itemsResourceInfo] {
      guard let resource = value as? String else {
        throw .invalidConfig(key: Key.itemsResourceInfo, reason: "must be a string")
      }
      config.itemsResource = resource
    }
    if let value = info[Key.loadDelayInfo] {
      guard let milliseconds = value as? Int else {
        throw .invalidConfig(key: Key.loadDelayInfo, reason: "must be a whole number")
      }
      config.loadDelay = .milliseconds(milliseconds)
    }

    if let resource = environment[Key.itemsResourceEnv] {
      config.itemsResource = resource
    }
    if let value = environment[Key.loadDelayEnv] {
      guard let milliseconds = Int(value) else {
        throw .invalidConfig(key: Key.loadDelayEnv, reason: "must be a whole number")
      }
      config.loadDelay = .milliseconds(milliseconds)
    }

    try config.validate()
    return config
  }

  func validate() throws(AppError) {
    if itemsResource.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      throw .invalidConfig(key: "itemsResource", reason: "must not be empty")
    }
    if loadDelay < .zero || loadDelay > Self.maximumLoadDelay {
      throw .invalidConfig(key: "loadDelay", reason: "must be between 0 and 10000 milliseconds")
    }
  }
}
