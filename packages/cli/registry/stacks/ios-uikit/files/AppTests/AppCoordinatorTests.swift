import XCTest

@testable import App

@MainActor
final class AppCoordinatorTests: XCTestCase {
  func testStartShowsTheItemListAsRoot() {
    let navigationController = UINavigationController()
    let coordinator = AppCoordinator(navigationController: navigationController)

    coordinator.start(service: ScriptedItemService(.success(Fixtures.items)))

    XCTAssertEqual(navigationController.viewControllers.count, 1)
    XCTAssertTrue(navigationController.topViewController is ItemListViewController)
  }

  func testSelectingAnItemPushesItsDetail() async throws {
    let navigationController = UINavigationController()
    let coordinator = AppCoordinator(navigationController: navigationController)
    coordinator.start(service: ScriptedItemService(.success(Fixtures.items)))
    let list = try XCTUnwrap(navigationController.topViewController as? ItemListViewController)

    await list.viewModel.load()
    list.viewModel.select(itemID: "a")

    let detail = try XCTUnwrap(navigationController.topViewController as? ItemDetailViewController)
    XCTAssertEqual(detail.item, Fixtures.items[0])
  }

  func testStartupFailureReplacesEveryScreen() throws {
    let navigationController = UINavigationController()
    let coordinator = AppCoordinator(navigationController: navigationController)
    coordinator.start(service: ScriptedItemService(.success(Fixtures.items)))
    let error = AppError.invalidConfig(key: "loadDelay", reason: "too long")

    coordinator.showStartupFailure(error)

    XCTAssertEqual(navigationController.viewControllers.count, 1)
    let screen = try XCTUnwrap(navigationController.topViewController)
    let configuration = screen.contentUnavailableConfiguration as? UIContentUnavailableConfiguration
    XCTAssertEqual(configuration?.text, error.userMessage.title)
  }
}
