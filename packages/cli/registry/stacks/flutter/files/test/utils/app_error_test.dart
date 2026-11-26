import 'dart:async';

import 'package:app/utils/app_error.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('every kind has its own user-facing message', () {
    final messages = {
      for (final kind in AppErrorKind.values)
        AppError(kind, 'detail').userMessage,
    };
    expect(messages, hasLength(AppErrorKind.values.length));
  });

  test('the detail stays out of the message except for config errors', () {
    const secret = 'socket closed by 10.0.0.1';
    for (final kind in AppErrorKind.values.where(
      (kind) => kind != AppErrorKind.config,
    )) {
      expect(AppError(kind, secret).userMessage, isNot(contains(secret)));
    }
    expect(
      const AppError.config('LOG_LEVEL is wrong').userMessage,
      contains('LOG_LEVEL is wrong'),
    );
  });

  test('only config errors offer a retry', () {
    expect(const AppError.config('x').retryable, isFalse);
    expect(const AppError(AppErrorKind.network, 'x').retryable, isTrue);
  });

  test('from keeps an AppError and classifies other exceptions', () {
    const original = AppError(AppErrorKind.invalidResponse, 'bad json');
    expect(AppError.from(original), same(original));
    expect(AppError.from(TimeoutException('slow')).kind, AppErrorKind.network);
    final wrapped = AppError.from(const FormatException('nope'));
    expect(wrapped.kind, AppErrorKind.unexpected);
    expect(wrapped.cause, isA<FormatException>());
  });
}
