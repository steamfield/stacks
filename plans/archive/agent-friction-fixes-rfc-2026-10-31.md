# Agent friction fixes

Date: 2026-10-31. Status: EXECUTED 2026-10-31. Merged to this repo's `main` (`fix/agent-friction`) and stacks-api's `main` (`docs/agent-friction`); nothing pushed. A code review of the branches added: delegate.sh reads cache entries one by one, anchors the slug with `\z` and says on stderr when a cache it found sends it to the fallback; release.ts refuses unknown arguments; decorate's note reads "the entry changed since this card was stamped", since it also fires when re-approving a reviewed card; the seed README names every file type the test scans.

## Context

A post-mortem over the six most recent sessions in this project (the transcripts, mined into a digest and 49 located friction points, then read at each point) found seven recurring sources of friction. One is already fixed: the user's preference to have agents run steps and finish work instead of handing them over is now a memory (`run-steps-yourself`). This RFC fixes the rest in the two repositories involved: this one and the hosted API's checkout, `stacks-api`.

Scope stays at the friction found.

## Changes

### F1. Read before Edit (both repositories)

Evidence: 23 Edit or Write calls failed with "File has not been read yet" in two of the six sessions, each time a batch of edits on a file the agent had read with `cat` or `sed`. The Edit tool accepts only files opened with Read; a Bash read doesn't count, and auto mode encourages Bash reads. Parallel Edits on an unread file all fail.

Change: in this repo's `CLAUDE.md` "Claude Code" section, beside the "Edit files only with the Edit and Write tools" bullet, and as a new bullet in stacks-api's `CLAUDE.md` "Claude Code" section: open a file with the Read tool before editing it; a `cat`, `sed` or `grep` read doesn't count, and every Edit sent on an unread file fails.

### F2. A format-only release (this repo)

Evidence: publishing `@steamfield/stacks-format` 0.7.0 alone had no command, so the agent wrote out six steps (gate, push, detached worktree, pack, list, publish) and the user ran them by hand, asking for "as close to a 1-liner as possible". `bun run release` always publishes both packages and tags the CLI.

Change: `scripts/release.ts` takes `--format-only`, which chooses the package list (`format` only) from the flag. Under it the script skips the CLI tag check, the marketplace pin check, the CLI's telemetry pack and the tagging; it keeps the clean-tree and `origin/main` checks, the detached worktree, pack, the npm integrity check, publish and the wait for the registry. `--dry-run` combines with it. Root `package.json` gets `release:format` (`bun scripts/release.ts --format-only`). Safe by construction: the published CLI pins format exactly (`workspace:*` is rewritten at pack time), and a later full release refuses to re-publish a format version whose integrity differs.

Test, in `tests/scripts/release.test.ts`: a format-only dry run with `formatPublished: false` reports that it would publish format, and the command log has no tag lookup, no CLI pack, and no `npm view` for the CLI.

Docs: the release row in `AGENTS.md` "Commands", the header comment of `scripts/release.ts`, `README.md`'s release sentence, and `packages/format/README.md` "Publishing" (which says the script waits for both versions).

Releasing stays a person's step; this makes the handoff one command.

### F3. One approval command for a drafted search card (this repo)

Evidence: in one session a delegate's new card needed a person's approval; `decorate --approve` refused under the agent (by design), and the handoff was two commands (`--approve`, then `--restamp`, because approval doesn't refresh the digest). Agent-written drafts carry an all-zeros placeholder digest, so every agent draft needs both commands. In an earlier session the user asked whether the stamping step was needed at all.

Decision: the person-only approval stays (the card's text is public model copy). `--approve` also sets the card's digest to the current entry's `searchSourceDigest`, since the person approving reads the card against the entry as it stands. When the old digest was neither the placeholder nor the current digest (a model draft whose entry changed after drafting), it prints one line saying the entry changed since the draft and approval stamps the card against the current entry. The success message says "Approved and restamped". `--restamp` is unchanged for reviewed cards.

Test: the tagged test "a person with terminal stdin can approve without drafting [4.5b#11]" keeps its intent (phase 4.5b's criterion 11 requires only that approval sets `reviewedAt`); its incidental digest-unchanged expectation becomes a positive assertion that the digest equals `searchSourceDigest` of the current entry. A new test: approving a model draft whose entry changed prints the note, and `validate` no longer reports the card stale. This RFC, approved by the maintainer, is the record of that change under `.claude/rules/cli/testing.md`.

Docs: `.claude/skills/stack-authoring/search-card.md` (the pending action becomes one command), `stack-authoring/SKILL.md` (the "card approval and restamp" and "Approve and restamp the card" lines), `fragment-authoring/SKILL.md` (its "card approval and restamp" line), `.claude/agents/stack-creator.md` (pending actions), `CONTRIBUTING.md` ("approve and restamp it"), and `packages/cli/docs/maintaining.md` (the paragraph that presents `--restamp` as the only digest refresh). The two skill-table rows that say "don't run `--approve`" stay.

### F4. Write down the seed's no-network rule (stacks-api)

Evidence: in one session, moving a stub npm client into the API's seed scripts passed a devil's-advocate review and a code review, then failed the full gate on the tagged test `tests/seed-entry-acceptance.test.ts` (4.2g#10). Nothing but the test states the rule.

Change: a paragraph in `scripts/seed/README.md` stating the rule as the test checks it: every `.js`/`.ts` file under `scripts/seed/` (recursively) must not contain the words `fetch` or `HttpClient` anywhere, comments and type imports included, nor an `http(s)://` URL whose host isn't `127.0.0.1`, `localhost` or `[::1]`. Seed-only code that needs an HTTP client type lives in `apps/api/src/platform/`, as `maintenanceWithVersions` does.

### F5. Delegates run the newest listed sol model (this repo)

Evidence: two delegates started on `gpt-6-sol`, the pinned default, while `gpt-6.1-sol` was available; the user stopped them. The pin has since been bumped, but any pin goes stale, and the memory telling Claude to check reaches Claude only. The model is also pinned in the review command each contract template tells the delegate to run.

Change, in `scripts/delegate.sh`: when `DELEGATE_MODEL` is unset, read `${CODEX_HOME:-$HOME/.codex}/models_cache.json` with `jq` (which the script already requires) and take the newest model whose `visibility` is `"list"` and whose `slug` matches `^gpt-[0-9]+(\.[0-9]+)*-sol$` exactly, versions compared numerically; fall back to the pinned default when the file is missing, unreadable or has no match. Export `DELEGATE_MODEL` as the chosen model before running Codex, so the delegate's own commands see it. The contract templates' review commands (`.claude/skills/delegate/contract.md`, `contract-tests.md`) use `-m "$DELEGATE_MODEL"`. The script comment says a failed run's digest names the model and `DELEGATE_MODEL` overrides the choice. The delegate skill's description and `/execute:codex` say the default follows Codex's model list.

Tests in `tests/scripts/delegate.test.ts`: a cache listing a newer listed sol model is chosen; a hidden newer sol model, a `-sol-mini` variant and non-sol slugs are ignored; a malformed or absent cache falls back to the pin; `DELEGATE_MODEL` wins over the cache; the fake codex sees `DELEGATE_MODEL` set to the chosen model. Existing tests point `CODEX_HOME` at an empty directory so they keep the pin.

The memory `delegate-latest-model` is updated to say the script does this.

### F6. Work on stacks-api from a session rooted there (this repo)

Evidence: the API work in one session ran from a session rooted in this repo, so stacks-api's own hooks (lint on write, format on stop, its command and secret guards) never ran, and its rules loaded only because the agent read them.

Change: a bullet in this repo's `CLAUDE.md` "Claude Code" section (it is about Claude Code session roots, hooks and `rules/`): work in the `stacks-api` repository belongs in a session started in that repository, so its hooks and rules apply; from here, suggest the user start one there. The line names no filesystem path.

## Dropped

The post-mortem's CPU-budget finding: `packages/cli/e2e/budget.test.ts` already takes the lowest of three runs, so the failures near its budget point at the cost growing with the registry rather than at load noise. Recalibrating the per-file cost needs measurements on the slowest gate host and is left out of this RFC.

## Work order

This repo, in a worktree off `main` (the main checkout holds unrelated uncommitted plan edits): F1 and F6 (one docs commit), F5, F2, F3. stacks-api: F1 and F4 are two documentation paragraphs with no code, so they are made from this session on a branch there, with that repo's lint run by hand; F6's rule applies to code work. Scoped tests per change, lint and typecheck; then the full gate once per repository with code changes (this one), a `ce:code-reviewer` pass, fixes, and a local merge to each `main`. Nothing is pushed.

## Review revisions

A devil's-advocate pass checked the draft against both repositories. From it: the CPU-budget change was dropped (the test already takes the minimum of three runs); F5 now exports `DELEGATE_MODEL` and templates the contracts' review commands on it, filters on `visibility == "list"` and an anchored slug, uses `jq` rather than `node`, and tests hidden and variant slugs; F2 chooses its package list from the flag, skips tag and marketplace work, tests with `formatPublished: false` against the command log, and lists three more docs; F3 prints a note when approval stamps a draft whose entry moved, asserts the new digest positively, and corrects its docs list; F4 states the rule exactly as the test checks it; F6 moved to `CLAUDE.md` and names no path; the work order states why the two stacks-api documentation paragraphs are made from this session.
