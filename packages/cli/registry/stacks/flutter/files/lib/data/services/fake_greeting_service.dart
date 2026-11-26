import '../../utils/app_error.dart';
import 'greeting_service.dart';

/// A [GreetingService] that answers from memory after [delay].
///
/// The app runs on it until a real service exists. Tests set [failure] or
/// [response] to drive the error paths, and read [calls].
final class FakeGreetingService implements GreetingService {
  FakeGreetingService({
    this.delay = Duration.zero,
    this.failure,
    this.response,
  });

  final Duration delay;

  /// Thrown by the next fetch when set.
  AppError? failure;

  /// Returned instead of the built-in payload when set.
  Map<String, Object?>? response;

  /// How many fetches have started.
  int calls = 0;

  @override
  Future<Map<String, Object?>> fetchGreeting({required String name}) async {
    calls++;
    await Future<void>.delayed(delay);
    final failure = this.failure;
    if (failure != null) throw failure;
    return response ?? {'message': 'Hello, $name!', 'recipient': name};
  }
}
