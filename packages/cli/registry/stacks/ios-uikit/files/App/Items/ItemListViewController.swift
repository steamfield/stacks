import UIKit

/// Renders `ItemListViewModel.State`: a spinner while loading, a diffable list when loaded,
/// and a content-unavailable view for an empty list or an error. Layout is Auto Layout in code.
final class ItemListViewController: UIViewController {
  private enum Section: Hashable {
    case main
  }

  private typealias DataSource = UICollectionViewDiffableDataSource<Section, Item.ID>
  private typealias CellRegistration = UICollectionView.CellRegistration<
    UICollectionViewListCell, Item
  >

  enum AccessibilityID {
    static let list = "items.list"
    static func row(_ id: Item.ID) -> String { "items.row.\(id)" }
    /// On the root view, naming the state on screen, so UI tests don't match on copy.
    static let loading = "items.state.loading"
    static let empty = "items.state.empty"
    static let loaded = "items.state.loaded"
    static let failed = "items.state.failed"
  }

  let viewModel: ItemListViewModel

  private var itemsByID: [Item.ID: Item] = [:]
  private var loadTask: Task<Void, Never>?
  private lazy var collectionView = UICollectionView(
    frame: .zero,
    collectionViewLayout: UICollectionViewCompositionalLayout.list(
      using: UICollectionLayoutListConfiguration(appearance: .insetGrouped)
    )
  )
  private lazy var dataSource = makeDataSource()

  init(viewModel: ItemListViewModel) {
    self.viewModel = viewModel
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("ItemListViewController is created in code, not from a storyboard")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = viewModel.title
    view.backgroundColor = .systemGroupedBackground
    layoutCollectionView()

    viewModel.onStateChange = { [weak self] state in self?.render(state) }
    render(viewModel.state)
    reload()
  }

  func reload() {
    loadTask?.cancel()
    loadTask = Task { [weak self] in await self?.viewModel.load() }
  }

  private func layoutCollectionView() {
    collectionView.translatesAutoresizingMaskIntoConstraints = false
    collectionView.accessibilityIdentifier = AccessibilityID.list
    collectionView.delegate = self
    view.addSubview(collectionView)
    NSLayoutConstraint.activate([
      collectionView.topAnchor.constraint(equalTo: view.topAnchor),
      collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      collectionView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
  }

  private func makeDataSource() -> DataSource {
    let registration = CellRegistration(handler: Self.configure)
    return DataSource(collectionView: collectionView) { [weak self] view, indexPath, id in
      guard let item = self?.itemsByID[id] else { return nil }
      return view.dequeueConfiguredReusableCell(using: registration, for: indexPath, item: item)
    }
  }

  private static func configure(_ cell: UICollectionViewListCell, at _: IndexPath, item: Item) {
    var content = cell.defaultContentConfiguration()
    content.text = item.title
    content.secondaryText = item.summary
    cell.contentConfiguration = content
    cell.accessories = [.disclosureIndicator()]
    cell.accessibilityIdentifier = AccessibilityID.row(item.id)
  }

  private func render(_ state: ItemListViewModel.State) {
    switch state {
    case .idle, .loading:
      apply([])
      contentUnavailableConfiguration = UIContentUnavailableConfiguration.loading()
      view.accessibilityIdentifier = AccessibilityID.loading
    case .loaded(let items) where items.isEmpty:
      apply([])
      var empty = UIContentUnavailableConfiguration.empty()
      empty.image = UIImage(systemName: "tray")
      empty.text = String(localized: "No items yet")
      contentUnavailableConfiguration = empty
      view.accessibilityIdentifier = AccessibilityID.empty
    case .loaded(let items):
      apply(items)
      contentUnavailableConfiguration = nil
      view.accessibilityIdentifier = AccessibilityID.loaded
    case .failed(let message):
      apply([])
      contentUnavailableConfiguration = failureConfiguration(message)
      view.accessibilityIdentifier = AccessibilityID.failed
    }
  }

  private func failureConfiguration(_ message: UserMessage) -> UIContentUnavailableConfiguration {
    var configuration = UIContentUnavailableConfiguration.empty()
    configuration.image = UIImage(systemName: "exclamationmark.triangle")
    configuration.text = message.title
    configuration.secondaryText = message.detail
    if message.canRetry {
      var button = UIButton.Configuration.borderedProminent()
      button.title = String(localized: "Try Again")
      configuration.button = button
      configuration.buttonProperties.primaryAction = UIAction { [weak self] _ in self?.reload() }
    }
    return configuration
  }

  private func apply(_ items: [Item]) {
    itemsByID = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
    var snapshot = NSDiffableDataSourceSnapshot<Section, Item.ID>()
    snapshot.appendSections([.main])
    snapshot.appendItems(items.map(\.id))
    dataSource.apply(snapshot, animatingDifferences: false)
  }
}

extension ItemListViewController: UICollectionViewDelegate {
  func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
    collectionView.deselectItem(at: indexPath, animated: true)
    guard let id = dataSource.itemIdentifier(for: indexPath) else { return }
    viewModel.select(itemID: id)
  }
}
