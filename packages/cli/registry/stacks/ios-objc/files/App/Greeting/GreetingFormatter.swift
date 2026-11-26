import Foundation

/// The Swift seam: Objective-C calls this through the generated `App-Swift.h`,
/// and it reads `APPGreeting` through `App-Bridging-Header.h`. The nullability
/// annotations on `APPGreeting` are why `message` and `recipient` arrive here as
/// `String` rather than `String?`.
@objc(APPGreetingFormatter)
final class GreetingFormatter: NSObject {
  @objc(headlineForGreeting:)
  static func headline(for greeting: APPGreeting) -> String {
    "\(greeting.message), \(greeting.recipient)!"
  }
}
