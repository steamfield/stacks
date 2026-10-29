# Claude adapter

CLAUDE.md imports canonical AGENTS.md. docs/harness.md describes ownership. The settings file wires owned hooks once and allows project checks/source development while guarding destructive operations. No optional marketplace plugin is required.

| Hook | Purpose |
| --- | --- |
| session-start.sh | Repository, dependency, jq and environment advisory; exports macOS's ssh-agent socket for rr in an opted-in clone |
| project-status.ts | Bun version mismatch and newly appended warn/error logs |
| block-destructive.sh | Destructive command deny/near-miss checks |
| detect-secrets.sh | Credential-shaped edit guard |
| lint-on-write.sh | Local Biome advisory and session edit tracking |
| format-changed.sh | Format only this session's recorded edits |
| guard-commands.ts | Shared package command rules |
| guard-generated.ts | Build/coverage/lockfile edit guard |
| guard-repo-content.ts | Keeps home paths and local names (gitignored `hooks/private-patterns.local`) out of tracked files |
| guard-cli-commands.ts | Node unit runner and explicitly scoped Bun binary tests |
| guard-boundaries.ts | Platform, Schema, env and output boundary guard |
| typecheck-on-write.ts | Bounded TypeScript advisory |
| _lib.ts, _shell.ts | Protocol/process and shell parsing helpers |
| _lib.sh, _destructive-patterns.sh | Bash 3.2 helpers and deny patterns |

rules/architecture.md and rules/agent-ops.md have no `paths:` and load in every session: the first holds product, package and shared-contract constraints for any design; the second holds how agents operate here (what tracked files may reference, Edit/Write over shell edits, subagent briefs, one review pass). rules/typescript.md applies to the TypeScript in packages/cli, the root tests/ and scripts/, and the hooks. rules/cli/ is scoped to packages/cli: cli.md is the CLI UX contract, effect.md covers config, logging and fibers and links skills/effect/SKILL.md, testing.md and verification.md cover tests and done-checks. rules/format/format.md is scoped to packages/format and keeps its runtime source portable. The rules load these ce plugin skills from the `claude-essentials` marketplace: `ce:architecting-systems`, `ce:handling-errors`, `ce:writing-tests` and `ce:systematic-debugging`; without the plugin, the rules still stand on their own. skills/delegate/ is the Codex delegation workflow (`scripts/delegate.sh` runs Codex in a worktree; `contract.md` is the task template, `contract-tests.md` the test author's) that rules/agent-ops.md makes the default for coding tasks. skills/stack-authoring/ and skills/fragment-authoring/ guide naming, descriptions and search cards for registry entries (they load `ce:writer`; `stack-authoring/search-card.md` is shared), and agents/stack-creator.md loads both to add or revise one entry. Commands /check, /test, /feature and /execute:codex (a design or task executed through Codex delegates) orchestrate work; agents/architect.md is a read-only design review, and agents/code-reviewer.md is the one code review of a diff (it extends `ce:code-reviewer` with the checks reviews here have missed; Codex delegates run its body too). `.agents/skills` is a tracked symlink to `skills/`, so Codex, which discovers repo skills under `.agents/skills`, reads the same files; edit them here.

jq powers Bash payload parsing. Hooks never download tools. Missing optional tools cause quiet/advisory behavior; guards explain denies. Tests execute helpers and exercise actual boundary rules. Personal settings.local.json is ignored. `.env` is optional here even when the generic session-start advisory mentions it.
