import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../../core/widgets/error_view.dart';
import '../view_models/home_view_model.dart';

/// The first screen: loading, the greeting, or an error with "Try again".
///
/// It creates its view model through [createViewModel] in `initState` and
/// disposes it with itself, so a rebuild of the route never makes a second one.
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.title,
    required this.createViewModel,
  });

  final String title;
  final HomeViewModel Function() createViewModel;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final HomeViewModel _viewModel = widget.createViewModel();

  @override
  void initState() {
    super.initState();
    unawaited(_viewModel.load());
  }

  @override
  void dispose() {
    _viewModel.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: ListenableBuilder(
        listenable: _viewModel,
        builder: (context, _) => switch (_viewModel.state) {
          HomeLoading() => const Center(child: CircularProgressIndicator()),
          HomeContent(:final greeting) => Center(
            child: Text(
              greeting.message,
              style: Theme.of(context).textTheme.headlineMedium,
              textAlign: TextAlign.center,
            ),
          ),
          HomeFailure(:final error) => ErrorView(
            message: error.userMessage,
            onRetry: error.retryable ? _viewModel.load : null,
          ),
        },
      ),
    );
  }
}
