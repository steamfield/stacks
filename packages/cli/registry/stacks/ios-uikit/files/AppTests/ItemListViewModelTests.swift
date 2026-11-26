import XCTest

@testable import App

@MainActor
final class ItemListViewModelTests: XCTestCase {
  func testLoadMovesThroughLoadingToLoaded() async {
    let viewModel = ItemListViewModel(service: ScriptedItemService(.success(Fixtures.items)))
    var states: [ItemListViewModel.State] = []
    viewModel.onStateChange = { states.append($0) }

    await viewModel.load()

    XCTAssertEqual(states, [.loading, .loaded(Fixtures.items)])
  }

  func testFailureShowsTheMappedUserMessage() async {
    let viewModel = ItemListViewModel(service: ScriptedItemService(.failure(.itemsUnreadable)))

    await viewModel.load()

    XCTAssertEqual(viewModel.state, .failed(AppError.itemsUnreadable.userMessage))
  }

  func testRetryAfterFailureLoadsItems() async {
    let service = ScriptedItemService(.failure(.unexpected("timeout")), .success(Fixtures.items))
    let viewModel = ItemListViewModel(service: service)

    await viewModel.load()
    await viewModel.load()

    XCTAssertEqual(viewModel.state, .loaded(Fixtures.items))
    let calls = await service.calls
    XCTAssertEqual(calls, 2)
  }

  func testSelectReportsTheChosenItem() async {
    let viewModel = ItemListViewModel(service: ScriptedItemService(.success(Fixtures.items)))
    var selected: Item?
    viewModel.onSelect = { selected = $0 }
    await viewModel.load()

    viewModel.select(itemID: "b")

    XCTAssertEqual(selected, Fixtures.items[1])
  }

  func testSelectIgnoresUnknownIDs() async {
    let viewModel = ItemListViewModel(service: ScriptedItemService(.success(Fixtures.items)))
    var selected: Item?
    viewModel.onSelect = { selected = $0 }
    await viewModel.load()

    viewModel.select(itemID: "nope")

    XCTAssertNil(selected)
  }
}
