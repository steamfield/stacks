---
description: Take a feature from idea to PR - RFC, adversarial review, worktree execution with subagents, two code reviews, PR
argument-hint: <what to build>
---

Build this feature the way this repo builds features: $ARGUMENTS

The `ce:` skills and agents below come from the claude-essentials plugin. Without it, use the in-repo equivalents: the `architect` agent in place of `ce:devils-advocate`, the `reviewer` agent in place of `ce:code-reviewer`, and your own judgment in place of the skills.

Working in the worktree:
- Run the project's install command there first; a worktree has no installed dependencies.
- It has no `.env`, so no secrets, which is how to check the not-configured paths. For a script that needs a secret, pass the main checkout's env file to the runtime without reading it yourself.
- Pid files and `logs/` are per checkout, and the user's dev server may already hold the default port. Start any dev server in the worktree on another port, through the environment variable the project reads ports from (AGENTS.md lists them).
- Commands that bind fixed ports, start their own servers, or write shared build output (browser or binary end-to-end tests, release builds) run only in the orchestrator. Subagents run scoped tests, lint, and typecheck, and don't commit.

1. **Plan.** Read what the feature touches, then write `docs/rfcs/NNNN-<slug>.md` (next free number) with these sections: Why, Scope (in and out), Design (per item: the change, the files, the tests; for an interface change, its inputs, outputs, and error cases), Work breakdown (groups of related work with the files each owns, and which groups depend on which), Verification (the gate plus what to try by hand), Review notes. Ask the user only about decisions that are theirs to make.

2. **Challenge the plan.** Dispatch `ce:devils-advocate` on the RFC. Tell it which claims about the code to verify and which designs you're least sure of. Fold every real finding into the RFC and summarize them under Review notes.

3. **Execute.** Create a worktree on `feat/<slug>` from `main` and commit the RFC there first. Follow the `ce:executing-plans` skill with one change: the output is a PR, not a merge to `main`. Dispatch one subagent per group from the Work breakdown, in parallel where groups don't depend on each other, and give each one the RFC section it owns and the files it may touch. Commit each group separately with a Conventional Commit message once you've read its diff.

4. **Verify.** Run the project's `check` command and read the counts from every test runner it calls. Then try the change by hand the way the RFC's Verification section says, through the real interface (the running app, or the CLI from source).

5. **Review.** Dispatch two `ce:code-reviewer` agents in parallel on `git diff main...HEAD`:
   - Product and design: what a user sees and does, copy and messages, every state (empty, loading, error, not configured), accessibility, machine-readable output, and whether it follows `DESIGN.md` when the project has one.
   - Technical architecture: boundaries, error handling, tests, and the checklist in `.claude/agents/reviewer.md`.

   Fix every finding or write down why it doesn't apply, then run the `check` command again.

6. **Open the PR.** Load the `ce:writer` skill (Contributor persona) and write the description from `.github/pull_request_template.md`. Write it for a reviewer who has never seen this repo: explain in plain words what the feature is and why it exists before any technical detail, then what landed, where to look closely, and how to test it by hand. Be complete, and cut anything a reviewer wouldn't miss. Push the branch and run `gh pr create --body-file <file>`. If the repo has no remote, stop there and give the user the branch name and the description file.

Report the PR link (or the branch and description file), the commits, and any finding you chose not to fix. Remove the worktree once its branch is pushed, after checking nothing in it is uncommitted.
