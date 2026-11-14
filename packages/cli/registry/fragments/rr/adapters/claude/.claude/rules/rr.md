---
paths:
  - ".rr.yaml"
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/*_test.*"
  - "**/test_*.py"
  - "**/tests/**"
  - "**/test/**"
---

# Running tests with rr

This project runs its test suites through rr, on remote machines or queued on this one. The task names and when to use them are in the rr section of `AGENTS.md`. Load the `rr:rr` skill for command syntax, config, and troubleshooting; `/rr:setup` walks through first-time setup.

- `.claude/hooks/rr-route-tests.sh` rewrites the test commands listed in `.claude/hooks/rr-routes.txt` to their rr task, so a command you send may run as `rr <task>`. A new test task adds its line there.
- Use the named task (`rr <task>`) over an ad-hoc `rr run "..."`; in the local queue, run an ad-hoc command as `rr run --local "<cmd>"` so it takes the lock. Tasks run from the project root; pass test filters after `--` (`rr test -- -k name`).
- Scope runs while iterating (a file, a test name); save the full suite for the final check.
- Read the final `{"type":"result",...}` event on stderr: `details.failures` has each failing test with file and line, `details.no_tests` means nothing was collected (not a pass), and `details.log_file` has the full output. Read the log instead of rerunning.
- If rr fails before the command starts, branch on `error.code` (`LOCK_HELD`: another run holds the host, wait, or `rr unlock <host>` (`rr unlock --all` in the local queue) if the holder is gone; `DEPENDENCY_MISSING`: a tool is missing on the host, see `rr provision`).
- Never nest rr inside `rr exec`, and don't pipe test output through `tail`/`grep` without pipefail: the pipe's status hides failures.
