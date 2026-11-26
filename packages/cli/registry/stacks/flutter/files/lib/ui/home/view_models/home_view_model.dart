import 'package:flutter/foundation.dart';

import '../../../data/repositories/greeting_repository.dart';
import '../../../domain/models/greeting.dart';
import '../../../utils/app_error.dart';
import '../../../utils/result.dart';

/// What the home screen can show. The view switches on it exhaustively.
sealed class HomeState {
  const HomeState();
}

final class HomeLoading extends HomeState {
  const HomeLoading();
}

final class HomeContent extends HomeState {
  const HomeContent(this.greeting);

  final Greeting greeting;
}

final class HomeFailure extends HomeState {
  const HomeFailure(this.error);

  final AppError error;
}

/// Holds the home screen's state and the one action that changes it.
///
/// The screen that creates it owns it and disposes it. A load that finishes
/// after disposal is dropped.
final class HomeViewModel extends ChangeNotifier {
  HomeViewModel({required this._repository});

  final GreetingRepository _repository;
  HomeState _state = const HomeLoading();
  bool _disposed = false;

  HomeState get state => _state;

  /// Fetches the greeting, showing [HomeLoading] until it arrives.
  Future<void> load() async {
    _emit(const HomeLoading());
    final result = await _repository.fetchGreeting();
    if (_disposed) return;
    _emit(switch (result) {
      Ok(:final value) => HomeContent(value),
      Err(:final error) => HomeFailure(error),
    });
  }

  void _emit(HomeState state) {
    _state = state;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
