# The harness

This repo is built with coding agents, so most of its guardrails are aimed at the mistakes agents make. Each mistake is caught by more than one layer, and the earliest layer is the cheapest: a rule that keeps the agent from writing the bad line beats a hook that denies it, which beats a lint error seconds later, which beats a red CI run.

What's in the tree:

| Piece | What it does | Where |
| --- | --- | --- |
| Hooks | Guards that deny (destructive commands, secrets, generated files, the project's boundary violations, wrong commands); lint and type feedback after each edit; formatting at the end of a turn; repo state at session start | `.claude/hooks/`, wired in `.claude/settings.json`; per-hook detail in [`.claude/README.md`](../.claude/README.md) |
| Path-scoped rules | Guidance that loads only when the agent touches matching files | `.claude/rules/` |
| Slash commands | `/check`, `/test`, `/feature`<!-- stacks:fill Append every other command in .claude/commands/ by name. --> | `.claude/commands/` |
| Agents | `architect` and `reviewer`, both read-only | `.claude/agents/` |
| Skills | <!-- stacks:fill Name each skill in .claude/skills/ and what it covers, or write "None yet." --> | `.claude/skills/` |
| Hook tests | A deny and a near miss for every guard, every advisory hook end to end, and the wiring in `settings.json` | `tests/hooks/` |

<!-- stacks:fill If the project ships lint plugins (Biome GritQL rules for conventions the type checker can't see), add a "Lint plugins" row to the table above naming their directory; otherwise delete this comment. -->

`AGENTS.md` is the agent's map of the code. This page is for a person who wants to know why the harness looks the way it does.

## The shared runtime

The hooks are TypeScript run by Bun, written against `node:` APIs only. `_lib.ts` reads the hook payload, runs child processes with timeouts, resolves project paths, and writes the hook protocol's output (`deny`, additional context). `_shell.ts` parses a shell command into the commands it actually runs, so a quoted example, a heredoc body, or a comment isn't mistaken for execution. Stack and app guards import both; that's why the stack requires this harness.

`typecheck-on-write.ts` runs `tsc` after each `.ts`/`.tsx` write and hands back errors in the edited file and its callers. When the project ships `.claude/hooks/before-typecheck.ts` (for generated types), the hook awaits it first. `guard-generated.ts` denies hand edits to tool-owned output and names the command that regenerates it. `block-destructive.sh` delegates to `guard-commands.ts` when that file and Bun are present; otherwise it keeps its shell pattern guard. The shell entry is the only command guard wired by these fragments. The TypeScript guard denies recursive deletions outside the project (including symlink targets), unresolved deletion targets from shell expansions or xargs (a filename glob inside a subdirectory, such as `rm -rf ./tmp/*`, is checked against that directory), hard resets on dirty or unreadable repositories and hard resets to any commit but `HEAD`'s, history rewrites (a force push with `--force-with-lease` or `--force-if-includes` is allowed), pushes that delete remote branches, forced checkouts, infrastructure teardown, and raw disk writes. Git, release and infrastructure commands count only where they run, so a commit message or PR body that mentions one is allowed. Guard inspection failures deny the call. These are accident guards, not a security boundary against an agent with full permissions.

`guard-commands.ts` also denies commands that would fight the project's tooling (a package manager touching a lockfile another one owns; the owner comes from the lockfile, then `packageManager` in `package.json`, then bun). Missing tools and advisory timeouts stay quiet: an advisory hook never blocks work because something it wanted isn't installed.

## Which layer catches what

Layers are listed earliest first. "Rule" means a path-scoped file in `.claude/rules/` that loads when the agent touches matching files. Add a row when the stack or app ships a guard of its own.

| Mistake | Prevention | Blocked or flagged | Backstop |
| --- | --- | --- | --- |
| Running the wrong test runner or package manager | `AGENTS.md`, the testing rule | `guard-commands.ts` (and the stack's command guard) denies it with the right command | none needed: the command never runs |
| Destroying work (a hard reset, a force push, deleting the filesystem root) | none | `block-destructive.sh` delegates to the lexer guard, or uses its shell patterns; `permissions.deny` repeats the worst shapes in case the hook can't run | `tests/hooks/` |
| Crossing a boundary the stack defines (server-only code imported by the client, platform APIs outside their entry files) | the stack's rules | the stack's guard denies the write; a lint plugin, if the project has one, flags it | the production build or the Node test runner fails, then CI |
| Hand-editing generated files (build output, coverage, lockfiles, recorded fixtures) | `AGENTS.md` conventions | `guard-generated.ts` denies it and names the command that regenerates the file | regenerating overwrites a hand edit anyway |
| Writing a secret into a file | `.env` is gitignored, and `Read(./.env)` is denied | `detect-secrets.sh` denies credential-shaped writes | none: the pre-commit hook runs only the formatter and linter |
| Breaking a convention a lint rule or plugin encodes | the matching rule | `lint-on-write.sh` hands the diagnostic back seconds after the edit | the project's lint command, pre-commit, CI |
| A type error, including one in a caller of the edited file | none | `typecheck-on-write.ts` hands back `tsc` errors after each `.ts`/`.tsx` write | pre-push typecheck, CI |
| A guard change that turns a hook into a no-op | `.claude/README.md` | `tests/hooks/`: a deny and a near miss for every guard | pre-push tests, CI |
| A convention no tool checks (thin entry points, error mapping, log once, decode at the boundary) | rules, `AGENTS.md` | the `reviewer` agent before a commit | `/feature` runs two code reviews before the PR |

To disable a hook, remove its entry from `.claude/settings.json`. Removing `guard-commands.ts` restores the shell destructive guard and disables the package-manager guard. Run `node node_modules/vitest/vitest.mjs run tests/hooks` to check the shipped harness, also run by the `harness-hooks` verify step.

Guards deny; everything else advises. Lint and type errors arrive as context and never block a write, so the agent keeps moving and fixes them on its next edit.

## A five-minute demo

Run these from the repo root in your own terminal. To see the same guards from inside Claude Code, ask the agent to run `npm install` (denied, with the right command).

**1. A hook denies a command** (30 seconds). Pipe a payload into a guard the way Claude Code does:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"npm install"}}' | bun .claude/hooks/guard-commands.ts
```

It prints a `permissionDecision: "deny"` with the reason and the right command. The hook tests in `tests/hooks/` run every guard the same way.

**2. A quoted command is not a command** (30 seconds):

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo \"npm install\""}}' | bun .claude/hooks/guard-commands.ts
```

It prints nothing: `_shell.ts` sees `echo` with a string argument, which is the near miss every guard test pairs with its deny.

**3. Type feedback after a write** (1 minute). Ask the agent to add a function with a type error to any source file. The error comes back as context right after the write, before the agent moves on, with the callers it broke.

**4. The `/feature` workflow** (1 minute to explain). In Claude Code, `/feature <what to build>` writes an RFC in `docs/rfcs/`, has it challenged, executes it in a worktree with one subagent per work group, runs the gate, runs two code reviews, and opens a PR from `.github/pull_request_template.md`. The RFC's Review notes record the challenge's findings, and `git log main..HEAD` on its branch shows one commit per work group.

## Working in a worktree

`/feature` executes in a git worktree under `.claude/worktrees/` (gitignored), so your checkout and dev server stay untouched while agents work. A worktree has no installed dependencies, no `.env`, and its own `logs/`, so install first, expect the not-configured paths, and give any dev server it starts a different port through the variable the project reads ports from. The practical details (install, ports, secrets, who commits) are in the command itself, [`.claude/commands/feature.md`](../.claude/commands/feature.md). Remove a finished worktree once its branch is pushed or merged.

## Related

- [`.claude/README.md`](../.claude/README.md): every hook, rule, and setting in detail.
- [`AGENTS.md`](../AGENTS.md): the agent's map of the code, commands, and conventions.
- [`.claude/commands/feature.md`](../.claude/commands/feature.md): the `/feature` workflow.
