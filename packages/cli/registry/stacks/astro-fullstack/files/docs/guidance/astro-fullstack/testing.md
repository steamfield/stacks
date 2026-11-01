# Testing

Test what a client observes, with real dependencies, so tests survive refactoring. A test that breaks when you rename a private function or restructure a service, with behavior unchanged, is testing the implementation.

## Which kind of test

- Integration through HTTP is the default. Send a request to the real `apps/api/src/app.ts` (Effect's in-process test client for the api, the contract's typed client, or a real server on an ephemeral port from `apps/api/tests/helpers/server.ts`) with real in-memory layers, and assert on the status, headers and decoded body. That covers routing, decoding, the handler, services, the error table and encoding at once.
- Unit tests are for pure functions with no dependencies: a schema's transformations, a pagination cursor codec, a pricing rule. Don't unit-test a handler or a service method by stubbing what it calls.
- A smoke against the built bundle (`bun run build`, then `start` on a free port and hit `/healthz`) catches what source tests can't: bundling, the Node entry, startup config.

## What to fake, and what never to

- Fake only what you don't own: a third-party HTTP API (a local stub server with hand-written or recorded responses), time (`TestClock`) and randomness. Tests never reach the network and need no `.env` or credentials.
- Never mock your own modules, services or the store. Build the test app from real layers: `layerMemory` for in-memory state, or a real local database for a storage service (a temporary SQLite file, or the store the storage fragment provides). If a test needs a fake of your own service to be fast, the service is doing too much.
- A fake mirrors the real thing's whole contract, including its errors, or the test passes against behavior production never has.

## What to assert

- The response: status, the body decoded with the endpoint's schema, and the headers that are contract (`Location`, `Retry-After`, `x-request-id`). For errors, the envelope's `tag` and `retryable` as well as the status.
- Persisted effects through the API itself: after `POST /v1/orders`, `GET` the `Location`; after `DELETE`, the `GET` is 404. Reading the store directly is for the rare case the API can't show it.
- Never assert that a mock was called, on internal state, or on log text beyond the fields the logging contract names.

## Required coverage for each endpoint

- The success path, and every status it can return: 400 for a bad param, query or body (and a rejected unknown query param), 404 for an absent resource, 409 where uniqueness or versions apply, 415 for a non-JSON body on an endpoint that takes a payload, plus whatever the endpoint's own errors add.
- A validation or limit test proves the check bites: send input that must be rejected and assert the rejection, not only that valid input passes. Include the boundary values (empty, maximum length, page size above the maximum).
- Lists: first page, a following page by cursor, the last page with no `nextCursor`, and a stable order on ties.

## Effect tests

- With `@effect/vitest` installed, `it.effect` runs on the `TestClock` (it starts at 0 and moves only when adjusted: fork the program, adjust, then join) and silences the default logger; names are in `docs/guidance/effect/api.md` when the project has one. Without it, run programs with `Effect.runPromise` and provide `TestClock` yourself.
- Build a fresh app layer per test when state must not leak; `it.layer` shares one build across its block on purpose only.
- Time-based behavior (retry schedules, rate limits, expiry) is tested with `TestClock`, never with real sleeps. For real I/O in between (the stub server), wait on a condition (`vi.waitFor`), not a fixed delay.
- Assert typed failures and defects explicitly; never let a test pass because a failure was swallowed.

## Running

- Scoped first: `bun run test apps/api/tests/<file>.test.ts` or `bun run test --project api` (add `-t "<name>"` for one test), then `bun run test` before calling it done. Site tests follow `docs/guidance/astro-fullstack/astro.md`. Vitest runs on Node: never `bun test`, never `--bun`.
- Test names describe behavior from the client's side ("creating an order with a taken reference is 409"), not the function under test.

## Discipline

- A bug fix starts with a test that fails for the bug's reason. Reintroduce the bug once to see it go red.
- Weakening an assertion, adding `.skip`, or loosening a limit to get green is a failure, not a fix.
- A subagent asked to write tests touches only test files; check with `git diff --stat`.
