# Server

## Layout

- `src/index.ts`: the stdio entry. The only module that reads `process` (env, cwd, signals) or imports a transport (`serveStdio` from `@modelcontextprotocol/server/stdio`).
- `src/server.ts`: `createServer(info, deps)` builds a fresh `McpServer` and calls each tool module's `register<Tool>(server, deps)`. `serveStdio` calls it once per connection, so it does no I/O.
- `src/tools/<tool>.ts`: the tool's zod input and output schemas, the function that does the work (throwing `ToolError`), and `register<Tool>`. `src/tools/run.ts::runTool` wraps every handler. `src/tools/deps.ts::ToolDeps` is what a tool may use.
- `src/config.ts`, `src/errors.ts`, `src/logging.ts`: settings, tool error codes, the stderr logger.

## Tools are read by a model

- Names are `snake_case` verbs on a noun (`read_file`, `list_notes`), unique across the server. Renaming a tool breaks every saved prompt that names it.
- The `description` says what the tool does and when to call it, in one or two sentences. Each input field gets `.describe()` with an example. `bun run smoke` fails a description under 20 characters.
- Inputs are `z.strictObject`, so an unknown argument is rejected before the handler runs. Bound strings and numbers (`.max()`, `.int()`); the SDK sends the JSON Schema to the client.
- Declare an `outputSchema` and return the value: `runTool` puts it in `structuredContent` (which the SDK validates) and the same JSON in a text block for clients that read only text.
- `annotations` tell the host about side effects: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. A tool that writes or calls out says so; hosts use them to decide what to confirm.

## Tool errors versus protocol errors

- A failure the model can act on (bad path, missing record, too large) is a tool error: throw `new ToolError(code)`. `runTool` returns `isError: true` with the code's fixed message from `TOOL_ERRORS`. The message names the fix, because it is all the model gets, and never includes a path, a value or another exception's text.
- Anything else is a bug: `runTool` logs its class and returns a generic `isError` result. Don't catch and rephrase unexpected errors in a tool.
- Input that fails the schema never reaches the handler; the SDK answers with its own `isError` validation result.
- Protocol errors (`ProtocolError`, `ProtocolErrorCode`) are for resource, prompt and completion callbacks, which have no `isError` channel. A tool never throws one.

## stdout belongs to the protocol

On stdio the host parses every line of stdout as JSON-RPC. One `console.log` corrupts the session, usually with a confusing error on the host's side. Log with the pino logger from `src/logging.ts`, which writes JSON lines to stderr; log a tool call's name, outcome and duration, never its arguments or result. The Grit plugin rejects `console` in `src/` and `process.stdout` anywhere in `src/`, and `tests/stdio.test.ts` fails on any non-JSON-RPC stdout line. MCP logging notifications (`ctx.mcpReq.log`) are deprecated as of the 2026-07-28 protocol; don't add them.

## Config

`loadConfig` validates the environment with zod and exits 2 with the variable's name before the transport starts. A host passes env in its server config. A new setting goes in `Env`, `AppConfig`, `.env.example` and the README together, with a default unless the server can't run without it (`MCP_ROOT`).

## The SDK

This is the v2 SDK: `@modelcontextprotocol/server` (`McpServer` and result types such as `CallToolResult`), `@modelcontextprotocol/server/stdio` (`serveStdio`), `@modelcontextprotocol/client` (`Client`, `InMemoryTransport`) and `@modelcontextprotocol/client/stdio` (`StdioClientTransport`). Tutorials and model memory show v1 (`@modelcontextprotocol/sdk/server/mcp.js`, `server.tool(...)`, `McpError`); read the installed declarations under `node_modules/@modelcontextprotocol/*/dist/*.d.mts` before using an API. `serveStdio` takes a factory and serves both protocol eras (2025 `initialize` clients and 2026-07-28 clients); don't replace it with `server.connect(new StdioServerTransport())`, which serves the 2025 era only.
