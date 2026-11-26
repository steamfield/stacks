import 'dart:async';

/// What went wrong, in terms the UI can turn into a message and an action.
enum AppErrorKind {
  /// The service could not be reached: offline, refused or timed out.
  network,

  /// The service answered with data this build cannot read.
  invalidResponse,

  /// A `--dart-define` value is invalid.
  config,

  /// Anything else. Usually a bug.
  unexpected,
}

/// The one error type that crosses layers.
///
/// Services throw it, repositories return it inside a `Result`, and views show
/// [userMessage]. [detail] is for logs and is never shown to the user, except
/// for configuration errors, which only a developer sees.
final class AppError implements Exception {
  const AppError(this.kind, this.detail, {this.cause});

  /// An invalid setting, with [detail] naming the key and the rule it broke.
  const AppError.config(String detail) : this(AppErrorKind.config, detail);

  /// Wraps an exception from outside the app's code. An [AppError] passes
  /// through unchanged.
  factory AppError.from(Object error) => switch (error) {
    AppError() => error,
    TimeoutException() => AppError(
      AppErrorKind.network,
      'timed out',
      cause: error,
    ),
    _ => AppError(
      AppErrorKind.unexpected,
      error.runtimeType.toString(),
      cause: error,
    ),
  };

  final AppErrorKind kind;
  final String detail;
  final Object? cause;

  /// The sentence the UI shows for this error.
  String get userMessage => switch (kind) {
    AppErrorKind.network =>
      "Can't reach the service. Check your connection and try again.",
    AppErrorKind.invalidResponse =>
      "The service sent a reply this version can't read. Try again later.",
    AppErrorKind.config => 'This build has an invalid setting: $detail',
    AppErrorKind.unexpected => 'Something went wrong. Try again.',
  };

  /// Whether offering "Try again" makes sense.
  bool get retryable => kind != AppErrorKind.config;

  @override
  String toString() => 'AppError(${kind.name}): $detail';
}
