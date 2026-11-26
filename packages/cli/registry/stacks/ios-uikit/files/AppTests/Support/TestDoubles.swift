@testable import App

/// An `ItemService` that returns scripted results in order, one per call.
actor ScriptedItemService: ItemService {
  private var results: [Result<[Item], AppError>]
  private(set) var calls = 0

  init(_ results: Result<[Item], AppError>...) {
    self.results = results
  }

  func items() async throws(AppError) -> [Item] {
    calls += 1
    guard !results.isEmpty else { throw .unexpected("ScriptedItemService ran out of results") }
    return try results.removeFirst().get()
  }
}

enum Fixtures {
  static let items = [
    Item(id: "a", title: "First", summary: "The first item"),
    Item(id: "b", title: "Second", summary: "The second item"),
  ]
}
