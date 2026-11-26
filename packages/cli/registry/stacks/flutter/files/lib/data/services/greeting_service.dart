/// Fetches the greeting payload as decoded JSON, the shape an HTTP client
/// returns.
///
/// Implementations throw `AppError` with `AppErrorKind.network` when the
/// service can't be reached. They don't validate the payload; the repository
/// does.
abstract interface class GreetingService {
  Future<Map<String, Object?>> fetchGreeting({required String name});
}
