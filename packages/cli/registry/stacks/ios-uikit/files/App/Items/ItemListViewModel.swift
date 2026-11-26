import Foundation

/// The list screen's state and actions. It imports no UIKit: the view controller renders
/// `state` and forwards taps, and the coordinator handles `onSelect`.
@MainActor
final class ItemListViewModel {
  enum State: Equatable {
    case idle
    case loading
    case loaded([Item])
    case failed(UserMessage)
  }

  let title = String(localized: "Items")

  private(set) var state: State = .idle {
    didSet { onStateChange?(state) }
  }

  /// Called on the main actor after every state change.
  var onStateChange: ((State) -> Void)?
  /// Called when the user picks an item; the coordinator decides where that goes.
  var onSelect: ((Item) -> Void)?

  private let service: any ItemService

  init(service: any ItemService) {
    self.service = service
  }

  func load() async {
    if state == .loading { return }
    state = .loading
    do {
      let items = try await service.items()
      Log.items.info("Loaded \(items.count) items")
      state = .loaded(items)
    } catch {
      Log.items.error("Load failed: \(String(describing: error), privacy: .public)")
      state = .failed(error.userMessage)
    }
  }

  func select(itemID: Item.ID) {
    guard case .loaded(let items) = state,
      let item = items.first(where: { $0.id == itemID })
    else { return }
    onSelect?(item)
  }
}
