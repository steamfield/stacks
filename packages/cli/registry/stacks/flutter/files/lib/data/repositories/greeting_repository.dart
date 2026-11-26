import 'package:logging/logging.dart';

import '../../domain/models/greeting.dart';
import '../../utils/app_error.dart';
import '../../utils/result.dart';
import '../services/greeting_service.dart';

/// The single source of greetings for the UI.
///
/// Turns the service's JSON into a [Greeting], and every failure into an
/// [Err] holding an [AppError], logged once here.
final class GreetingRepository {
  GreetingRepository({required this._service, required this._name});

  static final _log = Logger('GreetingRepository');

  final GreetingService _service;
  final String _name;

  Future<Result<Greeting>> fetchGreeting() async {
    try {
      final json = await _service.fetchGreeting(name: _name);
      return Ok(_decode(json));
    } on Exception catch (exception, stackTrace) {
      final error = AppError.from(exception);
      final level = error.kind == AppErrorKind.unexpected
          ? Level.SEVERE
          : Level.WARNING;
      _log.log(level, 'fetchGreeting failed: $error', exception, stackTrace);
      return Err(error);
    }
  }

  static Greeting _decode(Map<String, Object?> json) {
    final message = json['message'];
    final recipient = json['recipient'];
    if (message is! String || message.isEmpty || recipient is! String) {
      throw const AppError(
        AppErrorKind.invalidResponse,
        'greeting payload needs a non-empty message and a recipient',
      );
    }
    return Greeting(message: message, recipient: recipient);
  }
}
