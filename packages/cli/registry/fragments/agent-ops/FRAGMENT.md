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
    tags: [hygiene]
    run: "test -s AGENTS.md && grep -q '^## Commands' AGENTS.md && ! grep -n 'stacks:fill' AGENTS.md"
  - name: claude-md-imports-agents
    layer: check
    tags: [hygiene]
    run: "test ! -f CLAUDE.md || grep -qx '@AGENTS.md' CLAUDE.md"
  - name: claude-readme-filled
    layer: check
    tags: [hygiene]
    run: "test ! -f .claude/README.md || ! grep -n 'stacks:fill' .claude/README.md"
  - name: hooks-smoke
    layer: check
    tags: [hygiene]
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

**Engineering guidance:** read `docs/guidance/engineering/` (tests, architecture, errors, readable code) before writing code, and keep `AGENTS.md`'s Conventions, Testing and Error handling consistent with it.

**Hooks** deny only destructive or irreversible work (deleting root, home or the project, discarding work or history, force pushes, dropped tables, publishing, cloud deletes, `curl | sh`, secret or `.env` writes) and fail open. Conventions go in guidance and lint, never a denying hook. A block means ask the user, never work around it.

**Claude Code adapter** (when Claude is a target): `CLAUDE.md` imports `AGENTS.md` via `@AGENTS.md` (never remove the line). `.claude/settings.json` wires the hooks; other fragments deep-merge into it. Replace `.claude/README.md`'s `stacks:fill` row with one row per shipped hook (`claude-readme-filled` checks).

Once Commands are settled, allow the project's non-destructive commands (lint, format, typecheck, test, single test file) in `.claude/settings.json` as `Bash(<cmd>)` / `Bash(<cmd> *)`. Never allow deploy, publish, release, migrate or deletes. Allow rules other entries merged are already approved.

**Other agents** run the shell guards from `.claude/hooks/`, so keep it whatever the targets. Codex runs project hooks only after the user trusts the project and approves each in `/hooks`: list that under Pending user actions.

`hooks-smoke` runs `.claude/hooks/smoke.sh`, the project's only hook test: a deny and a near miss per guard, and every hook config parses and wires real files. A hook you add gets a case there. If it fails, fix the hook or wiring, never the script.

Claude Code asks before any edit under `.claude/` or to `lefthook.yml`; if denied, finish the rest, then ask once for all of them with exact content.

With a linter (not just a formatter), confirm `lint-on-write.sh` reports a deliberate error, then revert; if silent, check the linter is where the hook looks (`.venv`, `node_modules/.bin`, PATH). On Stop, `format-changed.sh` formats this session's files. With biome or eslint, add `.claude/worktrees/` to `.gitignore`.
