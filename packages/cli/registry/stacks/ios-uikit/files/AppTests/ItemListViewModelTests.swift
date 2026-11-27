import Testing

@testable import App

@MainActor
struct ItemListViewModelTests {
  @Test func loadMovesThroughLoadingToLoaded() async {
    let viewModel = ItemListViewModel(service: ScriptedItemService(.success(Fixtures.items)))
    var states: [ItemListViewModel.State] = []
    viewModel.onStateChange = { states.append($0) }

    await viewModel.load()

    #expect(states == [.loading, .loaded(Fixtures.items)])
  }

  @Test func failureShowsTheMappedUserMessage() async {
    let viewModel = ItemListViewModel(service: ScriptedItemService(.failure(.itemsUnreadable)))

    await viewModel.load()

    #expect(viewModel.state == .failed(AppError.itemsUnreadable.userMessage))
  }

  @Test func retryAfterFailureLoadsItems() async {
    let service = ScriptedItemService(.failure(.unexpected("timeout")), .success(Fixtures.items))
    let viewModel = ItemListViewModel(service: service)

    await viewModel.load()
    await viewModel.load()

    #expect(viewModel.state == .loaded(Fixtures.items))
    #expect(await service.calls == 2)
  }

  @Test func selectReportsTheChosenItem() async {
    let viewModel = ItemListViewModel(service: ScriptedItemService(.success(Fixtures.items)))
    var selected: Item?
    viewModel.onSelect = { selected = $0 }
    await viewModel.load()

    viewModel.select(itemID: "b")

    #expect(selected == Fixtures.items[1])
  }

  @Test func selectIgnoresUnknownIDs() async {
    let viewModel = ItemListViewModel(service: ScriptedItemService(.success(Fixtures.items)))
    var selected: Item?
    viewModel.onSelect = { selected = $0 }
    await viewModel.load()

    viewModel.select(itemID: "nope")

    #expect(selected == nil)
  }
}
