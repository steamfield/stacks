---
description: Execute a design or task as the orchestrator, delegating the coding to Codex (gpt-6-sol, high effort, fast mode)
argument-hint: <design file or task description>
---

# Execute a design with Codex

Load `ce:executing-plans`, then the `delegate` skill, then `ce:architecting-systems` (rules/architecture.md asks for it before executing a design across several units). $ARGUMENTS is the design or task description, as a file path or inline text; call it the design below. Execute it as `ce:executing-plans` describes, with these changes: you are the orchestrator and never the implementer, its sub-agents are Codex delegates run through `scripts/delegate.sh` (model, effort and service tier default to `gpt-6-sol`, `high` and `priority`, Codex's fast mode), and where it differs from this repo, the repo wins. The design's sections and its acceptance tests are the units to group.

Pick a short slug for the work, `<name>` below, for the integration branch and worktree.

## Before any code

Read the design and the shared contracts it touches (the `packages/format/src/index.ts` exports and `packages/cli/src/errors.ts`). Check the design's claims against the code; ask about real ambiguity before starting. Track each unit as a task.

Stay in the main checkout for the whole run and work on every worktree by absolute path. Don't use `EnterWorktree`: a session isolated in one worktree may not be able to run git in the others, and committing and merging units needs exactly that. Create the integration worktree the same way as the units':

```bash
git worktree add .claude/worktrees/<name> -b feat/<name> main
(cd .claude/worktrees/<name> && bun install --frozen-lockfile)
```

A change to `.codex/hooks.json` or a hook it runs reaches delegates only from `main` (AGENTS.md "Delegates"): land harness changes a run depends on before dispatching the delegates that need them.

## Units and contracts

Split the design into units per `ce:executing-plans` (one subsystem each, 3-4 tasks at most). For a design with listed acceptance tests, rules/cli/testing.md "Process and gate" applies: the first unit is a test-author delegate that writes the design's acceptance tests and realistic edge cases as failing tests, from `.claude/skills/delegate/contract-tests.md`. Review its tests, commit them on its branch, and branch the implementer's worktree from that branch (`git worktree add .claude/worktrees/i-<unit> -b delegate/i-<unit> delegate/t-<unit>`), so the implementer starts with the tests and the integration branch never holds red tests that would fail every other unit's gate. The implementer's branch, tests included, merges as one. Every implementer contract lists those test files under "Locked", so Codex makes them pass without touching their assertions, and its reviewer's findings about them come back as notes rather than edits. A test-author hand-off that lists design claims the code contradicts is yours to settle before the implementer starts: correct the design and the test, or the implementer inherits the conflict.

Each unit gets its own worktree, branched from the integration branch as it stands when the unit starts. Name the start point; without it the branch comes from whatever is checked out where you run the command:

```bash
git worktree add .claude/worktrees/<unit> -b delegate/<unit> feat/<name>
(cd .claude/worktrees/<unit> && bun install --frozen-lockfile)
```

Fill a contract from `.claude/skills/delegate/contract.md` in the scratchpad. Every contract:

- carries the part of the design the unit implements (quoted, or the design file's path and its sections), and the directory or package in scope; Codex chooses internal structure;
- names the repo rules that apply (rules/cli/*.md, rules/typescript.md, rules/architecture.md, `.claude/skills/effect/SKILL.md`), since Codex reads only AGENTS.md on its own;
- keeps the template's "Skills to apply" (Codex finds `ce:writing-tests` and `ce:architecting-systems` in the plugin cache itself), "Review before hand-off" with `feat/<name>` as the base branch and the contract's own path filled in, and "Hand-off", unchanged.

Codex finishes a unit only after it has run one `code-reviewer` pass (`.claude/agents/code-reviewer.md`) on its own diff, in a fresh Codex process, and resolved every finding. You don't dispatch a reviewer for delegated work; that pass is the one rules/agent-ops.md allows.

Run independent units as at most five delegates at once, each `scripts/delegate.sh <contract> --write --worktree <path>` with `run_in_background: true`. A unit that depends on another starts from a worktree branched after the first one is integrated.

## When a delegate hands back

1. Read its hand-off report (`last-message.md` in the run's log directory; the digest prints the path) first and let it direct your attention. If it has no review section, or a finding is left unresolved without a good reason, send it back with a follow-up contract before reading further.
2. Read the diff and new files, spending your attention on the "look closer at" items, the decisions it made and the review findings it disputed. Check those against the code; don't re-derive what the report and the review already establish.
3. Refactor pass, per the `delegate` skill: bring the code to this repo's standard with Edit, keep the diff surgical, and run the gate in the worktree (`rr check` in a clone opted in to rr, else `bun run check`; AGENTS.md "Test runs"). "The gate" below means the same.
4. Commit on the unit's branch. Merging comes next.

A problem bigger than a refactor goes back to the same Codex session: write a short follow-up contract (what's wrong, where, what done looks like) and run `scripts/delegate.sh <follow-up.md> --write --worktree <path> --resume <session>`, with the session id from the first run's digest. The resumed session keeps everything Codex read and decided, so the follow-up doesn't restate the original contract. Use a fresh session only when the first one went the wrong way; then write a narrower contract rather than rewriting the code yourself.

## When a run fails

The digest's `result:` line says how: `timed out`, `codex exited N`, `turn failed`, or no `turn.completed` event. Partial work stays in the worktree. Before deciding anything, read `stderr.txt` and `events.jsonl` in the run's log directory, the last message if there is one, and `git -C <worktree> status`.

- Timed out: the script has already resumed the session once, read-only, for a hand-off, and the `result:` line says `(hand-off written)` or `(no hand-off)`. Read the hand-off and the worktree. On track: resume with "continue where you stopped; finish the hand-off", raising `DELEGATE_TIMEOUT_SECS` if the unit is just big. Not converging: split it.
- Crashed or errored before real work: fix the cause (a missing install, a bad contract path) and rerun fresh.
- Stuck on the same failure twice: stop and ask, as `ce:executing-plans` says.

## Merging units

Merge one unit at a time into the integration branch, and run the gate there after each merge, so a break points at the unit that caused it:

```bash
git -C .claude/worktrees/<name> merge --no-ff delegate/<unit>
```

Resolve merge conflicts yourself; you have both sides' hand-off reports, and Codex has neither. A unit whose branch has fallen behind gets `git -C <unit worktree> rebase feat/<name>` and a gate run before merging. Clean up each unit as soon as it's merged (next section), so worktrees don't pile up across a long run. When units land straight on `main` instead (the user's call), each merge is that unit's finish.

## Cleanup

Cleanup is yours; Codex never removes anything. Keep a list of every worktree and branch this run creates, and remove only those: other sessions keep worktrees under the same `.claude/worktrees/`.

```bash
# a merged unit, right after its merge
git worktree remove .claude/worktrees/<unit>
git merge-base --is-ancestor delegate/<unit> feat/<name> && git branch -D delegate/<unit>
```

The ancestor check stands in for `git branch -d`, which compares against the main checkout's `main` and would refuse a branch merged only into `feat/<name>`.

A unit you abandon (wrong approach, superseded, split) gets `git worktree remove --force` and `git branch -D`, but only after you've checked its diff for anything worth keeping. If removal fails because the directory is gone, `git worktree prune` clears the stale entry.

At the end, after main is pushed, remove the integration worktree and `feat/<name>` the same way. Then run `git worktree list` and `git branch --list 'delegate/*' 'feat/<name>'`: nothing this run created should remain. The run logs under `$TMPDIR/stacks-delegate/` and the scratchpad contracts can stay.

## Finishing

On the integration branch, run the gate and read its counts as rules/cli/verification.md asks, revert-verify each new regression test, and run the changed commands in all three audiences as rules/cli/cli.md "Verifying UX" describes, judging the output as the agent that will use it. Update AGENTS.md where the work changed what it describes (the architecture map, the command table), and commit. Then merge `feat/<name>` into main from the main checkout, push, and finish the cleanup above.

Report to the user: what landed, per unit what Codex did, what its review found and how it resolved it, what you changed in refactor, what the design got wrong, and anything left open.
