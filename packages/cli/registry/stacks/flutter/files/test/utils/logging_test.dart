import 'package:app/utils/logging.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:logging/logging.dart';

void main() {
  test('records below the configured level are dropped', () async {
    final records = <LogRecord>[];
    configureLogging(Level.WARNING, sink: records.add);

    Logger('test').info('quiet');
    Logger('test').warning('loud');
    await Future<void>.delayed(Duration.zero);

    expect(records.map((record) => record.message), ['loud']);
    expect(records.single.loggerName, 'test');
  });

  test('configuring again replaces the previous sink', () async {
    final first = <LogRecord>[];
    final second = <LogRecord>[];
    configureLogging(Level.ALL, sink: first.add);
    configureLogging(Level.ALL, sink: second.add);

    Logger('test').fine('once');
    await Future<void>.delayed(Duration.zero);

    expect(first, isEmpty);
    expect(second, hasLength(1));
  });
}
