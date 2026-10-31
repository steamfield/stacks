# Testing

Vitest runs every test on Node: `src/**/*.test.ts` and `tests/**/*.test.ts`. Never `bun test`.

- **Unit tests** beside the code: config parsing, the error mapping, the logger and the store. Inject time and ids (`createMemoryNotes({ now, newId })`) rather than mocking globals.
- **Contract tests** in `tests/http-contract.test.ts`: `testApp()` from `tests/helpers/app.ts` builds a fresh app with its own store and captured log records, and each test calls `app.request(path, init)`. Assert the status, the body parsed through its schema (`Note.parse`, `ErrorEnvelope.parse`), headers (`location`, `x-request-id`) and the request records. `expectEnvelope(res, code)` checks an error against `errorTable`. Verify runs this file on its own as `http-contract`.
- **Server test** in `tests/server.test.ts`: `startServer(app, 0)` binds a free port and the test calls it with `fetch`, then closes it in `afterEach`. Keep it to what only a real socket shows.
- **Boundary probes** in `tests/boundaries.test.ts`: each Grit rule fires on a fixture file and stays quiet where the thing is allowed. A new rule adds a row to both tables.

A new endpoint adds rows for: success with its exact status and body, each error status the route declares, an unknown query key or body field, and a malformed path parameter. Use real stores; for a failure the store can't produce, pass a small object implementing the store interface, as the 500 test does.

Scope a run with `bun run test <file>` or `bun run test -t "<name>"`, and read the counts: a filter that matches nothing passes with every test skipped.
