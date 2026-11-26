import 'dart:async';
import 'dart:developer' as developer;

import 'package:logging/logging.dart';

StreamSubscription<LogRecord>? _subscription;

/// Sends every record at or above [level] to [sink].
///
/// The default sink is `dart:developer`'s `log`, which DevTools and the
/// `flutter run` console show with the logger name and level. Calling this
/// again replaces the previous sink, so tests can capture records.
void configureLogging(
  Level level, {
  void Function(LogRecord record) sink = _toDeveloperLog,
}) {
  Logger.root.level = level;
  unawaited(_subscription?.cancel());
  _subscription = Logger.root.onRecord.listen(sink);
}

void _toDeveloperLog(LogRecord record) {
  developer.log(
    record.message,
    time: record.time,
    sequenceNumber: record.sequenceNumber,
    level: record.level.value,
    name: record.loggerName,
    error: record.error,
    stackTrace: record.stackTrace,
  );
}
