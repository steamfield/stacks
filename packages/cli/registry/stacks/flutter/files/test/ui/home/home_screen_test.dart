import 'package:app/data/repositories/greeting_repository.dart';
import 'package:app/data/services/fake_greeting_service.dart';
import 'package:app/ui/core/widgets/error_view.dart';
import 'package:app/ui/home/view_models/home_view_model.dart';
import 'package:app/ui/home/widgets/home_screen.dart';
import 'package:app/utils/app_error.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

Widget _host(FakeGreetingService service) => MaterialApp(
  home: HomeScreen(
    title: 'Home',
    createViewModel: () => HomeViewModel(
      repository: GreetingRepository(service: service, name: 'tester'),
    ),
  ),
);

void main() {
  testWidgets('shows a spinner while loading, then the greeting', (
    tester,
  ) async {
    await tester.pumpWidget(
      _host(FakeGreetingService(delay: const Duration(milliseconds: 100))),
    );
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Hello, tester!'), findsOneWidget);
  });

  testWidgets('shows the user-facing message and recovers on retry', (
    tester,
  ) async {
    const failure = AppError(AppErrorKind.network, 'socket closed');
    final service = FakeGreetingService(failure: failure);
    await tester.pumpWidget(_host(service));
    await tester.pumpAndSettle();

    expect(find.text(failure.userMessage), findsOneWidget);
    expect(find.textContaining('socket closed'), findsNothing);

    service.failure = null;
    await tester.tap(find.text(ErrorView.retryLabel));
    await tester.pumpAndSettle();

    expect(find.text('Hello, tester!'), findsOneWidget);
    expect(service.calls, 2);
  });

  testWidgets('an invalid response offers a retry too', (tester) async {
    await tester.pumpWidget(
      _host(FakeGreetingService(response: {'message': ''})),
    );
    await tester.pumpAndSettle();

    expect(find.byType(ErrorView), findsOneWidget);
    expect(find.text(ErrorView.retryLabel), findsOneWidget);
  });
}
