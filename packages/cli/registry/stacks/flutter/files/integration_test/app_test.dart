import 'package:app/config/app_config.dart';
import 'package:app/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

// Runs on a simulator or device through `make test-ios`, against the app as
// `main` builds it: real config parsing, logging and the fake service delay.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the app starts and shows the greeting from the repository', (
    tester,
  ) async {
    await tester.pumpWidget(buildRoot(AppConfig.fromEnvironment));
    await tester.pumpAndSettle();

    expect(
      find.text('Hello, ${AppConfig.fromEnvironment().greetingName}!'),
      findsOneWidget,
    );
  });
}
