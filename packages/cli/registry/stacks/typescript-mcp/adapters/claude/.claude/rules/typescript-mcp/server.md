---
paths:
  - "src/**"
---

Read [server guidance](../../../docs/guidance/typescript-mcp/server.md) before changing the server. It is the shared guidance for every selected agent. Nothing in `src/` writes to stdout: on stdio it is the JSON-RPC channel, so log through `src/logging.ts` (stderr). Imports come from the v2 packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`), never `@modelcontextprotocol/sdk`; read the installed declarations before using an SDK API.
