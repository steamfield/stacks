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
verify:
  - name: claude-typecheck-hook
    layer: test
    tags: [hygiene]
    run: "r=$(git rev-parse --show-toplevel 2>/dev/null) || r=.; test ! -f \"$r/.claude/hooks/typecheck-probe.sh\" || bash \"$r/.claude/hooks/typecheck-probe.sh\""
---

# Claude Code TypeScript hooks

`.claude/hooks/_lib.ts` is the helper for TypeScript hooks a stack or app adds: payload parsing, bounded child processes in their own process group, and deny and context responses. Bun runs the hooks, but the helpers use only Node APIs, so keep `.claude/hooks/` in the project's TypeScript check.

When Claude Code is a target, `typecheck-on-write.ts` runs tsc incrementally after each `.ts` or `.tsx` edit and hands the errors back. A stack that generates types supplies `.claude/hooks/before-typecheck.ts`, which the hook awaits before tsc; keep it bounded and quiet when its tools are absent.

A hook you add follows agent-ops' policy (deny only destructive work or a command that would hang the session), appears once in the merged settings, gets a case in `.claude/hooks/smoke.sh` and gets a row in `.claude/README.md`.

## Verify

`claude-typecheck-hook` runs `.claude/hooks/typecheck-probe.sh`, which feeds the hook a deliberate type error. When it fails, fix the hook or the install, never the probe.
