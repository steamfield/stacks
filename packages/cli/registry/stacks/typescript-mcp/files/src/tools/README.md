# MCP tools

Start with [read-file.ts](read-file.ts) to follow a tool from zod input and output
schemas through registration to its filesystem checks. It reads bounded UTF-8
files inside the configured root and rejects paths or symbolic links that escape.

[deps.ts](deps.ts) defines the configuration and logger the server supplies.
[run.ts](run.ts) wraps calls with structured results, safe error text and outcome
logging; [../errors.ts](../errors.ts) owns the fixed messages.

The adjacent tests exercise the file reader and result policy. New tools register
in [../server.ts](../server.ts) and use the same dependencies and runner.

