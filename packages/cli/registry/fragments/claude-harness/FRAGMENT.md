---
schema_version: 1
id: claude-harness
kind: fragment
category: agent-ops
name: Claude Code TypeScript hooks
description: Bun TypeScript hook helpers and tested Claude Code guards on top of agent-ops (destructive commands, package manager, generated files, typecheck on write), plus /check, /test and /feature commands, architect and reviewer agents, and a docs/harness.md guide.
tags: [bun, agents]
applies_to: [astro-blog, astro-fullstack, nextjs, react-router, sveltekit, tauri-react, typescript-api, typescript-cli]
requires: [agent-ops]
tools: [bun]
merge: [.claude/settings.json]
verify:
  - name: harness-hooks
    layer: check
    run: "test ! -d tests/hooks || node node_modules/vitest/vitest.mjs run tests/hooks"
  - name: harness-doc-filled
    layer: check
    run: "test ! -f docs/harness.md || ! grep -n 'stacks:fill' docs/harness.md"
---

# Claude development harness

Shared hook helpers (`_lib.ts`, `_shell.ts`) ship for every target. Stacks can use them from Claude Code or Codex hooks. Claude's remaining harness is adapter-only; the instructions below about Claude apply when it is a target.

When Claude is a target, its adapter adds generated-file, destructive-command and package-manager guards, incremental type checking, hook tests, `/check`, `/test`, `/feature`, and read-only `architect` and `reviewer` agents. Read `docs/harness.md` before changing the harness. Stacks and apps own their specialized hooks and permissions; each contribution merges its agent's hook config and wires only files it owns.

Include `.claude/hooks/` in TypeScript checking and `tests/hooks/**/*.test.ts` in Vitest (Node environment). Helpers use Node APIs even though Bun executes them. `block-destructive.sh` delegates to `guard-commands.ts` when present and Bun is available; wire only the shell entry for destructive-command checks. `harness-hooks` runs every shipped hook test on Node, including Codex's; it does nothing when no hook tests exist. It uses the `check` layer because this conditional success cannot establish a test milestone, and it needs Vitest at the project root, which is why the fragment fits only the stacks it lists. The package-manager guard allows the manager that owns the lockfile. A stack can supply `.claude/hooks/before-typecheck.ts` for generated types; the typecheck hook awaits it before tsc. Keep it bounded and quiet when tools are absent.

Populate `.claude/README.md` with the actual hooks, rules, commands, skills, and agents, and link the harness doc from AGENTS.md. In `docs/harness.md`, add a row to the layer table for each guard the stack or app ships, and replace its `stacks:fill` markers (commands, skills, lint plugins; `harness-doc-filled` checks). Add project commands to permissions only when safe to run without another prompt; leave paid and live third-party operations interactive. Every hook needs a deny/near-miss or advisory regression test and must appear exactly once in merged settings. Run the shipped tests and manually send a representative payload before completion.
