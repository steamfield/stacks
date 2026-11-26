import XCTest

@testable import App

final class BundledItemServiceTests: XCTestCase {
  func testDecodesTheShippedPayload() async throws {
    let service = BundledItemService(bundle: .main, resource: "items", delay: .zero)
    let items = try await service.items()
    XCTAssertFalse(items.isEmpty)
    XCTAssertEqual(Set(items.map(\.id)).count, items.count, "item ids must be unique")
  }

  func testMissingResourceThrowsItemsNotFound() async {
    let service = BundledItemService(bundle: .main, resource: "missing", delay: .zero)
    do {
      _ = try await service.items()
      XCTFail("expected itemsNotFound")
    } catch {
      XCTAssertEqual(error, .itemsNotFound(resource: "missing"))
    }
  }
}
