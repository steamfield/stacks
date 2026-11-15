# The harness

This project uses guidance, lint, type checking and review to catch coding mistakes. Hooks block destructive work and session hangs, report diagnostics after edits, format on Stop and report repository state at SessionStart.

What's in the tree:

| Piece | What it does | Where |
| --- | --- | --- |
| Hooks | Destructive and secret guards; stack-specific anti-hang guards; lint and type feedback after edits; formatting on Stop; repo state at SessionStart | `.claude/hooks/`, wired in `.claude/settings.json`; per-hook detail in [`.claude/README.md`](../.claude/README.md) |
| Path-scoped rules | Guidance that loads only when the agent touches matching files | `.claude/rules/` |
| Slash commands | `/check`, `/test`, `/feature`<!-- stacks:fill Append every other command in .claude/commands/ by name. --> | `.claude/commands/` |
| Agents | `architect` and `reviewer`, both read-only | `.claude/agents/` |
| Skills | <!-- stacks:fill Name each skill in .claude/skills/ and what it covers, or write "None yet." --> | `.claude/skills/` |
| Smoke check | A deny and a near miss per guard, plus config parsing and wiring | `.claude/hooks/smoke.sh` |

<!-- stacks:fill If the project ships lint plugins (Biome GritQL rules for conventions the type checker can't see), add a "Lint plugins" row to the table above naming their directory; otherwise delete this comment. -->

`AGENTS.md` is the agent's map of the code. This page is for a person who wants to know why the harness looks the way it does.

## The hooks

`agent-ops` supplies shell hooks. `block-destructive.sh` uses `_destructive-patterns.sh` to catch destructive or irreversible commands, and `detect-secrets.sh` checks writes for credentials and protected env files. These guards fail open when inspection is unavailable. The command guard reports this with a note; the secret guard can skip inspection silently. They prevent accidents; they are not a security boundary against an agent with full permissions.

`lint-on-write.sh` returns diagnostics after an edit. The TypeScript harness adds `typecheck-on-write.ts`, which runs `tsc` after each `.ts`/`.tsx` write and reports errors in the edited file and its callers. If the project supplies `before-typecheck.ts` for generated types, it runs first. Stack-specific advisory hooks may add framework checks.

`format-changed.sh` formats this session's edited files on Stop. `session-start.sh` reports repository state, missing dependencies and local services at SessionStart. Per-hook details and settings live in [`.claude/README.md`](../.claude/README.md).

The TypeScript helpers use Node APIs even though Bun executes them. `_lib.ts` handles payloads, bounded child processes and hook responses; keep it in TypeScript checking. Shell guards, including stack anti-hang guards, split commands with `_lib.sh`.

Hooks deny destructive or irreversible work and foreground commands that would hang the session. Keep runner choices, package choices, generated-file ownership and import boundaries in guidance and lint. Lint and type feedback advises after a write; missing tools never turn those checks into denials.

## Which layer catches what

"Rule" means a path-scoped file in `.claude/rules/`. Add rows for checks the project actually ships.

| Mistake | Guidance | Check | Backstop |
| --- | --- | --- | --- |
| Wrong test runner or package manager | `AGENTS.md`, testing rules | Follow the declared commands and lockfile owner | Review command output and test counts |
| Destroying work or data | Ask the user before destructive work | `block-destructive.sh`; `permissions.deny` repeats selected shapes | `.claude/hooks/smoke.sh` exercises the guards |
| Server code reaching the browser, or platform APIs outside adapters | The stack's boundary rules | Keep the shipped lint plugins enabled | The production build or runtime tests, where applicable |
| Hand-editing generated output or fixtures | Regenerate with the declared command | Read the generated diff | Regeneration replaces hand edits |
| Writing a secret | Use env examples and local configuration | `detect-secrets.sh` denies credential-shaped writes and protected env files | Keep real credentials out of tracked files |
| Breaking a lint rule | Matching guidance | `lint-on-write.sh` returns diagnostics | The project's lint command and CI |
| A type error | Preserve strict compiler settings | `typecheck-on-write.ts` returns diagnostics | The project's typecheck and CI |
| Broken guard wiring | List actual hooks in `.claude/README.md` | `.claude/hooks/smoke.sh`, the only shipped hook test | `hooks-smoke` runs it during verify |
| A convention no tool checks | Rules and `AGENTS.md` | The `reviewer` agent | `/feature` runs two reviews before the PR |

Run `bash .claude/hooks/smoke.sh` after a hook change. Add each new guard's deny and near miss there. To disable a hook, remove its entry from `.claude/settings.json`; static permission denials still apply.

## Trying the hooks

Run these from the repo root in your own terminal. Both calls inspect a command payload; neither executes the command in it.

1. Send a destructive command to the guard:

   ```bash
   echo '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | bash .claude/hooks/block-destructive.sh
   ```

   It returns `permissionDecision: "deny"` and asks the agent to consult the user. A block means ask the user; never rephrase or split the command to work around it.

2. Send a safe command:

   ```bash
   echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | bash .claude/hooks/block-destructive.sh
   ```

   It prints nothing. Normal permission handling still applies.

3. Run `bash .claude/hooks/smoke.sh` to exercise a deny and a near miss per guard and check the hook wiring.

4. Ask the agent to add a type error to a source file, observe the diagnostic after the write, then revert the edit. This confirms the installed type checker runs; it does not replace the project's full typecheck.

## Working in a worktree

`/feature` executes in a git worktree under `.claude/worktrees/` (gitignored), so your checkout and dev server stay untouched while agents work. A worktree has no installed dependencies, no `.env`, and its own `logs/`, so install first, expect the not-configured paths, and give any dev server it starts a different port through the variable the project reads ports from. The practical details (install, ports, secrets, who commits) are in the command itself, [`.claude/commands/feature.md`](../.claude/commands/feature.md). Remove a finished worktree once its branch is pushed or merged.

## Related

- [`.claude/README.md`](../.claude/README.md): every hook, rule, and setting in detail.
- [`AGENTS.md`](../AGENTS.md): the agent's map of the code, commands, and conventions.
- [`.claude/commands/feature.md`](../.claude/commands/feature.md): the `/feature` workflow.
