import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../routing/routes.dart';

/// The router's error page, shown for a location no route matches.
class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key, required this.location});

  final String location;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Not found')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Nothing lives at $location.'),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => context.go(Routes.home),
              child: const Text('Go home'),
            ),
          ],
        ),
      ),
    );
  }
}
