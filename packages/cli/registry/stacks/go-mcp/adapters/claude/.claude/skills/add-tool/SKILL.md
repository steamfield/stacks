---
name: add-tool
description: Add a tool to this MCP server, with typed input and output structs, domain logic, registration through addTool and in-memory protocol tests. Use when the user asks for a new tool, action, command or capability the agent host should be able to call.
---

# Add an MCP tool

`convert_units` is the model to copy: domain logic in `internal/convert`, the tool in `internal/server/convert.go`, its tests in `internal/server/server_test.go`.

1. Put the logic in a domain package under `internal/` that doesn't import the SDK. Return `apperrors.New(apperrors.InvalidInput, "<what was wrong and how to fix the call>")` for a caller's mistake; wrap anything else with `apperrors.Internal`.
2. In `internal/server/<tool>.go`, declare `<Tool>Input` and `<Tool>Output` structs. Every field gets a `json` tag (no `omitempty` unless it's optional) and a `jsonschema` description.
3. Write the description as instructions for a model: when to call the tool, what it needs, what it returns, and one example call as JSON.
4. Add `add<Tool>(s, logger)` calling `addTool` with a snake_case name, a title and annotations (`ReadOnlyHint`, `IdempotentHint`, `DestructiveHint`, `OpenWorldHint` as they apply), and call it from `server.New`.
5. In `server_test.go`, assert the tool is listed with its required properties, then add call cases for success (decode `StructuredContent` into the output struct) and each error path, asserting `IsError` and the message.
6. Run `make fmt lint test test-integration`, then `make call TOOL=<name> ARGS='<json>'` to try it over stdio. Add the tool to the README's tool table.
