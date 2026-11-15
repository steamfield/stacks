# API integration tests

Start with [http-contract.test.ts](http-contract.test.ts) for the public contract:
statuses, response schemas, request ids, pagination and safe failures through
`app.request()`. [helpers/app.ts](helpers/app.ts) supplies a fresh app, isolated
store, captured logs and JSON request options.

[server.test.ts](server.test.ts) serves that app over a real socket on port 0
and checks requests and shutdown. [boundaries.test.ts](boundaries.test.ts)
probes the Biome plugin's permitted and rejected source patterns.

Vitest runs these tests and the unit tests beside `../src/` modules. The app
factory keeps in-process tests independent of process environment and listening ports.

