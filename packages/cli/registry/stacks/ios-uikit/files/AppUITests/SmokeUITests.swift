import XCTest

/// Launches the real app on a simulator. Keep this to journeys a unit test can't prove;
/// each launch costs seconds. UI tests stay on XCTest: Swift Testing has no UI automation.
final class SmokeUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  @MainActor
  func testListLoadsAndOpensDetail() throws {
    let app = XCUIApplication()
    app.launch()

    let row = app.cells["items.row.welcome"]
    XCTAssertTrue(row.waitForExistence(timeout: 15), "the first row never appeared")
    // Labels, contrast, Dynamic Type and clipped text on the loaded list.
    try app.performAccessibilityAudit()
    row.tap()

    XCTAssertTrue(app.staticTexts["items.detail.summary"].waitForExistence(timeout: 5))
    try app.performAccessibilityAudit()
  }

  @MainActor
  func testMissingPayloadShowsTheErrorState() {
    let app = XCUIApplication()
    app.launchEnvironment["APP_ITEMS_RESOURCE"] = "missing"
    app.launch()

    let failed = app.descendants(matching: .any)["items.state.failed"]
    XCTAssertTrue(failed.waitForExistence(timeout: 15), "the error state never appeared")
    XCTAssertFalse(app.cells["items.row.welcome"].exists)
  }
}
