# MCP integration tests

Start with [server.test.ts](server.test.ts): a real SDK client lists and calls
tools through an in-memory transport. [helpers/server.ts](helpers/server.ts)
creates each connection with a temporary root and captured logs, and supplies
helpers to source unit tests.

[stdio.test.ts](stdio.test.ts) starts the real Node entry and checks both protocol
eras, protocol-only stdout, stderr logs and shutdown.
[boundaries.test.ts](boundaries.test.ts) probes the Biome plugin with permitted
and rejected source snippets.

Vitest runs these tests and the unit tests beside `../src/` modules.

