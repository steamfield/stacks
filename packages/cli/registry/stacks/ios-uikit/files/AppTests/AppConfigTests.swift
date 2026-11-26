import Foundation
import Testing

@testable import App

struct AppConfigTests {
  @Test func defaultsApplyWhenNothingIsSet() throws {
    let config = try AppConfig.load(info: [:], environment: [:])
    #expect(config == AppConfig.defaults)
  }

  @Test func infoPlistOverridesDefaults() throws {
    let config = try AppConfig.load(
      info: ["ItemsResource": "featured", "LoadDelayMilliseconds": 250],
      environment: [:]
    )
    #expect(config.itemsResource == "featured")
    #expect(config.loadDelay == .milliseconds(250))
  }

  @Test func environmentOverridesInfoPlist() throws {
    let config = try AppConfig.load(
      info: ["ItemsResource": "featured", "LoadDelayMilliseconds": 250],
      environment: ["APP_ITEMS_RESOURCE": "archive", "APP_LOAD_DELAY_MS": "0"]
    )
    #expect(config.itemsResource == "archive")
    #expect(config.loadDelay == .zero)
  }

  /// One rejected input per case. Info.plist values are built inside the test, because
  /// `[String: Any]` isn't `Sendable` and test arguments must be.
  enum InvalidCase: CaseIterable, Sendable {
    case resourceNotAString
    case delayNotANumber
    case delayEnvFractional
    case resourceBlank
    case delayNegative
    case delayTooLong

    var info: [String: Any] {
      switch self {
      case .resourceNotAString: ["ItemsResource": 3]
      case .delayNotANumber: ["LoadDelayMilliseconds": "soon"]
      default: [:]
      }
    }

    var environment: [String: String] {
      switch self {
      case .delayEnvFractional: ["APP_LOAD_DELAY_MS": "1.5"]
      case .resourceBlank: ["APP_ITEMS_RESOURCE": "  "]
      case .delayNegative: ["APP_LOAD_DELAY_MS": "-1"]
      case .delayTooLong: ["APP_LOAD_DELAY_MS": "10001"]
      default: [:]
      }
    }

    var key: String {
      switch self {
      case .resourceNotAString: "ItemsResource"
      case .delayNotANumber: "LoadDelayMilliseconds"
      case .delayEnvFractional: "APP_LOAD_DELAY_MS"
      case .resourceBlank: "itemsResource"
      case .delayNegative, .delayTooLong: "loadDelay"
      }
    }
  }

  @Test(arguments: InvalidCase.allCases)
  func rejectsInvalidValues(_ invalid: InvalidCase) {
    let error = #expect(throws: AppError.self) {
      try AppConfig.load(info: invalid.info, environment: invalid.environment)
    }
    guard case .invalidConfig(let key, _) = error else {
      Issue.record("expected invalidConfig, got \(String(describing: error))")
      return
    }
    #expect(key == invalid.key)
  }

  @Test func shippedInfoPlistLoads() throws {
    let info = Bundle.main.object(forInfoDictionaryKey: AppConfig.infoKey) as? [String: Any]
    let config = try AppConfig.load(info: try #require(info), environment: [:])
    #expect(config.itemsResource == "items")
  }
}
