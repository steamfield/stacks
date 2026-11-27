import Testing

@testable import App

struct AppErrorTests {
  @Test func onlyTransientFailuresOfferRetry() {
    #expect(!AppError.invalidConfig(key: "k", reason: "r").userMessage.canRetry)
    #expect(!AppError.itemsNotFound(resource: "items").userMessage.canRetry)
    #expect(!AppError.itemsUnreadable.userMessage.canRetry)
    #expect(AppError.unexpected("URLError").userMessage.canRetry)
  }

  @Test func userMessagesHideInternalDetails() {
    let message = AppError.itemsNotFound(resource: "secret-resource-name").userMessage
    #expect(!message.title.contains("secret-resource-name"))
    #expect(!message.detail.contains("secret-resource-name"))
  }

  @Test func wrapsForeignErrorsAsUnexpected() {
    struct Boom: Error {}
    #expect(AppError(Boom()) == .unexpected("Boom"))
    #expect(AppError(AppError.itemsUnreadable) == .itemsUnreadable)
  }
}
