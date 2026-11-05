---
paths:
  - "packages/cli/src/**"
  - "packages/cli/tests/**"
  - "packages/cli/scripts/**"
  - "packages/cli/e2e/**"
---

# Verification

## Read the gate's counts

A run that did nothing and a run that succeeded both exit 0, so a clean exit is not a pass. After the gate (`bun run check`, or `rr check`, whose partition logs are under its `result` event's `details.log_dir`), read the output: confirm the Vitest file and test counts are what you expect for the change (a new test file shows up in the count) and that the e2e section actually packed and installed the Node package and ran its tests. When work is done by a subprocess, check what the subprocess printed, not the wrapper's status.

## Revert-verify every new regression test

A test that passes with and without the fix isn't testing the fix. Reintroduce the bug by hand by editing the source, run the scoped test (`bun run test:unit tests/<file>.test.ts` in `packages/cli/`), confirm it fails with the message you expect, then edit the fix back. Edit rather than use git, so nothing is discarded and the destructive-command hook stays out of it. If the revert doesn't go red, fix the test before moving on.

## Check the tree after every commit

A green commit can still be incomplete. Lefthook's pre-commit formats and restages safe fixes, which can leave part of the change in the working tree while the commit itself passes. Right after any hook-running commit, run `git status --porcelain`. Non-empty output means something didn't land; stage it and amend.

## Run the real command

For any CLI change, run the changed command in all three audiences as `rules/cli/cli.md` "Verifying UX" describes. Tests through `runCli` don't cover the Node bundle's startup or the dev wrapper. Running it is half the job: `rules/cli/testing.md` "Manual QA as the user" covers judging the output as the agent that will use it, and the QA note that goes in the report.

When something fails, read the logs AGENTS.md "Debugging" names before guessing.
