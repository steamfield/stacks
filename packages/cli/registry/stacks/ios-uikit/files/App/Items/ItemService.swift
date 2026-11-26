import Foundation

/// Where the list gets its items. View models depend on this protocol only, so tests pass a
/// stub and a network-backed service can replace `BundledItemService` without touching them.
protocol ItemService: Sendable {
  func items() async throws(AppError) -> [Item]
}

/// Reads `<resource>.json` from a bundle. The app's only data source until it has a backend.
struct BundledItemService: ItemService {
  let bundle: Bundle
  let resource: String
  let delay: Duration

  func items() async throws(AppError) -> [Item] {
    if delay > .zero {
      // Cancellation ends the wait early; the caller decides what a cancelled load means.
      try? await Task.sleep(for: delay)
    }
    guard let url = bundle.url(forResource: resource, withExtension: "json") else {
      Log.items.error("Missing items resource \(resource, privacy: .public)")
      throw .itemsNotFound(resource: resource)
    }
    do {
      let data = try Data(contentsOf: url)
      return try JSONDecoder().decode(ItemsPayload.self, from: data).items
    } catch {
      Log.items.error("Unreadable items resource: \(String(describing: error), privacy: .public)")
      throw .itemsUnreadable
    }
  }
}
