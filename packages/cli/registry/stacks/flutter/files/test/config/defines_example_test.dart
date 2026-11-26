import 'dart:convert';
import 'dart:io';

import 'package:app/config/app_config.dart';
import 'package:flutter_test/flutter_test.dart';

// config/defines.example.json is the committed template for the gitignored
// config/defines.json that `--dart-define-from-file` reads.
void main() {
  late Map<String, Object?> example;

  setUp(() {
    final decoded = jsonDecode(
      File('config/defines.example.json').readAsStringSync(),
    );
    expect(decoded, isA<Map<String, Object?>>());
    example = decoded as Map<String, Object?>;
  });

  test('lists exactly the defines AppConfig reads', () {
    expect(example.keys.toSet(), AppConfig.keys);
  });

  test('holds string values AppConfig accepts', () {
    final values = {
      for (final MapEntry(:key, :value) in example.entries)
        if (value is String) key: value,
    };
    expect(values, hasLength(example.length), reason: 'values are strings');
    expect(() => AppConfig.parse(values), returnsNormally);
  });
}
