# Testing

## What runs where

- Vitest (adjacent `src/**/*.test.ts` and `tests/`) covers zod schemas, FormData parsing, server services, form actions called directly and components rendered in jsdom. It reads the project's Vite config, so the SvelteKit plugin resolves the lib alias and kit modules.
- Playwright (`e2e/`) runs against the Node build (`bun run build`, then `bun run start`). It covers anything that needs the real server: rendered pages, enhanced and plain form posts, the rerun of load functions after a write, endpoints, hydration and the error page.

## Vitest

- Files that render components start with the per-file jsdom environment comment; everything else runs in the node environment.
- Testing Library's Svelte Vite plugin stays in the config. Browser resolution belongs only to the component project: enabling it globally makes server tests import browser implementations of kit helpers such as redirect.
- Services hold state, so each test resets it through the service's exported test helper in `beforeEach`. Never mock our own modules; use the real in-memory service.
- Call an action with an event whose `request` is a real `Request` carrying `FormData`. Build that event in one helper with one cast, and assert on the failure's status and data or on the service afterwards.
- Assert on what the user sees: Testing Library queries by role and label, `user-event` for input.
- Scoped first: `bun run test src/lib/item-schema.test.ts` (add `-t "<name>"` for one test), then `bun run test`. Vitest runs on Node: never `bun test`, never `--bun`.

## Playwright

- `bun run e2e` builds, starts the Node server on `PORT_E2E` and runs Chromium. Each spec starts from a page load; don't rely on order between specs.
- The server keeps in-memory state for the whole run. Assert on items a test created itself (a unique name per test), not on the total count.
- Progressive enhancement is part of the contract: one test submits the form in a browser context with JavaScript disabled.
- A 403 "Cross-site POST form submissions are forbidden" means the server's origin setting doesn't match the test URL. Fix the setting, never the CSRF check.
- On failure, read `test-results/<test>/error-context.md` first, then the trace (`bunx playwright show-trace`). Server errors appear in the server output Playwright prints.

## Discipline

- A bug fix starts with a test that fails for the bug's reason.
- A validation test proves the check bites: submit input that must be rejected and assert the field error and that nothing was added.
- Wait on conditions (`expect(...).toBeVisible()`, `vi.waitFor`), never on sleeps.
- Weakening an assertion, adding `.skip` or loosening a limit to get green is a failure, not a fix.
