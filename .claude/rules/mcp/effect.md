---
paths:
  - "packages/mcp/src/**"
  - "packages/mcp/tests/**"
  - "packages/mcp/e2e/**"
---

# Effect (MCP server)

Load the `ce:effect` skill before writing Effect code or looking up its APIs. The MCP modules (`effect/ai`'s `McpServer`, `Tool`, `Toolkit`, `McpSchema`) are marked unstable: resolve `effect` from `packages/mcp` and read the installed declarations under `node_modules/effect/dist/ai/` before relying on a shape; they win over the skill, web docs and memory.

The CLI's service, layer and test policy in `.claude/rules/cli/effect.md` applies here too, except that service keys use `stacks-mcp/Name`. The server never imports the CLI: it runs the CLI's Node entry through `CliRunner`, the only place a child process starts, and reads only its `--json` results.
