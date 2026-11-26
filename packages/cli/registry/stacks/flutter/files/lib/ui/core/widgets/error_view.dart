import 'package:material_ui/material_ui.dart';

/// A centered error message with an optional "Try again" button.
///
/// Every screen shows failures through it, with `AppError.userMessage` as
/// [message].
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.message, this.onRetry});

  static const retryLabel = 'Try again';

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final onRetry = this.onRetry;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              FilledButton(onPressed: onRetry, child: const Text(retryLabel)),
            ],
          ],
        ),
      ),
    );
  }
}
