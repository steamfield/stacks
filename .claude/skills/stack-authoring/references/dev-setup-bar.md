# The dev-setup bar

Every bundled stack ships a full development setup, not only a working slice. Check a new or
revised stack against this list before handing it back, and name each item that doesn't apply
with the reason (a platform with no end-to-end runner, say). Each item is enforced by a verify
step or shipped config that a verify step reads; an item that only appears in prose doesn't count.

- Formatter: the language's standard formatter, configured in a shipped file and checked (not
  applied) by a verify step.
- Linter: the strictest maintained ruleset the ecosystem treats as normal, configured in a
  shipped file, run by a verify step with warnings failing the step.
- Types and compiler: the strictest settings the language offers (TypeScript `strict` plus the
  unchecked-index and exact-optional options the stack can keep green, Swift strict concurrency
  checking, Dart's strict analysis modes, warnings as errors in the build). Loosening one needs a
  Gotcha naming why.
- Tests: the language's current standard test framework (Swift Testing for Swift unit tests,
  XCTest only for UI tests; Vitest or the framework's own runner for TypeScript; `flutter_test`
  for Flutter). Unit tests beside the code, plus UI or integration tests and an end-to-end flow
  wherever the platform has a runner (XCUITest, `integration_test`, Maestro or Detox, Playwright).
  The end-to-end flow exercises the proving slice, not a placeholder.
- Coverage: a command that reports line coverage for unit-tested code and fails below a floor
  recorded in the project's own config (default 80% of lines; the person can change it). The
  floor lives in a shipped config file, not in the brief.
- CI: the stack composes with `ci-github`, and the generated workflow runs every verify step on a
  runner able to run it (macOS for `xcodebuild`, `xcrun` or a simulator). Check the composed
  workflow, not only the stack.
- Git hooks and agent config: compose with the default fragments that provide them; ship none of
  their files.
- The slice's boundaries: config with validated defaults, the error type and its mapping, and
  structured logging, as "The proving slice" in `SKILL.md` describes.
- Accessibility basics for UI stacks: labels on interactive elements and text that scales (Dynamic
  Type, text scaling), checked by a test where the platform's tooling can.
- Secrets stay out of source: `.env.example` or the platform's equivalent, ignored real files, and
  no key in shipped code.

Versions never appear in `files/`; a tool's release is the agent's to resolve at Setup. Every new
tool needs a dependency card and an allowlist row (the row is a maintainer's step to report).
