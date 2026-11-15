# MCP server source

Start with [index.ts](index.ts), which loads configuration, creates the logger and
starts stdio. [server.ts](server.ts) builds a fresh MCP server and registers tools
without choosing a transport; integration tests connect it in memory.

[config.ts](config.ts) validates the environment and checks that the root is a directory.
[logging.ts](logging.ts) keeps JSON logs on stderr, leaving stdout for JSON-RPC.
[errors.ts](errors.ts) defines safe tool-error messages.
[tools/](tools/README.md) owns the file reader and shared tool-call policy.

Unit tests sit beside their modules. The client-facing and process tests are in
`../tests/`.

