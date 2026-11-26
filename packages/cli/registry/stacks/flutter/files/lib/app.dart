import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import 'config/dependencies.dart';
import 'routing/router.dart';

/// The root widget: theme and router over [dependencies].
class App extends StatefulWidget {
  const App({super.key, required this.dependencies});

  /// The name in the app bar and the Android task switcher. The home screen
  /// name on the device comes from the iOS and Android projects.
  static const title = 'App';

  final AppDependencies dependencies;

  @override
  State<App> createState() => _AppState();
}

class _AppState extends State<App> {
  late final GoRouter _router = createRouter(
    dependencies: widget.dependencies,
    title: App.title,
  );

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: App.title,
      theme: ThemeData(colorSchemeSeed: Colors.indigo),
      darkTheme: ThemeData(
        colorSchemeSeed: Colors.indigo,
        brightness: Brightness.dark,
      ),
      routerConfig: _router,
    );
  }
}
