# Delegating to Codex in this repo

The `codex-delegate` skill (a personal skill under `~/.claude/skills/codex-delegate/`, with the runner at `scripts/delegate.sh` there) holds the workflow; this file is what this repo adds to it and wins where they differ. `rules/agent-ops.md` makes delegation the default for contract-shaped coding here, which is stricter than the skill's own guidance.

Setup and run:

- Worktrees go under the main checkout's `.claude/worktrees/` (already gitignored). Install with `bun install --frozen-lockfile` in each.
- Run the runner with the repo's hooks trusted, since `.codex/hooks.json` is tracked and reviewed: `env DELEGATE_TRUST_REPO_HOOKS=1 ~/.claude/skills/codex-delegate/scripts/delegate.sh <contract> --write --worktree .claude/worktrees/<name>`, in the background.
- The command guard (`.claude/hooks/guard-commands.ts`, run for Codex by `.codex/hooks.json`) denies a delegate (`CODEX_DELEGATE=1`, set by the runner) every whole-suite run, local or rr. Codex runs the guard from its worktree's branch, so a guard change reaches a delegate only once its branch has it: land harness changes a run depends on before branching the delegates that need them.
- The gate is `rr check` in a clone opted in to rr, else `bun run check` (AGENTS.md "Test runs"), run once in the worktree after the refactor pass.

Contracts: fill `.claude/delegate/contract.md` (and `.claude/delegate/contract-tests.md` for the test author of a feature with listed acceptance tests), not the skill's generic templates. They already carry this repo's rule files, the ce skills, the three-audience QA from `rules/cli/cli.md` "Verifying UX", the known test traps and the review pass with `.claude/agents/code-reviewer.md`.

Keep these yourself rather than delegating: a design, a change to a shared contract in `packages/format/src` or `packages/cli/src/errors.ts`, and any harness change (`.claude/`, `.codex/`, lefthook, CI).

`/execute:codex` here also:

- reads the shared contracts the design touches (`packages/format/src/index.ts` exports and `packages/cli/src/errors.ts`) before splitting it into units;
- starts a design with listed acceptance tests with a test-author unit, per `rules/cli/testing.md` "Process and gate";
- in refactor, applies `ce:effect` and `.claude/rules/cli/effect.md`, makes tests assert behaviour through the real interfaces AGENTS.md "Testing" describes, and checks errors against AGENTS.md "Error handling";
- at the end, reads the gate's counts as `rules/cli/verification.md` asks, runs the changed commands in all three audiences, and updates AGENTS.md where the work changed what it describes (the architecture map, the command table).
