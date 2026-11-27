import XCTest

/// Launches the built app in the simulator and checks the first screen loads its payload.
/// XCUITest drives the app from outside, so it needs XCTest; unit tests use Swift Testing.
final class LaunchTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testLaunchShowsTheGreeting() throws {
        let app = XCUIApplication()
        app.launch()
        let message = app.staticTexts["greeting.message"]
        XCTAssertTrue(message.waitForExistence(timeout: 15), "the greeting never appeared")
        XCTAssertEqual(message.label, "Hello, world!")
        // Labels, Dynamic Type, clipped text, contrast and hit regions on the loaded screen.
        try app.performAccessibilityAudit()
    }
}
