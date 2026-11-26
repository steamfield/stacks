---
paths:
  - "project.yml"
  - "Makefile"
  - ".swiftlint.yml"
  - ".swift-format"
---

- project.yml is the Xcode project. Change targets, settings and schemes here, then `make project`. Never edit or commit `*.xcodeproj`; a hook denies writes inside it.
- Keep `SWIFT_VERSION` 6, `SWIFT_STRICT_CONCURRENCY: complete` and both `*_TREAT_WARNINGS_AS_ERRORS` settings.
- Simulator builds pass `CODE_SIGNING_ALLOWED=NO`; never add a team ID or signing identity to project.yml.
- Never write a simulator name or OS version into the Makefile or project.yml; `scripts/sim-destination.sh` picks one at run time.
- Keep every enabled SwiftLint rule. A rule that is wrong for one line gets `// swiftlint:disable:next <rule>` with a reason, never a config change.
- Piped xcodebuild recipes start with `$(STRICT)` so a failed build still fails make.

Reasons: [docs/DEVELOPMENT.md](../../../docs/DEVELOPMENT.md).
