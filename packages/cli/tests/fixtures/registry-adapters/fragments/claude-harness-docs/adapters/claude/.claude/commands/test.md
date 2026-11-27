---
description: Run tests scoped to what changed, then the full suite
argument-hint: "[test file or -t pattern]"
---

Run tests for: $ARGUMENTS

1. Find the right runner in AGENTS.md: a project can have more than one (a unit runner and a separate one for some directories), and each must only run its own files. If a file or pattern was given, run just that with its runner (a single file, or `-t "<name>"`). Otherwise pick the test files covering what changed (`git diff --name-only` against the last commit) and run those.
2. When they pass, run the project's full `test` command.
3. For a failure, read the assertion and the stack, find the cause, and fix the code (or the test, if the test was wrong: say which and why). Never skip, weaken, or delete a test to get green, and never swap one runner for another.

Report the pass/fail/skip counts from the final run.
