import '../data/repositories/greeting_repository.dart';
import '../data/services/fake_greeting_service.dart';
import 'app_config.dart';

/// The repositories the app shares across screens, built once at startup.
///
/// Views never see this object. The router builds each screen's view model
/// from it, so a test can swap any repository by passing its own instance.
final class AppDependencies {
  const AppDependencies({required this.greetingRepository});

  /// Every repository backed by an in-memory fake service.
  factory AppDependencies.fake(AppConfig config) => AppDependencies(
    greetingRepository: GreetingRepository(
      service: FakeGreetingService(delay: config.serviceDelay),
      name: config.greetingName,
    ),
  );

  final GreetingRepository greetingRepository;
}
