---
schema_version: 1
id: claude-harness
kind: fragment
category: agent-ops
name: Claude Code TypeScript hooks
description: Bun TypeScript hook helpers for stack-specific Claude Code hooks on top of agent-ops, and incremental type checking after each edit.
tags: [bun, agents]
applies_to: [astro-blog, astro-fullstack, nextjs, react-router, sveltekit, tauri-react, typescript-api, typescript-cli, react-vite, hono-api, typescript-library, typescript-mcp, nuxt, nestjs-api, phaser-game, threejs-game]
requires: [agent-ops]
tools: [bun]
merge: [.claude/settings.json]
verify: []
---

# Claude development harness

The shared TypeScript hook helper `_lib.ts` ships for every target; stack guards are bash on agent-ops' `_lib.sh`. Claude's remaining harness is adapter-only; the instructions below about Claude apply when it is a target.

When Claude is a target, its adapter adds incremental type checking after each edit. Stacks and apps own their specialized hooks and permissions; each contribution merges its agent's hook config and wires only files it owns. Hooks follow agent-ops's policy: deny only destructive work or a command that would hang the session; conventions go in guidance and lint.

Include `.claude/hooks/` in TypeScript checking. Helpers use Node APIs even though Bun executes them. A stack can supply `.claude/hooks/before-typecheck.ts` for generated types; the typecheck hook awaits it before tsc. Keep it bounded and quiet when tools are absent.

Populate `.claude/README.md` with the actual hooks, rules, commands, skills, and agents. Add project commands to permissions only when safe to run without another prompt; leave paid and live third-party operations interactive. Each hook appears exactly once in merged settings, and a hook you add gets a case in `.claude/hooks/smoke.sh`.
