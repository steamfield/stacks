---
description: Run the full quality gate and fix what fails
---

Run the project's gate and fix everything it reports.

1. Run the project's `check` command (AGENTS.md, Commands). It runs lint, typecheck, and every test suite the project has, including any browser or compiled-binary end-to-end tests.
2. Lint failures: run the project's format command, which fixes formatting and safe lint issues, then fix the rest by hand.
3. Test failures: read the pass, fail, and skip counts of every runner, not just the exit code. For an end-to-end failure, read the runner's saved artifacts (error context, traces, captured output) and the project's logs before guessing.
4. Rerun the failing step on its own until it passes, then the whole `check` command again.

Fix the underlying problem each time. Don't skip or weaken a test, loosen a lint rule, or add a type cast to get green; if one of those is truly the right call, say so and why.

Done when the whole gate passes in one run. Report what you changed to get there.
