import 'package:app/config/app_config.dart';
import 'package:app/data/repositories/greeting_repository_remote.dart';
import 'package:app/data/services/fake_greeting_service.dart';
import 'package:app/main.dart';
import 'package:app/ui/home/view_models/home_view_model.dart';
import 'package:app/ui/home/widgets/home_screen.dart';
import 'package:app/utils/app_error.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

// Flutter's accessibility guidelines: tap target sizes on both platforms,
// labels on tappable widgets, and text contrast. Each new screen adds a case.
Future<void> _expectGuidelines(WidgetTester tester) async {
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
  await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
  await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
  await expectLater(tester, meetsGuideline(textContrastGuideline));
}

void main() {
  testWidgets('the home screen meets the guidelines', (tester) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      buildRoot(() => AppConfig.parse({AppConfig.serviceDelayKey: '0'})),
    );
    await tester.pumpAndSettle();

    await _expectGuidelines(tester);
    semantics.dispose();
  });

  testWidgets('the error view fits and meets the guidelines at 3x text', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    tester.platformDispatcher.textScaleFactorTestValue = 3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpWidget(
      MaterialApp(
        home: HomeScreen(
          title: 'Home',
          createViewModel: () => HomeViewModel(
            repository: GreetingRepositoryRemote(
              service: FakeGreetingService(
                failure: const AppError(AppErrorKind.network, 'offline'),
              ),
              name: 'tester',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final scaler = MediaQuery.textScalerOf(
      tester.element(find.byType(HomeScreen)),
    );
    expect(scaler.scale(10), 30);
    // An overflow at large text sizes is reported as an exception.
    expect(tester.takeException(), isNull);
    await _expectGuidelines(tester);
    semantics.dispose();
  });
}
