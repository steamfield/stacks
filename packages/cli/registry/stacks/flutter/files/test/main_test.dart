import 'package:app/app.dart';
import 'package:app/config/app_config.dart';
import 'package:app/main.dart';
import 'package:app/ui/core/widgets/startup_error_app.dart';
import 'package:app/utils/app_error.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('a valid config starts the app', (tester) async {
    await tester.pumpWidget(
      buildRoot(() => AppConfig.parse({'SERVICE_DELAY_MS': '0'})),
    );
    await tester.pumpAndSettle();
    expect(find.byType(App), findsOneWidget);
    expect(find.text('Hello, world!'), findsOneWidget);
  });

  testWidgets('an invalid define shows the startup error screen', (
    tester,
  ) async {
    const error = AppError.config('LOG_LEVEL must be one of the levels.');
    await tester.pumpWidget(buildRoot(() => throw error));
    expect(find.byType(StartupErrorApp), findsOneWidget);
    expect(find.text(error.userMessage), findsOneWidget);
  });
}
