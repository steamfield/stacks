---
name: add-tool
description: Add a tool to this MCP server end to end, with its zod input and output schemas, a description written for a model, tool errors, registration and tests through a real MCP client. Use when asked for a new MCP tool, a new capability the model can call, or a change to a tool's arguments or result.
---

# Add a tool

Follow `read_file`: `src/tools/read-file.ts`, `src/tools/read-file.test.ts`, `src/errors.ts`, `src/server.ts` and `tests/server.test.ts` are the model. Read `docs/guidance/typescript-mcp/server.md` first.

Before any code, write down: the `snake_case` name, one or two sentences saying what it does and when a model should call it, each argument with its type and an example, the result's fields, each failure the model could act on, and whether it reads, writes or reaches the network (its annotations). Ask before renaming or removing a tool or an argument: saved prompts and other agents call it by name.

1. **Errors**: each new failure adds a code and a fixed message to `TOOL_ERRORS` in `src/errors.ts`. The message tells the model what to do next and contains no path, value or exception text.
2. **Failing tests**: a `src/tools/<name>.test.ts` table of inputs and exact outputs, and of inputs and the `ToolError` code each raises; then in `tests/server.test.ts`, its `listTools()` entry, one `callTool()` success, each tool error with its exact message, and one invalid input. Run them and watch them fail.
3. **Tool** in `src/tools/<name>.ts`: a `z.strictObject` input with `.describe()` on every field, an output `z.object`, the work function throwing only `ToolError` for expected failures, and `register<Name>(server, deps)` calling `server.registerTool` with `title`, `description`, both schemas and `annotations`, its handler wrapped in `runTool(deps.logger, "<name>", ...)`. A new dependency goes in `ToolDeps`, built in `src/index.ts`.
4. **Register** it in `createServer` in `src/server.ts`, and update the server `instructions` if they no longer describe what the server offers.
5. **README**: its entry in the Tools section with arguments, result and errors.
6. `bun run check`, then `stacks verify`. Call it once through Inspector's CLI (`docs/guidance/typescript-mcp/verification.md`) and read the stderr record.

Keep it thin: no arguments, result fields or modes the request didn't ask for. Nothing in it writes to stdout.
