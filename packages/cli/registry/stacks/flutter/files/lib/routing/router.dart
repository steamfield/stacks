import 'package:go_router/go_router.dart';

import '../config/dependencies.dart';
import '../ui/core/widgets/not_found_screen.dart';
import '../ui/home/view_models/home_view_model.dart';
import '../ui/home/widgets/home_screen.dart';
import 'routes.dart';

/// The app's routes. Each builder hands its screen a factory for a view model
/// built from [dependencies], never a repository.
GoRouter createRouter({
  required AppDependencies dependencies,
  required String title,
}) {
  return GoRouter(
    initialLocation: Routes.home,
    routes: [
      GoRoute(
        path: Routes.home,
        builder: (context, state) => HomeScreen(
          title: title,
          createViewModel: () =>
              HomeViewModel(repository: dependencies.greetingRepository),
        ),
      ),
    ],
    errorBuilder: (context, state) =>
        NotFoundScreen(location: state.uri.toString()),
  );
}
