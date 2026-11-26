---
paths:
  - "**/*.dart"
  - "pubspec.yaml"
  - "analysis_options.yaml"
---

- `make analyze` reports nothing and `make fmt-check` passes before you finish. Fix findings; an `// ignore:` needs its reason on the same line. Keep the strict language modes and every rule in `analysis_options.yaml`.
- No implicit `dynamic`: check JSON types with `is` and turn a mismatch into `AppError(AppErrorKind.invalidResponse, ...)`.
- Inside `lib/`, import with relative paths; tests import `package:app/...`.
- Material comes from `package:material_ui/material_ui.dart`, never the deprecated `package:flutter/material.dart`.
- Await every future or wrap it in `unawaited(...)`. Log with `Logger('<ClassName>')`, never `print`.
- Add packages with `flutter pub add <name>` (`dev:<name>` for tooling), never by typing a version into `pubspec.yaml`.

Reasons and examples: [docs/guidance/flutter.md](../../../docs/guidance/flutter.md), "Dart style".
