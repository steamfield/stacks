---
paths:
  - "main.go"
  - "internal/**"
  - "cmd/**"
  - "tests/**"
---

# MCP server rules

- Stdout is the stdio transport. Nothing in the server writes to it: no `fmt.Print*`, `println` or `os.Stdout` (forbidigo fails `make lint` on them). Logs go to the injected `*slog.Logger`, which writes JSON to stderr.
- Register tools with `addTool` in `internal/server`, never `mcp.AddTool` or `Server.AddTool` directly: `addTool` is the one place errors and panics become tool results.
- A tool's input and output are Go structs. `json` tags name the properties, fields without `omitempty` are required, and the `jsonschema` tag is the property's description. Every field gets one; the model sees nothing else.
- Tool descriptions are prompts for another model: say when to call it, what it needs and what it returns, with one example call. Tool names are snake_case.
- Domain code (`internal/convert` and its siblings) returns `internal/errors` values and never imports the SDK. A caller's mistake is `InvalidInput` with a message that tells the model how to fix the call; anything else is a server fault and the model sees only a fixed message.
- A tool failure is a result with `isError`, never a protocol error and never a panic.
- Every tool gets list and call tests over `mcp.NewInMemoryTransports` in `server_test.go`, covering success and each error path. To try the built server, run `make call`; piped JSON-RPC gets no reply.
- Import only `github.com/modelcontextprotocol/go-sdk/mcp`. Examples online often use mark3labs/mcp-go or pre-1.0 SDK APIs; read `go doc github.com/modelcontextprotocol/go-sdk/mcp` instead.

See the project's `AGENTS.md` for commands and the remaining conventions.
