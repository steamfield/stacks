import UIKit

/// Shows one item. It has no view model because it has no state or actions yet; give it one
/// when it gains either.
final class ItemDetailViewController: UIViewController {
  enum AccessibilityID {
    static let summary = "items.detail.summary"
  }

  let item: Item

  private let summaryLabel = UILabel()

  init(item: Item) {
    self.item = item
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("ItemDetailViewController is created in code, not from a storyboard")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = item.title
    navigationItem.largeTitleDisplayMode = .always
    view.backgroundColor = .systemBackground

    summaryLabel.translatesAutoresizingMaskIntoConstraints = false
    summaryLabel.text = item.summary
    summaryLabel.numberOfLines = 0
    summaryLabel.font = .preferredFont(forTextStyle: .body)
    summaryLabel.adjustsFontForContentSizeCategory = true
    summaryLabel.accessibilityIdentifier = AccessibilityID.summary
    view.addSubview(summaryLabel)

    let guide = view.readableContentGuide
    NSLayoutConstraint.activate([
      summaryLabel.topAnchor.constraint(equalToSystemSpacingBelow: guide.topAnchor, multiplier: 2),
      summaryLabel.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
      summaryLabel.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
    ])
  }
}
