---
paths:
  - "**/*.{ts,tsx,js,jsx,mjs,cjs}"
  - "**/*.py"
  - "**/*.go"
  - "**/*.rs"
---

# Error handling

Read `docs/guidance/engineering/errors.md` before changing failure or recovery paths. It covers typed errors, cause chains, reporting boundaries and explicit fallbacks.

The `ce:handling-errors` skill goes deeper when installed. Follow the Error handling section of `AGENTS.md` for the project's error types and where errors become responses or exit codes.
