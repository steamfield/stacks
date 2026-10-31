# Testing

## What runs where

- Vitest runs colocated `src/**/*.test.{ts,tsx}` and `tests/**/*.test.{ts,tsx}` (including harness hooks). It covers zod schemas, FormData parsing, server services and client components. It can't render async server components and has no Next request context, so it never calls a Server Action or a cache invalidation API.
- Playwright (`e2e/`) runs against `next build` plus `next start`. It covers anything that needs the real server: async pages, Server Actions, revalidation after a write, route handlers and hydration.

## Vitest

- Files that render components start with the per-file jsdom environment comment; everything else runs in the node environment.
- `server-only` is mapped to an empty module in `vitest.config`. Don't remove that: the real package throws when imported outside Next's server bundler.
- Services hold state, so each test resets it through the service's exported test helper in `beforeEach`. Never mock our own modules; use the real in-memory service.
- Client components that call an action get a stub action passed as a prop or module boundary, and the assertions are on what the user sees (Testing Library queries by role and label, `user-event` for input).
- Scoped first: `bun run test src/lib/item-schema.test.ts` (add `-t "<name>"` for one test), then `bun run test`. Vitest runs on Node: never `bun test`, never `--bun`.

## Playwright

- `bun run e2e` builds, starts the production server on `PORT_E2E` and runs Chromium. Each spec starts from a page load; don't rely on order between specs.
- The production server keeps in-memory state for the whole run. Assert on items a test created itself (a unique name per test), not on the total count.
- On failure, read `test-results/<test>/error-context.md` first, then the trace (`bunx playwright show-trace`). Server errors appear in the `next start` output Playwright prints.

## Discipline

- A bug fix starts with a test that fails for the bug's reason.
- A validation test proves the check bites: submit input that must be rejected and assert the field error and that nothing was added.
- Wait on conditions (`expect(...).toBeVisible()`, `vi.waitFor`), never on sleeps.
- Weakening an assertion, adding `.skip` or loosening a limit to get green is a failure, not a fix.
