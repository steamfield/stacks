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
    run: "r=; for p in . ..; do test -f $p/.claude/hooks/typecheck-on-write.ts && r=$p && break; done; test -n \"$r\" || exit 0; t=$(ls node_modules/.bin/tsc */node_modules/.bin/tsc 2>/dev/null | head -n 1); test -n \"$t\" || { echo 'claude-typecheck-hook: no node_modules/.bin/tsc; install typescript' >&2; exit 1; }; d=$(mktemp -d $r/.claude/hooks/.typecheck-probe.XXXXXX) || exit 1; trap 'rm -rf \"$d\"' EXIT; mkdir -p \"$d/node_modules/.bin\" && ln -s \"$PWD/$t\" \"$d/node_modules/.bin/tsc\" && printf '{\"compilerOptions\":{\"strict\":true,\"noEmit\":true,\"types\":[]},\"files\":[\"probe.ts\"]}\\n' > \"$d/tsconfig.json\" && printf 'export const n: number = \"text\";\\n' > \"$d/probe.ts\" && printf '{\"tool_input\":{\"file_path\":\"%s/probe.ts\"}}' \"$PWD/$d\" | bun $r/.claude/hooks/typecheck-on-write.ts | grep -q 'type error(s), 1 in probe.ts' || { echo 'claude-typecheck-hook: typecheck-on-write.ts reported nothing for a deliberate type error' >&2; exit 1; }"
---

# Claude Code TypeScript hooks

`.claude/hooks/_lib.ts` is the helper for TypeScript hooks a stack or app adds: payload parsing, bounded child processes in their own process group, and deny and context responses. Bun runs the hooks, but the helpers use only Node APIs, so keep `.claude/hooks/` in the project's TypeScript check.

When Claude Code is a target, `typecheck-on-write.ts` runs tsc incrementally after each `.ts` or `.tsx` edit and hands the errors back. A stack that generates types supplies `.claude/hooks/before-typecheck.ts`, which the hook awaits before tsc; keep it bounded and quiet when its tools are absent.

A hook you add follows agent-ops' policy (deny only destructive work or a command that would hang the session), appears once in the merged settings, gets a case in `.claude/hooks/smoke.sh` and gets a row in `.claude/README.md`.

## Verify

`claude-typecheck-hook` feeds `typecheck-on-write.ts` a deliberate type error in a throwaway package under `.claude/hooks/` and fails unless the hook reports it. It uses the `tsc` installed where the step runs (or one directory down), and passes without running when Claude Code isn't a target.
