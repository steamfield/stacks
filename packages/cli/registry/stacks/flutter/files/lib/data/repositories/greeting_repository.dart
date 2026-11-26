import '../../domain/models/greeting.dart';
import '../../utils/result.dart';

/// The single source of greetings for the UI.
///
/// View models depend on this interface, so each environment (or a test) can
/// pass its own implementation. `GreetingRepositoryRemote` is the one the app
/// builds.
abstract interface class GreetingRepository {
  /// The greeting, or an [Err] holding the `AppError` that stopped it.
  Future<Result<Greeting>> fetchGreeting();
}
