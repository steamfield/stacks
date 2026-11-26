import Testing
import UIKit

@testable import App

@MainActor
struct AppCoordinatorTests {
  let navigationController = UINavigationController()

  @Test func startShowsTheItemListAsRoot() {
    let coordinator = AppCoordinator(navigationController: navigationController)

    coordinator.start(service: ScriptedItemService(.success(Fixtures.items)))

    #expect(navigationController.viewControllers.count == 1)
    #expect(navigationController.topViewController is ItemListViewController)
  }

  @Test func selectingAnItemPushesItsDetail() async throws {
    let coordinator = AppCoordinator(navigationController: navigationController)
    coordinator.start(service: ScriptedItemService(.success(Fixtures.items)))
    let list = try #require(navigationController.topViewController as? ItemListViewController)

    await list.viewModel.load()
    list.viewModel.select(itemID: "a")

    let detail = try #require(navigationController.topViewController as? ItemDetailViewController)
    #expect(detail.item == Fixtures.items[0])
  }

  @Test func startupFailureReplacesEveryScreen() throws {
    let coordinator = AppCoordinator(navigationController: navigationController)
    coordinator.start(service: ScriptedItemService(.success(Fixtures.items)))
    let error = AppError.invalidConfig(key: "loadDelay", reason: "too long")

    coordinator.showStartupFailure(error)

    #expect(navigationController.viewControllers.count == 1)
    let screen = try #require(navigationController.topViewController)
    let configuration = screen.contentUnavailableConfiguration as? UIContentUnavailableConfiguration
    #expect(configuration?.text == error.userMessage.title)
  }
}
