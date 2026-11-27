---
schema_version: 1
id: claude-harness-docs
kind: fragment
category: agent-ops
name: Claude Code commands and harness guide
description: For long-lived repos, adds /check, /test and /feature commands, read-only architect and reviewer agents, and a docs/harness.md guide to each guard layer on top of the claude-harness hooks.
tags: [bun, agents]
applies_to: [astro-blog, astro-fullstack, nextjs, react-router, sveltekit, tauri-react, typescript-api, typescript-cli, react-vite, hono-api, typescript-library, typescript-mcp, nuxt, nestjs-api, phaser-game, threejs-game]
requires: [claude-harness]
verify:
  - name: harness-doc-filled
    layer: check
    tags: [hygiene]
    run: "test ! -f docs/harness.md || ! grep -n 'stacks:fill' docs/harness.md"
---

# Claude Code commands and harness guide

When Claude is a target, this adds `/check`, `/test`, `/feature`, `architect` and `reviewer` agents, and `docs/harness.md`. Fill that guide's layer table and `stacks:fill` markers, link it from AGENTS.md, and list the commands and agents in `.claude/README.md`.
