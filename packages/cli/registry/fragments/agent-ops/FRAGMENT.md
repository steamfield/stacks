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

`AGENTS.md` is the one instruction file for every coding agent, and each targeted agent's adapter adds guards against destructive commands and secret writes. Read `docs/guidance/engineering/` before writing code.

## What to add

Fill `AGENTS.md` last, once verify is nearly green, following each `stacks:fill` comment. Commands lists every declared command, each run once, plus one concrete single-test command (one test file or one test name). Another fragment's section goes under its own `##` near related ones: a database after Architecture map, CI and deploy before Deferred.

<!-- stacks:when mode=add -->
An existing `AGENTS.md` is kept (listed as "merge needed"): add the skeleton's missing sections to it. An existing `CLAUDE.md` imports `AGENTS.md` with `@AGENTS.md` on its own line, which verify checks; move shared content into `AGENTS.md`.
<!-- stacks:end -->

Once Commands are settled, let agents run every declared non-destructive command without a prompt, including the single-test command, `format`, `audit` and any background start and stop. In Claude Code that is `Bash(<cmd>)` and `Bash(<cmd> *)` in `.claude/settings.json`; in OpenCode, `"<cmd>*": "allow"` under `permission.bash` in `opencode.json`. Deploy, publish, release, migrate, deletes and paid or live third-party calls keep prompting. Allow rules already merged into `.claude/settings.json` are approved.

Hooks deny only destructive or irreversible work and fail open; conventions belong in guidance and lint. A hook you add gets a deny and a near-miss case in `.claude/hooks/smoke.sh`, which `hooks-smoke` runs; when it fails, fix the hook or its wiring, never the script. Keep `.claude/hooks/` whatever the targets, because every agent's guards run from it. Codex runs project hooks only after the user trusts the project and approves each in `/hooks`: list that under Pending user actions.

Claude Code asks the user before any edit under `.claude/` or to `lefthook.yml`. If the user declines, finish the rest, then ask once for all of them with the exact content.

With a linter configured (a formatter alone doesn't count), write a deliberate lint error and confirm `lint-on-write.sh` reports it, then revert. If it stays silent, the linter isn't where the hook looks (`.venv`, `node_modules/.bin`, PATH). With Biome or ESLint, add `.claude/worktrees/` to the root `.gitignore`.
