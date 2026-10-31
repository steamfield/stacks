# Testing

Vitest runs every test on Node: `src/**/*.test.ts` and `tests/**/*.test.ts`. Never `bun test`.

- **Unit tests** beside the code. A tool's work function is tested directly with `test.each` tables: each row an input and the exact output, or an input and the `ToolError` code it raises (`src/tools/read-file.test.ts`). Use `tempRoot()` from `tests/helpers/server.ts` for files.
- **In-memory client** in `tests/server.test.ts`: `testServer()` connects a real SDK `Client` to `createServer()` over `InMemoryTransport.createLinkedPair()` and captures log records. Assert what a host sees: `listTools()` (names, JSON Schemas, annotations) and `callTool()` results, including `isError` with the exact `TOOL_ERRORS` message and the SDK's validation result for bad input. A new tool adds its list entry, a success, each tool error it can return and one invalid input.
- **stdio** in `tests/stdio.test.ts`: spawns `node src/index.ts` and connects SDK clients on both protocol eras, then runs a raw session asserting every stdout line is JSON-RPC and logs land on stderr, and that a bad config exits 2. Verify runs it on its own. It needs no build.
- **Boundary probes** in `tests/boundaries.test.ts`: each Grit rule fires on a fixture file and stays quiet where the thing is allowed. A new rule adds a row to both tables.
- **Smoke** (`bun run smoke`, after `bun run build`): MCP Inspector's CLI starts `dist/index.js` and lists the tools with `--strict`. It is the only check of the bundle.

A handler failure comes back as a result with `isError: true`, not a rejected promise; assert on the result. Close the client before the server in `afterEach`, as `testServer().close()` does.

Coverage thresholds live in `vitest.config.ts` (`bun run coverage`). Scope a run with `bun run test <file>` or `bun run test -t "<name>"`, and read the counts: a filter that matches nothing passes with every test skipped.
