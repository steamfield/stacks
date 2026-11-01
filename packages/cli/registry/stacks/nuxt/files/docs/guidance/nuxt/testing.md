# Testing

## What runs where

- Vitest project `unit` (Node): `shared/**/*.test.ts`, `server/**/*.test.ts` and `tests/**/*.test.ts` (the harness hook tests). Schemas, server utils, config and logging, imported by relative path. No Nuxt runtime, so nothing auto-imported is available: test the pure functions (`parseServerConfig`, `createLogger`) rather than the wrappers that read Nuxt state.
- Vitest project `nuxt` (the Nuxt test environment from `@nuxt/test-utils`, happy-dom): `app/**/*.test.ts`. Components and pages mounted with `mountSuspended`, which runs them inside a Nuxt app with auto-imports, so `useFetch`, `$fetch` and `createError` work.
- Playwright (`e2e/`) against the built server (`bun run build`, then `node .output/server/index.mjs`). Server-rendered HTML, the real routes and validation, the form in a browser after hydration, the refresh after a write, health, API errors and the 404 page.

## Vitest

- `registerEndpoint` from `@nuxt/test-utils/runtime` stands in for a server route inside the `nuxt` project. Use it only in component tests; the real route is covered by Playwright. `mockNuxtImport` replaces an auto-import, once per file.
- Server utils hold state: reset it in `beforeEach` through the util's test-only reset. Never mock our own modules.
- Query by role and label, and assert what the user sees. `flushPromises()` after a submit lets `$fetch` settle.
- Scoped first: `bun run test server/utils/notes.test.ts` (add `-t "<name>"` for one test) or `bunx vitest run --project unit`, then `bun run test`. Vitest runs on Node: never `bun test`, never `--bun`.

## Playwright

- `bun run e2e` builds, starts the server on `PORT_E2E` (default 3100) and runs Chromium with one worker.
- Wait for hydration (`open()` in `e2e/notes.spec.ts`) before clicking anything a Vue handler owns; otherwise the click hits the server-rendered HTML.
- The server keeps notes in memory for the whole run. Assert on notes a test created itself (unique text), not on totals.
- On failure, read `test-results/<test>/error-context.md`, then the trace (`bunx playwright show-trace`). The server's stderr appears in the Playwright output; its stdout (the request log) doesn't.

## Discipline

- A bug fix starts with a test that fails for the bug's reason.
- A validation test proves the check bites: submit input that must be rejected and assert the field message and that nothing was written.
- Wait on conditions (`expect(...).toBeVisible()`, `vi.waitFor`), never on sleeps.
- Weakening an assertion, adding `.skip` or loosening a limit to get green is a failure, not a fix.
