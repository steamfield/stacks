import 'package:logging/logging.dart';

import '../utils/app_error.dart';

/// Settings read once at startup from `--dart-define` values.
///
/// Every key has a default, so `flutter run` works with no defines. A value
/// that is set but invalid stops startup with an [AppErrorKind.config] error
/// rather than falling back to the default without a word.
final class AppConfig {
  const AppConfig({
    required this.greetingName,
    required this.serviceDelay,
    required this.logLevel,
  });

  /// Reads the defines compiled into this build.
  factory AppConfig.fromEnvironment() => AppConfig.parse(const {
    'GREETING_NAME': String.fromEnvironment('GREETING_NAME'),
    'SERVICE_DELAY_MS': String.fromEnvironment('SERVICE_DELAY_MS'),
    'LOG_LEVEL': String.fromEnvironment('LOG_LEVEL'),
  });

  /// Validates raw define values. A missing or blank value takes the default.
  factory AppConfig.parse(Map<String, String> values) {
    String? value(String key) {
      final raw = values[key]?.trim();
      return raw == null || raw.isEmpty ? null : raw;
    }

    return AppConfig(
      greetingName: _greetingName(value('GREETING_NAME')),
      serviceDelay: _serviceDelay(value('SERVICE_DELAY_MS')),
      logLevel: _logLevel(value('LOG_LEVEL')),
    );
  }

  static const defaults = AppConfig(
    greetingName: 'world',
    serviceDelay: Duration(milliseconds: 300),
    logLevel: Level.INFO,
  );

  static const maxGreetingName = 40;
  static const maxServiceDelayMs = 10000;

  /// Who the home screen greets.
  final String greetingName;

  /// How long the fake service waits before answering.
  final Duration serviceDelay;

  /// The lowest level that reaches the log.
  final Level logLevel;

  static String _greetingName(String? raw) {
    if (raw == null) return defaults.greetingName;
    if (raw.length > maxGreetingName) {
      throw AppError.config(
        'GREETING_NAME must be at most $maxGreetingName characters.',
      );
    }
    return raw;
  }

  static Duration _serviceDelay(String? raw) {
    if (raw == null) return defaults.serviceDelay;
    final ms = int.tryParse(raw);
    if (ms == null || ms < 0 || ms > maxServiceDelayMs) {
      throw AppError.config(
        'SERVICE_DELAY_MS must be a whole number from 0 to '
        '$maxServiceDelayMs, got "$raw".',
      );
    }
    return Duration(milliseconds: ms);
  }

  static Level _logLevel(String? raw) {
    if (raw == null) return defaults.logLevel;
    final name = raw.toUpperCase();
    for (final level in Level.LEVELS) {
      if (level.name == name) return level;
    }
    final names = Level.LEVELS.map((level) => level.name).join(', ');
    throw AppError.config('LOG_LEVEL must be one of $names, got "$raw".');
  }

  @override
  String toString() =>
      'AppConfig(greetingName: $greetingName, '
      'serviceDelay: ${serviceDelay.inMilliseconds}ms, logLevel: $logLevel)';
}
