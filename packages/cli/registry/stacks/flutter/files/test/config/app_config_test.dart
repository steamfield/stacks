import 'package:app/config/app_config.dart';
import 'package:app/utils/app_error.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:logging/logging.dart';

TypeMatcher<AppError> _configError(String key) => isA<AppError>()
    .having((error) => error.kind, 'kind', AppErrorKind.config)
    .having((error) => error.detail, 'detail', contains(key));

void main() {
  test('missing and blank values take the defaults', () {
    final config = AppConfig.parse({'GREETING_NAME': '  ', 'LOG_LEVEL': ''});
    expect(config.greetingName, AppConfig.defaults.greetingName);
    expect(config.serviceDelay, AppConfig.defaults.serviceDelay);
    expect(config.logLevel, AppConfig.defaults.logLevel);
  });

  test('a build with no defines gets the defaults', () {
    expect(
      AppConfig.fromEnvironment().greetingName,
      AppConfig.defaults.greetingName,
    );
  });

  test('reads and trims valid values', () {
    final config = AppConfig.parse({
      'GREETING_NAME': ' Ada ',
      'SERVICE_DELAY_MS': '0',
      'LOG_LEVEL': 'fine',
    });
    expect(config.greetingName, 'Ada');
    expect(config.serviceDelay, Duration.zero);
    expect(config.logLevel, Level.FINE);
  });

  test('rejects a delay that is not a whole number in range', () {
    for (final raw in ['soon', '-1', '1.5', '10001']) {
      expect(
        () => AppConfig.parse({'SERVICE_DELAY_MS': raw}),
        throwsA(_configError('SERVICE_DELAY_MS')),
        reason: raw,
      );
    }
  });

  test('rejects an unknown log level and lists the valid ones', () {
    expect(
      () => AppConfig.parse({'LOG_LEVEL': 'verbose'}),
      throwsA(
        _configError('LOG_LEVEL')
            .having((error) => error.detail, 'detail', contains('WARNING')),
      ),
    );
  });

  test('rejects a greeting name over the limit', () {
    expect(
      () => AppConfig.parse({
        'GREETING_NAME': 'x' * (AppConfig.maxGreetingName + 1),
      }),
      throwsA(_configError('GREETING_NAME')),
    );
  });
}
