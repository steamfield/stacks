import XCTest

@testable import App

final class AppErrorTests: XCTestCase {
  func testOnlyTransientFailuresOfferRetry() {
    XCTAssertFalse(AppError.invalidConfig(key: "k", reason: "r").userMessage.canRetry)
    XCTAssertFalse(AppError.itemsNotFound(resource: "items").userMessage.canRetry)
    XCTAssertFalse(AppError.itemsUnreadable.userMessage.canRetry)
    XCTAssertTrue(AppError.unexpected("URLError").userMessage.canRetry)
  }

  func testUserMessagesHideInternalDetails() {
    let message = AppError.itemsNotFound(resource: "secret-resource-name").userMessage
    XCTAssertFalse(message.title.contains("secret-resource-name"))
    XCTAssertFalse(message.detail.contains("secret-resource-name"))
  }

  func testWrapsForeignErrorsAsUnexpected() {
    struct Boom: Error {}
    XCTAssertEqual(AppError(Boom()), .unexpected("Boom"))
    XCTAssertEqual(AppError(AppError.itemsUnreadable), .itemsUnreadable)
  }
}
