import Testing
import UIKit

@testable import App

/// The view controllers render what their view model or item says. Each test loads the view
/// without a window and awaits the view model directly, so nothing sleeps.
@MainActor
struct ItemScreenTests {
  @Test func listShowsRowsOnceLoaded() async {
    let screen = ItemListViewController(
      viewModel: ItemListViewModel(service: ScriptedItemService(.success(Fixtures.items))))
    screen.loadViewIfNeeded()

    await screen.viewModel.load()

    #expect(screen.view.accessibilityIdentifier == ItemListViewController.AccessibilityID.loaded)
    #expect(screen.contentUnavailableConfiguration == nil)
  }

  @Test func listShowsTheEmptyState() async {
    let screen = ItemListViewController(
      viewModel: ItemListViewModel(service: ScriptedItemService(.success([]))))
    screen.loadViewIfNeeded()

    await screen.viewModel.load()

    #expect(screen.view.accessibilityIdentifier == ItemListViewController.AccessibilityID.empty)
    let configuration = screen.contentUnavailableConfiguration as? UIContentUnavailableConfiguration
    #expect(configuration?.text == String(localized: "No items yet"))
  }

  @Test func retryableFailureOffersTryAgain() async {
    let screen = ItemListViewController(
      viewModel: ItemListViewModel(service: ScriptedItemService(.failure(.unexpected("timeout")))))
    screen.loadViewIfNeeded()

    await screen.viewModel.load()

    #expect(screen.view.accessibilityIdentifier == ItemListViewController.AccessibilityID.failed)
    let configuration = screen.contentUnavailableConfiguration as? UIContentUnavailableConfiguration
    #expect(configuration?.text == AppError.unexpected("timeout").userMessage.title)
    #expect(configuration?.button.title == String(localized: "Try Again"))
  }

  @Test func permanentFailureHasNoRetry() async {
    let screen = ItemListViewController(
      viewModel: ItemListViewModel(service: ScriptedItemService(.failure(.itemsUnreadable))))
    screen.loadViewIfNeeded()

    await screen.viewModel.load()

    let configuration = screen.contentUnavailableConfiguration as? UIContentUnavailableConfiguration
    #expect(configuration?.button.title == nil)
  }

  @Test func detailShowsTheItem() {
    let item = Fixtures.items[0]
    let screen = ItemDetailViewController(item: item)

    screen.loadViewIfNeeded()

    #expect(screen.title == item.title)
    let summary = screen.view.subviews.compactMap { $0 as? UILabel }.first
    #expect(summary?.text == item.summary)
    #expect(summary?.adjustsFontForContentSizeCategory == true)
  }
}
