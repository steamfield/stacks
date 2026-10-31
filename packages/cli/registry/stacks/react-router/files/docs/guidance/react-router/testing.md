# Testing

## No external services, fakes only at the boundary

- Tests use no external services and need no `.env` or credentials. The browser smoke uses a local built server.
- The only fakes are for third parties. Never mock our own modules or services; build a test runtime from real in-memory layers (`layerMemory`) instead.
- Route tests call loaders and actions with a real `Request` on a test runtime set through the runtime setter, and dispose it afterwards. `tests/helpers/runtime.ts` builds their arguments, including `new RouterContextProvider()`, the URL and route pattern.

## Required coverage

- `/healthz` succeeding through the runtime, and failing visibly when config is invalid.
- Error paths for every route, each status it can return (bad body 400, oversized body 413, wrong content type 415, missing thing 404, defect 500), with `retryable` asserted on each error body, not only the status. Test actual streamed bytes at and above MAX_BODY_BYTES, rather than trusting Content-Length.
- Request ids on responses, one completed-request log line, a defect logged exactly once, runtime isolation and disposal, and a log file sink that survives its directory being deleted.
- Retry schedules and anything time-based with `TestClock`.

## Effect tests

- `it.effect` runs on the TestClock (it starts at 0 and moves only when adjusted; fork the program, adjust, then join) and silences the default logger. The `effect` skill has the installed names.
- The TestClock doesn't reach routes run through a test runtime (a separate `ManagedRuntime` on the live clock). Test time-based behavior on the program or service with its layers provided directly.
- `it.layer` shares one layer build across its block; build fresh layers per test when state must not leak.

## Running

- Scoped first: `bun run test app/.server/http.test.ts` (add `-t "<name>"` for one test). Then `bun run test` before calling it done. Vitest runs on Node: never `bun test`, never `--bun`.
- Server tests run in the `node` environment; component tests opt into `happy-dom` per file. happy-dom replaces `fetch` and enforces same-origin rules, so a component test that calls a local server disables its same-origin policy for that file.
- Components that render router links need `createRoutesStub`.
- `bun run e2e` builds and runs the Playwright smoke against `bun run start`, using `@react-router/serve` on the separate test port. Add to it only when a change could break in the browser but not in happy-dom (hydration, the client bundle, a download); test behavior in vitest. On failure, read `test-results/<test>/error-context.md` first: it has the error and a snapshot of the page. Apps add their own acceptance flows.

## Discipline

- A bug fix starts with a test that fails for the bug's reason. Reintroduce the bug once to see it go red.
- A validation or limit test must prove the check bites: feed input that should be rejected and assert the rejection, not just that valid input passes.
- Never sleep to wait for something: wait on a condition (`vi.waitFor`), or drive the clock.
- Weakening an assertion, adding `.skip`, or loosening a limit to get green is a failure, not a fix.
- A subagent asked to write tests touches only test files; check with `git diff --stat`.
