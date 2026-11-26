import Foundation

/// Reads the app and OS facts that the JavaScript `AppInfo` spec returns.
///
/// The values arrive through the initializer, so tests build a reader from a plain dictionary
/// without a host app. `RCTAppInfo` calls `current()` and turns a thrown error into a promise
/// rejection carrying `missingKeyCode`.
@objc(AppInfoReader)
public final class AppInfoReader: NSObject {
  /// The rejection code JavaScript receives when the bundle lacks a required key.
  @objc public static let missingKeyCode = "E_APP_INFO_MISSING_KEY"

  private let info: [String: Any]
  private let systemVersion: String

  /// A reader over the main bundle's Info.plist and the running OS.
  @objc public static func current() -> AppInfoReader {
    let version = ProcessInfo.processInfo.operatingSystemVersion
    return AppInfoReader(
      info: Bundle.main.infoDictionary ?? [:],
      systemVersion: "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
    )
  }

  /// A reader over the given Info.plist values and OS version.
  public init(info: [String: Any], systemVersion: String) {
    self.info = info
    self.systemVersion = systemVersion
  }

  /// The values keyed as the spec's `AppInfo` type, or an error naming the missing key.
  @objc public func read() throws -> [String: String] {
    [
      "appName": try value(for: ["CFBundleDisplayName", "CFBundleName"]),
      "appVersion": try value(for: ["CFBundleShortVersionString"]),
      "buildNumber": try value(for: ["CFBundleVersion"]),
      "systemName": "iOS",
      "systemVersion": systemVersion,
    ]
  }

  private func value(for keys: [String]) throws -> String {
    for key in keys {
      if let text = info[key] as? String, !text.isEmpty {
        return text
      }
    }
    throw NSError(
      domain: "AppInfo",
      code: 1,
      userInfo: [
        NSLocalizedDescriptionKey: "Info.plist has no \(keys.joined(separator: " or "))."
      ]
    )
  }
}
