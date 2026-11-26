import 'package:app/data/repositories/greeting_repository.dart';
import 'package:app/data/services/fake_greeting_service.dart';
import 'package:app/data/services/greeting_service.dart';
import 'package:app/domain/models/greeting.dart';
import 'package:app/utils/app_error.dart';
import 'package:app/utils/logging.dart';
import 'package:app/utils/result.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:logging/logging.dart';

final class _ThrowingService implements GreetingService {
  _ThrowingService(this.exception);

  final Exception exception;

  @override
  Future<Map<String, Object?>> fetchGreeting({required String name}) =>
      Future.error(exception);
}

AppError _errorOf(Result<Greeting> result) => switch (result) {
  Err(:final error) => error,
  Ok(:final value) => fail('expected an error, got $value'),
};

void main() {
  late List<LogRecord> logs;

  setUp(() {
    logs = [];
    configureLogging(Level.ALL, sink: logs.add);
  });

  test('turns the service payload into a Greeting', () async {
    final repository = GreetingRepository(
      service: FakeGreetingService(),
      name: 'Ada',
    );
    final result = await repository.fetchGreeting();
    expect(
      result,
      isA<Ok<Greeting>>().having(
        (ok) => ok.value,
        'value',
        const Greeting(message: 'Hello, Ada!', recipient: 'Ada'),
      ),
    );
    expect(logs, isEmpty);
  });

  test('a payload missing its message is an invalid response', () async {
    final repository = GreetingRepository(
      service: FakeGreetingService(response: {'recipient': 'Ada'}),
      name: 'Ada',
    );
    final error = _errorOf(await repository.fetchGreeting());
    expect(error.kind, AppErrorKind.invalidResponse);
    expect(logs.single.level, Level.WARNING);
  });

  test('a network failure from the service passes through', () async {
    final repository = GreetingRepository(
      service: FakeGreetingService(
        failure: const AppError(AppErrorKind.network, 'offline'),
      ),
      name: 'Ada',
    );
    expect(
      _errorOf(await repository.fetchGreeting()).kind,
      AppErrorKind.network,
    );
  });

  test('any other exception becomes unexpected and is logged severe', () async {
    final repository = GreetingRepository(
      service: _ThrowingService(const FormatException('bad bytes')),
      name: 'Ada',
    );
    final error = _errorOf(await repository.fetchGreeting());
    await Future<void>.delayed(Duration.zero);
    expect(error.kind, AppErrorKind.unexpected);
    expect(logs.single.level, Level.SEVERE);
    expect(logs.single.error, isA<FormatException>());
  });
}
