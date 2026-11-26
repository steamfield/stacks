import Foundation
import Testing

@testable import App

/// Finds the test bundle, which holds the fixtures under `AppTests/Fixtures/`.
private final class TestBundleToken {}

struct BundledItemServiceTests {
  @Test func decodesTheShippedPayload() async throws {
    let service = BundledItemService(bundle: .main, resource: "items", delay: .zero)
    let items = try await service.items()
    #expect(!items.isEmpty)
    #expect(Set(items.map(\.id)).count == items.count, "item ids must be unique")
  }

  @Test func waitsForTheConfiguredDelay() async throws {
    let service = BundledItemService(bundle: .main, resource: "items", delay: .milliseconds(1))
    let items = try await service.items()
    #expect(!items.isEmpty)
  }

  @Test func missingResourceThrowsItemsNotFound() async {
    let service = BundledItemService(bundle: .main, resource: "missing", delay: .zero)
    await #expect(throws: AppError.itemsNotFound(resource: "missing")) {
      try await service.items()
    }
  }

  @Test func malformedResourceThrowsItemsUnreadable() async {
    let service = BundledItemService(
      bundle: Bundle(for: TestBundleToken.self), resource: "malformed-items", delay: .zero)
    await #expect(throws: AppError.itemsUnreadable) {
      try await service.items()
    }
  }
}
