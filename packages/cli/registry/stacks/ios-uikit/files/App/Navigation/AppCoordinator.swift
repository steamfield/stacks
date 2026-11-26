import UIKit

/// Owns navigation. View controllers never push, present or create other screens; they
/// report intent through their view model's callbacks and the coordinator acts on it.
@MainActor
protocol Coordinator: AnyObject {
  var navigationController: UINavigationController { get }
}

@MainActor
final class AppCoordinator: Coordinator {
  let navigationController: UINavigationController

  init(navigationController: UINavigationController) {
    self.navigationController = navigationController
  }

  /// Shows the item list as the root screen.
  func start(service: any ItemService) {
    let viewModel = ItemListViewModel(service: service)
    viewModel.onSelect = { [weak self] item in self?.showDetail(for: item) }
    navigationController.setViewControllers(
      [ItemListViewController(viewModel: viewModel)],
      animated: false
    )
  }

  func showDetail(for item: Item) {
    Log.navigation.debug("Showing item \(item.id, privacy: .public)")
    navigationController.pushViewController(ItemDetailViewController(item: item), animated: true)
  }

  /// Replaces every screen with the error's message when the app can't start (bad config).
  func showStartupFailure(_ error: AppError) {
    let message = error.userMessage
    let screen = UIViewController()
    screen.view.backgroundColor = .systemBackground
    var configuration = UIContentUnavailableConfiguration.empty()
    configuration.image = UIImage(systemName: "exclamationmark.octagon")
    configuration.text = message.title
    configuration.secondaryText = message.detail
    screen.contentUnavailableConfiguration = configuration
    navigationController.setViewControllers([screen], animated: false)
  }
}
