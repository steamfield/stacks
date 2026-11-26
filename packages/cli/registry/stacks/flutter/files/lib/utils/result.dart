import 'app_error.dart';

/// The outcome of an operation that can fail with an [AppError].
///
/// Repositories return it, so view models handle failure with an exhaustive
/// `switch` instead of `try`/`catch`.
sealed class Result<T> {
  const Result();
}

/// Success, carrying [value].
final class Ok<T> extends Result<T> {
  const Ok(this.value);

  final T value;
}

/// Failure, carrying [error].
final class Err<T> extends Result<T> {
  const Err(this.error);

  final AppError error;
}
