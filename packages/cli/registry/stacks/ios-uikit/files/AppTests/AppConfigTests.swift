import XCTest

@testable import App

final class AppConfigTests: XCTestCase {
  func testDefaultsApplyWhenNothingIsSet() throws {
    let config = try AppConfig.load(info: [:], environment: [:])
    XCTAssertEqual(config, AppConfig.defaults)
  }

  func testInfoPlistOverridesDefaults() throws {
    let config = try AppConfig.load(
      info: ["ItemsResource": "featured", "LoadDelayMilliseconds": 250],
      environment: [:]
    )
    XCTAssertEqual(config.itemsResource, "featured")
    XCTAssertEqual(config.loadDelay, .milliseconds(250))
  }

  func testEnvironmentOverridesInfoPlist() throws {
    let config = try AppConfig.load(
      info: ["ItemsResource": "featured", "LoadDelayMilliseconds": 250],
      environment: ["APP_ITEMS_RESOURCE": "archive", "APP_LOAD_DELAY_MS": "0"]
    )
    XCTAssertEqual(config.itemsResource, "archive")
    XCTAssertEqual(config.loadDelay, .zero)
  }

  private struct InvalidCase {
    var info: [String: Any] = [:]
    var environment: [String: String] = [:]
    let key: String
  }

  func testRejectsInvalidValues() {
    let cases = [
      InvalidCase(info: ["ItemsResource": 3], key: "ItemsResource"),
      InvalidCase(info: ["LoadDelayMilliseconds": "soon"], key: "LoadDelayMilliseconds"),
      InvalidCase(environment: ["APP_LOAD_DELAY_MS": "1.5"], key: "APP_LOAD_DELAY_MS"),
      InvalidCase(environment: ["APP_ITEMS_RESOURCE": "  "], key: "itemsResource"),
      InvalidCase(environment: ["APP_LOAD_DELAY_MS": "-1"], key: "loadDelay"),
      InvalidCase(environment: ["APP_LOAD_DELAY_MS": "10001"], key: "loadDelay"),
    ]
    for testCase in cases {
      XCTAssertThrowsError(
        try AppConfig.load(info: testCase.info, environment: testCase.environment),
        "expected \(testCase.key) to be rejected"
      ) { error in
        guard case .invalidConfig(let key, _) = error as? AppError else {
          return XCTFail("expected invalidConfig, got \(error)")
        }
        XCTAssertEqual(key, testCase.key)
      }
    }
  }

  func testShippedInfoPlistLoads() throws {
    let info = Bundle.main.object(forInfoDictionaryKey: AppConfig.infoKey) as? [String: Any]
    let config = try AppConfig.load(info: try XCTUnwrap(info), environment: [:])
    XCTAssertEqual(config.itemsResource, "items")
  }
}
