import 'package:app/config/app_config.dart';
import 'package:app/config/dependencies.dart';
import 'package:app/routing/router.dart';
import 'package:app/ui/core/widgets/not_found_screen.dart';
import 'package:app/ui/home/widgets/home_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  testWidgets('an unknown location shows the not-found page, which goes home', (
    tester,
  ) async {
    final router = createRouter(
      dependencies: AppDependencies.fake(
        AppConfig.parse({'SERVICE_DELAY_MS': '0'}),
      ),
      title: 'Test',
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    expect(find.byType(HomeScreen), findsOneWidget);

    router.go('/missing');
    await tester.pumpAndSettle();
    expect(find.byType(NotFoundScreen), findsOneWidget);
    expect(find.textContaining('/missing'), findsOneWidget);

    await tester.tap(find.text('Go home'));
    await tester.pumpAndSettle();
    expect(find.text('Hello, world!'), findsOneWidget);
  });
}
