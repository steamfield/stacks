import 'package:material_ui/material_ui.dart';

import '../../../utils/app_error.dart';
import 'error_view.dart';

/// Shown instead of the app when startup fails, such as on an invalid
/// `--dart-define` value.
class StartupErrorApp extends StatelessWidget {
  const StartupErrorApp({super.key, required this.error});

  final AppError error;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(body: ErrorView(message: error.userMessage)),
    );
  }
}
