import 'package:app/data/repositories/greeting_repository.dart';
import 'package:app/data/services/fake_greeting_service.dart';
import 'package:app/ui/home/view_models/home_view_model.dart';
import 'package:app/utils/app_error.dart';
import 'package:flutter_test/flutter_test.dart';

HomeViewModel _viewModel(FakeGreetingService service) => HomeViewModel(
  repository: GreetingRepository(service: service, name: 'tester'),
);

void main() {
  test('starts loading, then shows the greeting', () async {
    final viewModel = _viewModel(FakeGreetingService());
    addTearDown(viewModel.dispose);
    final seen = <HomeState>[];
    viewModel.addListener(() => seen.add(viewModel.state));

    expect(viewModel.state, isA<HomeLoading>());
    await viewModel.load();

    expect(seen, [isA<HomeLoading>(), isA<HomeContent>()]);
    expect((viewModel.state as HomeContent).greeting.message, 'Hello, tester!');
  });

  test('a failure becomes HomeFailure, and a retry recovers', () async {
    final service = FakeGreetingService(
      failure: const AppError(AppErrorKind.network, 'offline'),
    );
    final viewModel = _viewModel(service);
    addTearDown(viewModel.dispose);

    await viewModel.load();
    expect(
      viewModel.state,
      isA<HomeFailure>().having(
        (state) => state.error.kind,
        'kind',
        AppErrorKind.network,
      ),
    );

    service.failure = null;
    await viewModel.load();
    expect(viewModel.state, isA<HomeContent>());
    expect(service.calls, 2);
  });

  test('a load that finishes after dispose changes nothing', () async {
    final viewModel = _viewModel(
      FakeGreetingService(delay: const Duration(milliseconds: 10)),
    );
    final pending = viewModel.load();
    viewModel.dispose();
    await pending;
    expect(viewModel.state, isA<HomeLoading>());
  });
}
