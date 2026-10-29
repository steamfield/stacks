---
name: delegate
description: Hand a coding task to a Codex delegate (gpt-6-sol, high effort, fast mode) in its own worktree, then review its diff, refactor it to this repo's standard, run the gate and commit it yourself. The default for implementation, tests and refactors whose contract you can write down. Not for design or harness changes.
---

# Delegating to Codex

Claude is the orchestrator. Codex writes the first draft of the code in an isolated worktree;
Claude writes the contract, reviews the diff, does a refactor pass, runs the gate and commits.
Codex is trusted like Claude Code: with `--write` it runs unsandboxed, with your environment
and your own Codex config, so it has the network, `bun add` and git, and can run the scoped tests
the contract names, including the process-group tests. It runs no gate: the command guard denies
a delegate every whole-suite run (AGENTS.md "Test runs"). It leaves its changes uncommitted only
because the review and refactor come before the commit. Claude
subagents still go through the Agent tool, never this script.

## When it fits

Delegate coding work you can specify before any code exists: the goal, the interface, the area
of the tree in scope, the acceptance tests and the command that runs them. That covers feature
work against a written design (the design is most of the contract: quote it or give its path,
and add the scope and the checks), test authoring for existing behaviour, and mechanical
refactors. Give a feature the room a design needs: scope a directory or package rather than a
file list, let Codex choose internal structure, and judge the result in review.

Keep it yourself when the task is design (a design document, or a shared contract in
`packages/format/src` or `errors.ts`), when
it changes the harness (`.claude/`, lefthook, CI), when it is a few lines you would finish
faster than you could write the contract, or when you can't yet say what done looks like.

## Workflow

1. Worktree. One per delegate, under the main checkout's `.claude/worktrees/`, with
   dependencies installed (the script refuses a worktree without `node_modules`). Always name
   the branch to start from; without it you get whatever is checked out where you run it:

   ```bash
   git worktree add .claude/worktrees/<name> -b delegate/<name> <base branch>
   (cd .claude/worktrees/<name> && bun install --frozen-lockfile)
   ```

   Run everything from the main checkout, addressing worktrees by path. A session isolated in
   one worktree (`EnterWorktree`) may not be able to run git in another.

2. Contract. Copy `contract.md` beside this file into the scratchpad and fill it in
   (`contract-tests.md` for a test-first feature's test author). Codex
   reads `AGENTS.md` on its own but never sees `.claude/rules/` or this conversation, so the
   contract names the rule and skill files that apply and carries every constraint itself.
   Scope it for what the change touches, not only the file it's about: a unit that adds a
   service dependency gets the layer wiring file and the read-only store methods it needs in
   "May change", or it stops at the boundary and hands back a blocked run.

3. Run it in the background (`run_in_background: true`); you are notified when it exits:

   ```bash
   scripts/delegate.sh <contract.md> --write --worktree .claude/worktrees/<name>
   ```

   Read-only is the default; `--write` lets Codex edit the worktree. Read-only suits review and
   investigation only: Vitest writes `node_modules/.vite-temp`, so no test runs without `--write`. Independent units run as
   at most five delegates at once, one worktree each (more starve the test hosts and this
   machine). The digest (result, commands run, files written,
   last message) is the command's output; full logs stay under `$TMPDIR/stacks-delegate/`.
   Runs use Codex's fast mode (`service_tier="priority"`: about twice the speed, more usage);
   `DELEGATE_SERVICE_TIER=default` turns it off for a run.

4. Review. `success` only means the turn finished. Codex has already run one
   `code-reviewer` pass (`.claude/agents/code-reviewer.md`) on its own diff in a fresh Codex process and resolved the findings
   (the contract's "Review before hand-off"); that is the one review pass in
   `rules/agent-ops.md`, so don't dispatch another. Read the hand-off report
   (`last-message.md` in the run's log directory) first, then the diff and new files, spending
   your attention on its "look closer at" items, its decisions and any finding it disputed.
   Check every changed path is in scope: the digest's "outside the contract's May change"
   list names each dirty path no backticked May change entry covers (a directory entry ends
   in `/`), so a contract that wants that check names its paths in backticks. A report without a review section, or work that
   needs more than a refactor, goes back to the same session: a short follow-up contract run
   with `--resume <session>` (the digest prints the id), which keeps everything Codex already
   read and decided. Start fresh with a narrower contract only when the first run went the
   wrong way.

5. Refactor pass. Bring the code to the standard you would have written it to, with the Edit
   tool so the lint, typecheck and boundary hooks see every change (none of them ran for
   Codex). Match the surrounding code's naming, comment density and idiom; cut abstractions,
   options and defensive branches the task didn't ask for; replace custom code with the
   project's existing helpers and Effect idioms (`.claude/skills/effect/SKILL.md`); make tests
   assert behaviour through the real interfaces `AGENTS.md` "Testing" describes, with no mocks;
   check errors follow `AGENTS.md` "Error handling". Keep the diff surgical: anything Codex
   touched outside the task gets reverted.

6. Gate and commit. Run the gate in the worktree (`rr check`, or `bun run check` in a clone without rr; AGENTS.md "Test runs"), commit there with a Conventional
   Commits message, and land it the way the task calls for.

7. Clean up. Cleanup is yours; Codex never removes anything. Once the work is merged:

   ```bash
   git worktree remove .claude/worktrees/<name>
   git merge-base --is-ancestor delegate/<name> <branch it merged into> && git branch -D delegate/<name>
   ```

   The ancestor check confirms the work landed; `git branch -d` only compares against the
   current HEAD, which from the main checkout is `main`. A unit you abandon gets
   `git worktree remove --force` and `git branch -D` once you've confirmed nothing in it is
   worth keeping. Remove only worktrees you created; other sessions keep theirs under the same
   directory. The run logs under `$TMPDIR/stacks-delegate/` can stay.

`/execute:codex <design>` runs this loop over a whole design.
