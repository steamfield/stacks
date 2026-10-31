# Testing

Three layers test the app against its real code, with the external API as the only fake. A fourth checks the project's own tooling.

| Layer | Where | Runs on | Fake API |
| --- | --- | --- | --- |
| Unit | `src/**/*.test.ts` beside the code | Vitest, happy-dom | MSW in Node (`tests/msw/server.ts`) |
| Component | `src/app/routes.test.tsx` and new `*.test.tsx` | Vitest, happy-dom, Testing Library | MSW |
| Browser | `e2e/*.spec.ts` | Playwright Chromium against `vite preview` of the build | `page.route` |
| Repo checks | `tests/*.test.ts` (the Grit probes) and `tests/hooks/` | Vitest, Node | none |

## Rules

- Never mock the app's own modules. Component tests render real routes through `renderRoute(path)` in `tests/render.tsx`, which builds the real API client and query client. Change the API's answer with `server.use(http.get("*/api/...", ...))` for one test; `tests/setup.ts` resets handlers after each.
- An unhandled request fails the test (`onUnhandledFrame: "error"`). Add a default handler to `tests/msw/server.ts` for a new endpoint, and a fixture to `tests/fixtures/` that both MSW and Playwright read.
- Every new query covers success, the empty case where it has one, an HTTP error with its request id, and a body in the wrong shape.
- Query by role and accessible name (`getByRole("heading", { name })`), and wait with `findBy*`, never a sleep.
- A bug fix starts with a test that fails for the bug's reason.
- happy-dom prints each non-2xx response (`GET http://localhost:3000/api/items 500`) and network failure the way a browser console does. In the error-path tests those lines are expected; a failing test still reports its own assertion.

## Browser tests

`bun run e2e` builds, then serves `dist/` with `vite preview` on `PORT_E2E` (default 4180) and runs Chromium with one worker. `e2e/items.spec.ts` routes the API with `page.route`, using the base URL `loadEnv` reads, so it works whatever `VITE_API_URL` is set to. Add a browser test only for what happy-dom can't show: the built bundle, deep-link reloads, real navigation. On failure read `test-results/<test>/error-context.md` first.

## Running

`bun run test src/api/client.test.ts` for one file, `-t "<name>"` for one test, then `bun run test` before calling it done. Vitest runs on Node: never `bun test`, never `--bun`.
