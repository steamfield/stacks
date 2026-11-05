# Feature

Build the feature described in $ARGUMENTS.

1. Read AGENTS.md and the rules covering the files you will change. Clarify the feature with the user.
2. Write a focused design (behavior, boundaries, failure modes and acceptance tests) in a file under your scratchpad, and give the user its path.
3. Get one adversarial design review from the `architect` agent, then one from `ce:devils-advocate`, passing each the design. Apply their findings without sending the design back for a second pass.
4. Implement in an isolated worktree. Delegate coding units as `.claude/rules/agent-ops.md` directs; each delegated brief carries the constraints in that file and asks for its deliverable in a file.
5. Run the gate (`rr check` in a clone opted in to rr, `bun run check` otherwise; AGENTS.md "Test runs") and exercise the feature through the actual interface. Use the project's documented development servers and test harnesses, and stop only processes you started.
6. Run the `code-reviewer` agent once on code you wrote (delegated Codex work already had its one review, per `.claude/rules/agent-ops.md`) and address its findings.
7. Create a PR using the repository template (`.github/pull_request_template.md`). Merge only when the user authorizes it and checks pass.
8. Preserve deliverables, and clean up the task worktree after handoff.
