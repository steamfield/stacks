# Code Review

## Summary

- Files changed: 138, including untracked files (+2,460/-1,081 lines).
- Change type: Bug fixes and acceptance requirements.
- Scope: QA-01 through QA-11 and recurrence coverage. Fresh application audits remain explicitly pending. The two root harness files were treated as parent-owned.
- Verification: Read-only review; no tests or mutating commands run.

## Fixes

1. packages/cli/registry/stacks/mobile-expo/files/scripts/dev.ts:82 — Safety and tests (items 8 and 5): finished resolves on close, which waits for stdout/stderr to close. If the API runner exits while a surviving watcher inherits either pipe, api.finished stays pending and the race at line 173 never starts cleanup. The failure fixture hides this by spawning its descendant with stdio: ignore. Observe process exit separately from pipe closure, trigger owned-group cleanup on exit, and bound output draining. Add a real regression where the API parent fails while its descendant retains inherited output pipes.

2. packages/cli/registry/stacks/typescript-cli/files/docs/guidance/typescript-cli/effect-services.md.tmpl:3 — Plans and docs (item 7): This shared authoritative guide still unconditionally requires loading the generated effect skill before writing code. A fresh scaffold has no such skill, so the composed instructions retain QA-04’s bootstrap contradiction despite the corrected Effect fragment. Make this instruction conditional and give the same declarations-first bootstrap order. Extend the bootstrap regression to inspect the stack guidance alongside the fragment.

3. packages/cli/tests/library-qa-guidance.test.ts:47 — Tests (item 5): The Markdown-link check skips Codex/OpenCode skills and Cursor rules because it only admits docs/guidance/ and .claude/rules/. Consequently, the sixteen cases named guidance and native references resolve do not validate the newly added native links. Include those adapter entry files in link resolution so an incorrect relative native link fails its composed-adapter case.

4. packages/cli/tests/mobile-dev-ownership.test.ts:11 — Safety and tests (items 8 and 5): Failure cleanup sends SIGKILL only to the launcher’s group, but the launcher starts API/mobile children in separate detached groups. If readiness or another assertion fails before normal shutdown, killing the launcher prevents its cleanup and leaves those groups running after the temporary project is removed. Attempt graceful launcher shutdown first, then perform bounded cleanup of the recorded fixture-owned groups before deleting the workspace. Verify cleanup when readiness fails.

## Verdict

NEEDS FIXES — Resolve the mobile lifecycle hang, bootstrap contradiction, and regression coverage/cleanup gaps before accepting the completed portion.

## Author resolution

All four findings were applied after this single review. Process exit now initiates
cleanup independently of pipe closure, output draining is bounded, all adapter
entry links are resolved, and the stack's Effect bootstrap is conditional.
Fixture cleanup attempts graceful termination, then reaps only recorded owned
groups with bounded waits. New tests cover inherited output pipes and failed
readiness with an unresponsive launcher. Red/green and revert results, final
checks and remaining application audits are recorded in plans/qa-gap-closure.md.
No second reviewer pass was run.
