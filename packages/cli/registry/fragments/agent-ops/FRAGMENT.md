---
schema_version: 1
id: agent-ops
kind: fragment
category: agent-ops
name: AGENTS.md and agent guardrails
description: AGENTS.md as the one project guide for every coding agent, with hooks for Claude Code, Codex, Cursor and OpenCode that block destructive commands and secret writes. Claude Code and OpenCode also lint on write and format the agent's edits; Claude Code gets CLAUDE.md and Cursor a rule pointing at AGENTS.md.
tags: [agents, claude, codex, cursor, opencode]
applies_to: []
tools: [git]
merge: [.claude/settings.json, .codex/hooks.json]
verify:
  - name: agents-md-filled
    layer: check
    run: "test -s AGENTS.md && grep -q '^## Commands' AGENTS.md && ! grep -n 'stacks:fill' AGENTS.md"
  - name: claude-md-imports-agents
    layer: check
    run: "test ! -f CLAUDE.md || grep -qx '@AGENTS.md' CLAUDE.md"
  - name: claude-readme-filled
    layer: check
    run: "test ! -f .claude/README.md || ! grep -n 'stacks:fill' .claude/README.md"
  - name: hooks-smoke
    layer: check
    run: bash .claude/hooks/smoke.sh
---

# Agent operations

One canonical instruction file for every coding agent, `AGENTS.md`, plus a Claude Code adapter.

## What to add

**`AGENTS.md`** is a skeleton. Fill it last, once verify is nearly green, from the project as built:

- Replace each `stacks:fill` comment with real content; empty sections get "None yet."
- Commands match the real Makefile or scripts, each run once, including a single-test-file command. The architecture map lists only directories that exist.
- **Build workarounds** lists every pin, patch, disabled rule, or hack you added to get green, with when to remove it. **Deferred** and **Pending user actions** record what you left out and what only the user can do.
- Under about 200 lines. Other fragments' sections go under their own `##` near related ones (database after Architecture map, CI and deploy before Deferred).

<!-- stacks:when mode=add -->
When the repo already has an `AGENTS.md`, the skeleton isn't copied (it's listed as "merge needed"). Keep the existing file and add the skeleton's missing sections (Commands, Build workarounds, Deferred, Pending user actions). An existing `CLAUDE.md` must import `AGENTS.md` (`@AGENTS.md` on its own line, which verify checks) instead of duplicating it; move shared content into `AGENTS.md`.
<!-- stacks:end -->

**Claude Code adapter** (when Claude is a target): `CLAUDE.md` imports `AGENTS.md` via `@AGENTS.md` (Claude Code ignores `AGENTS.md` otherwise; never remove the line). `.claude/settings.json` wires the hooks; other fragments deep-merge into it. The hooks stop destructive commands, secret-shaped writes and `.env` writes before they happen: a block means ask the user, never work around it. `.claude/README.md` documents the hooks; replace its `stacks:fill` row with one row per hook other entries ship (`claude-readme-filled` checks).

`.claude/settings.json` pre-approves read-only git. Once `AGENTS.md`'s Commands are settled, allow the project's other non-destructive commands (lint, format, typecheck, test, the single-test-file command) in the same `Bash(<cmd>)` / `Bash(<cmd> *)` shape. Never allow deploy, publish, release, migrate, or anything that deletes data. Allow rules the stack or its fragments already merged into `.claude/settings.json` are approved; add rules only for commands you create beyond those.

**Other agents** run the shell guards from `.claude/hooks/`, so keep it whatever the targets. Codex runs project hooks only after the user trusts the project and approves each hook in `/hooks`: list that under Pending user actions. Cursor's guards fail closed, so without `bash` every Shell, Write and Delete call is refused.

`hooks-smoke` runs `.claude/hooks/smoke.sh`, which feeds the guards a deny and a near miss each, and checks every hook config still parses and wires them. If it fails, fix the hook or the wiring, never the script or the step.

Claude Code asks the user before any edit under `.claude/` or to `lefthook.yml`; if denied, finish the rest, then ask once for all of them, with exact content.

If the project has a linter (a formatter alone doesn't count), confirm `lint-on-write.sh` reports a deliberate lint error, then revert. If it's silent, check the linter is where the hook looks (`.venv`, `node_modules/.bin`, PATH); `session-start.sh` also flags a `package.json` or `pyproject.toml` whose dependencies aren't installed. On Stop, `format-changed.sh` formats only this session's files. If the project uses biome or eslint, add `.claude/worktrees/` to the root `.gitignore`: both discover nested config and trip over Claude Code worktrees.
<!-- stacks:when with=claude-harness -->

The shared harness supplies Bun TypeScript hook helpers. Write project-specific guards against those helpers and test them in `tests/hooks/`. The agent-ops hooks above stay bash.

Document `guard-commands.ts` in `.claude/README.md`: with Bun, `block-destructive.sh` hands it the payload, and it denies if it can't run.
<!-- stacks:end -->
