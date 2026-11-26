import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:logging/logging.dart';

import 'app.dart';
import 'config/app_config.dart';
import 'config/dependencies.dart';
import 'ui/core/widgets/startup_error_app.dart';
import 'utils/app_error.dart';
import 'utils/logging.dart';

final _log = Logger('main');

void main() {
  _logUncaughtErrors();
  runApp(buildRoot(AppConfig.fromEnvironment));
}

/// Reads the config, starts logging and returns the root widget: the app, or
/// [StartupErrorApp] when a define is invalid.
Widget buildRoot(AppConfig Function() readConfig) {
  final AppConfig config;
  try {
    config = readConfig();
  } on AppError catch (error) {
    configureLogging(AppConfig.defaults.logLevel);
    _log.severe('Invalid configuration: ${error.detail}');
    return StartupErrorApp(error: error);
  }
  configureLogging(config.logLevel);
  _log.info('Starting with $config');
  return App(dependencies: AppDependencies.fake(config));
}

// Kept out of buildRoot: flutter_test fails a test that leaves
// FlutterError.onError changed.
void _logUncaughtErrors() {
  final presentError = FlutterError.onError;
  FlutterError.onError = (details) {
    _log.severe('Framework error', details.exception, details.stack);
    presentError?.call(details);
  };
  PlatformDispatcher.instance.onError = (error, stackTrace) {
    _log.severe('Uncaught error', error, stackTrace);
    return true;
  };
}
