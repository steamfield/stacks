import UIKit

/// Builds the window for a scene: loads `AppConfig`, wires the live dependencies and hands
/// navigation to `AppCoordinator`. Nothing else in the app reads Info.plist or the environment.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  private var coordinator: AppCoordinator?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }

    let navigationController = UINavigationController()
    navigationController.navigationBar.prefersLargeTitles = true
    let coordinator = AppCoordinator(navigationController: navigationController)
    let info = Bundle.main.object(forInfoDictionaryKey: AppConfig.infoKey) as? [String: Any]

    do {
      let config = try AppConfig.load(
        info: info ?? [:],
        environment: ProcessInfo.processInfo.environment
      )
      Log.app.info("Starting with items resource \(config.itemsResource, privacy: .public)")
      coordinator.start(
        service: BundledItemService(
          bundle: .main,
          resource: config.itemsResource,
          delay: config.loadDelay
        )
      )
    } catch {
      Log.app.fault("Invalid configuration: \(String(describing: error), privacy: .public)")
      coordinator.showStartupFailure(error)
    }

    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = navigationController
    window.makeKeyAndVisible()
    self.window = window
    self.coordinator = coordinator
  }
}
