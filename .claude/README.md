# Claude adapter

`CLAUDE.md` imports `AGENTS.md`, the project instructions every coding agent reads. `docs/harness.md` says who owns which part of the harness. `settings.json` wires each hook below once, allows the project's checks and source-development commands, and denies the worst destructive commands outright. Nothing here needs a marketplace plugin to work; the `ce` skills the rules and agents load make them better, but each rule stands on its own.

## Hooks

| Hook | Event | What it does |
| --- | --- | --- |
| `session-start.sh` | SessionStart | Reports the branch, dirty files, `.env`, installed dependencies and whether jq is present; in a clone opted in to rr, exports macOS's ssh-agent socket |
| `project-status.ts` | SessionStart | Reports a Bun version mismatch and the warn/error lines each package's `logs/*.jsonl` gained since the last session |
| `block-destructive.sh` | PreToolUse Bash | Denies commands that destroy work without a way back, and asks before a publish |
| `guard-commands.ts` | PreToolUse Bash | Denies shell in-place edits, hand-written lockfile changes, local whole-suite runs in an rr clone, and any gate or whole suite from a Codex delegate |
| `guard-cli-commands.ts` | PreToolUse Bash | Keeps Vitest on Node, scopes Bun's runner to its declared binary and native tests, and refuses competing schema or legacy platform packages |
| `detect-secrets.sh` | PreToolUse Edit/Write | Denies writes containing a credential-shaped value |
| `guard-generated.ts` | PreToolUse Edit/Write | Denies hand edits to `dist/`, `coverage/` and `bun.lock` |
| `guard-repo-content.ts` | PreToolUse Edit/Write | Denies home paths and the patterns in the gitignored `hooks/private-patterns.local` in tracked files |
| `guard-boundaries.ts` | PreToolUse Edit/Write | Enforces the platform, Schema, env and output boundaries under `packages/cli/src/` |
| `lint-on-write.sh` | PostToolUse Edit/Write | Returns Biome diagnostics for the written file and records it for formatting |
| `typecheck-on-write.ts` | PostToolUse Edit/Write | Returns tsc errors for the nearest `tsconfig.json`, within 40 s |
| `format-changed.sh` | Stop | Formats only the files this session recorded |

`_lib.ts` and `_shell.ts` hold the TypeScript hooks' payload, process and shell-parsing helpers; `_lib.sh` and `_destructive-patterns.sh` hold the Bash 3.2 helpers and the deny patterns.

The Bash hooks parse their payload with jq. Without it they exit quietly, `session-start.sh` says so once, and the `permissions.deny` list in `settings.json` still blocks the worst commands. Hooks never download tools, and a missing optional tool makes a hook skip rather than fail. Every deny explains itself so the agent can ask the user instead. `.env` is optional in this repo even when `session-start.sh` mentions it.

Codex runs only the command guards: `.codex/hooks.json` runs `guard-commands.ts` and `block-destructive.sh` from the checkout's own git root and refuses the command if either is missing. The hook tests in `tests/hooks/` execute the real helpers and probe each guard with a deny and a near miss.

## Rules

`rules/architecture.md` and `rules/agent-ops.md` have no `paths:` and load in every session. The first holds the product, package and shared-contract constraints for any design; the second covers how agents work here: what tracked files may reference, Edit and Write over shell edits, subagent briefs, Codex delegation as the default for coding, and one review pass per deliverable.

The rest are path-scoped:

| Rule | Loads for | Covers |
| --- | --- | --- |
| `typescript.md` | TypeScript in `packages/cli` and `packages/mcp` sources, tests and scripts, root `tests/` and `scripts/`, and the hooks | Strict TypeScript conventions |
| `cli/cli.md` | `packages/cli/src/` | The CLI UX contract |
| `cli/effect.md` | `packages/cli/src/` and `tests/` | The CLI's Effect policy: services, runtime, errors, parsed input, config and logging |
| `cli/testing.md`, `cli/verification.md` | `packages/cli/src/` and `tests/` | Tests and done-checks |
| `format/format.md` | `packages/format/` | Keeps its runtime source portable |
| `mcp/effect.md` | `packages/mcp/src/`, `tests/` and `e2e/` | The MCP server's Effect notes on top of `cli/effect.md` |

The rules and agents load these skills from the `claude-essentials` marketplace's `ce` plugin: `ce:architecting-systems`, `ce:handling-errors`, `ce:writing-tests`, `ce:effect` and `ce:writer`. Codex installs the same plugin:

```bash
codex plugin marketplace add rileyhilliard/claude-essentials
```

```bash
codex plugin add ce@claude-essentials
```

## Delegation

Codex delegation uses the personal `codex-delegate` skill, whose runner starts Codex in its own worktree. `delegate.md` is this repo's overlay on it (setup, the runner command, what to keep in-house), and `delegate/` holds the filled-in contract templates: `contract.md` for a task and `contract-tests.md` for a test author.

## Skills, agents and commands

`skills/stack-authoring/` and `skills/fragment-authoring/` guide naming, descriptions and search cards for registry entries. Both load `ce:writer`, and they share `stack-authoring/search-card.md`. `stack-authoring/references/` holds the checkout checks, the fresh-scaffold proof and the conversion lessons, each linked from its `SKILL.md` at the step that needs it. `.agents/skills` is a tracked symlink to `skills/` so Codex, which looks for repo skills there, reads the same files; edit them here.

`agents/architect.md` is a read-only design review. `agents/code-reviewer.md` is the one code review of a diff; it extends `ce:code-reviewer` with the checks reviews here have missed, and Codex delegates run its body as a prompt. `agents/stack-creator.md` loads both authoring skills to add or revise one registry entry.

The commands `/check`, `/test` and `/feature` orchestrate work, alongside the personal `/execute:codex`, which executes a design or task through Codex delegates with `delegate.md`'s additions.

## Local files

`settings.local.json`, `hooks/private-patterns.local` and `worktrees/` are gitignored. Personal or machine-specific settings go in `settings.local.json`, never in `settings.json`.
