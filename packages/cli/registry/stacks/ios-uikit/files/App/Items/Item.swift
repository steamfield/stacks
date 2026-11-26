import Foundation

/// One row in the list and the payload `BundledItemService` decodes.
struct Item: Identifiable, Hashable, Sendable, Decodable {
  let id: String
  let title: String
  let summary: String
}

/// The shape of `items.json`: `{ "items": [Item] }`.
struct ItemsPayload: Decodable, Sendable {
  let items: [Item]
}
