import XCTest

/// Launches the real app on a simulator. Keep this to journeys a unit test can't prove;
/// each launch costs seconds.
final class SmokeUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  @MainActor
  func testListLoadsAndOpensDetail() {
    let app = XCUIApplication()
    app.launch()

    let row = app.cells["items.row.welcome"]
    XCTAssertTrue(row.waitForExistence(timeout: 15), "the first row never appeared")
    row.tap()

    XCTAssertTrue(app.staticTexts["items.detail.summary"].waitForExistence(timeout: 5))
  }

  @MainActor
  func testMissingPayloadShowsTheErrorState() {
    let app = XCUIApplication()
    app.launchEnvironment["APP_ITEMS_RESOURCE"] = "missing"
    app.launch()

    XCTAssertTrue(app.staticTexts["Couldn't load items"].waitForExistence(timeout: 15))
    XCTAssertFalse(app.cells["items.row.welcome"].exists)
  }
}
