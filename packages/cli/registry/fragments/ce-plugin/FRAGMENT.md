---
schema_version: 1
id: ce-plugin
kind: fragment
category: agent-ops
name: Claude Essentials plugin
description: Enables the claude-essentials (ce) Claude Code plugin for the project and adds path-scoped rules that point Claude at its skills for testing, error handling and writing, plus a debugging rule that names its log-reader agent.
tags: [agents, claude]
applies_to: []
requires: [agent-ops]
merge: [.claude/settings.json]
verify:
  - name: ce-plugin-wired
    layer: check
    run: "test ! -f .claude/settings.json || grep -q '\"ce@claude-essentials\"' .claude/settings.json"
---

# Claude Essentials plugin

Enable the `ce` Claude Code plugin and connect its skills through project rules.

## What to add

**Settings.** The merge into `.claude/settings.json` registers the marketplace and enables the plugin. It may appear only after the user trusts the project folder and starts another session. `ce-plugin-wired` checks the merged settings still enable it; verify can't check the skills, which live in each person's plugin install.

**Rules.** The shipped `.claude/rules/` files route Claude to skills and defer project facts to AGENTS.md:

| Rule | Loads for | Points at |
| --- | --- | --- |
| `testing.md` | test files and test directories | `ce:writing-tests`, including flaky tests |
| `error-handling.md` | source files (TS/JS, Python, Go, Rust) | `ce:handling-errors` |
| `debugging.md` | always | the debugging budget in `AGENTS.md`, the `ce:log-reader` agent |
| `writing.md` | Markdown and `docs/` | `ce:writer` |

Check the `paths:` globs against the real layout; narrow overly broad matches. Put stack-specific testing rules in `testing.md` under `## Project specifics`, without repeating AGENTS.md. Add other rules only where matching files exist: migrations and SQL to `ce:managing-databases`, UI components to `ce:design`; skip `ce:effect` when the project ships its own Effect skill.

Don't copy skill content into rules or AGENTS.md. List added rules in `.claude/README.md`.

## Gotchas

- Check the plugin's current skill list before adding or keeping a rule; an unknown skill name silently does nothing.
