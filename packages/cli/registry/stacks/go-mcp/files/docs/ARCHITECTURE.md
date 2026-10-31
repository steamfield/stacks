# Architecture

The binary is an MCP server on the stdio transport: a host starts it, writes
JSON-RPC messages to its stdin one per line and reads replies from its stdout.
Stdout carries nothing else. Logs are JSON on stderr, which hosts collect into
their own MCP logs.

`main.go` sits at the root. It holds the version variables the Makefile (and
GoReleaser) set with ldflags, turns SIGINT and SIGTERM into a cancelled
context and exits with the status `internal/app` returns. Only `main` calls
`os.Exit`.

`internal/app` loads config, answers `--help` and `--version` on stdout before
anything serves, builds the logger on stderr and runs the server on the
transport it is given: `mcp.StdioTransport` in the binary, pipes in tests. The
server stops when the client closes stdin or a signal arrives; both exit 0.
Startup errors print one line on stderr and exit with the status
`internal/errors` maps them to (2 for a bad flag or setting).

`internal/config` is the only package reading flags and environment
variables (flags over `<PREFIX>_*` variables over defaults).

`internal/errors` carries a code, a message and an optional cause, and holds
the one table from code to exit status and to what a client may see:
`InvalidInput` and `Config` messages reach the caller as written; anything
else is a server fault, shown as a fixed message with the cause logged.

`internal/convert` is the proving payload's domain. It is plain Go with no
SDK import, so its tests need no server.

`internal/server` is the MCP boundary. `New` creates the `mcp.Server` (its
name, version and capabilities), adds request logging as receiving middleware
and registers every tool. `addTool` wraps `mcp.AddTool`: the SDK derives the
input and output JSON Schemas from the handler's Go types, validates
arguments before the handler runs, and fills structured content from the
output value. `addTool` adds the error policy: a returned error or a panic
becomes a tool result with `isError` set, never a protocol error or a crash.

`cmd/mcpcall` is a development client, not part of the server: it starts a
server binary over stdio, lists its tools or calls one. `make smoke` and
`make call` use it.

Unit tests live beside the code. `internal/server/server_test.go` connects a
real client to the server over `mcp.NewInMemoryTransports` and lists and calls
tools through the protocol. `internal/app/app_test.go` runs the whole app over
pipes. Tagged integration tests build the binary, drive it over stdio with the
SDK client, and check that stdout held only JSON-RPC, stderr only JSON logs,
and that the process exits on closed stdin and on signals.
