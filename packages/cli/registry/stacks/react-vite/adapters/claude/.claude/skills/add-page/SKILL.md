---
name: add-page
description: Add a page to this React SPA that reads from the external API, with its route, query, fake-API handler and tests. Use when asked for a new screen, route or view backed by an API endpoint.
---

# Add a page

Follow the items slice; `src/api/items.ts`, `src/features/items/` and `src/app/routes.test.tsx` are the model.

1. **Schema and query.** In `src/api/<thing>.ts`, a zod schema for the response and a `queryOptions` factory taking the `ApiClient` (`queryKey` starting with the resource name, `queryFn` calling `api.get(path, Schema, { signal })`). Encode path parameters with `encodeURIComponent`.
2. **Fixture and handler.** Sample data in `tests/fixtures/<thing>.ts`; a default MSW handler for the endpoint in `tests/msw/server.ts`.
3. **Failing test.** In `src/app/routes.test.tsx` (or a new `*.test.tsx` beside the page), render the route with `renderRoute(path)` and assert what the user sees: the data, the empty state, an HTTP error with its request id, a wrong-shaped body. Run it and watch it fail.
4. **Page.** `src/features/<name>/<name>-page.tsx`: `const { api } = useServices()`, `useQuery(...)`, and a branch for pending, error (`<ErrorState error onRetry />`), empty and success. Headings and links carry accessible names the test queries by.
5. **Route.** Add it to the children in `src/app/routes.tsx`, and link to it with `<Link>`.
6. **Browser test**, only if the page depends on something happy-dom can't show (a deep link, the built bundle): extend `fakeApi` in `e2e/items.spec.ts` or add a spec beside it.
7. `bun run check`, then `stacks verify`.

Don't call `fetch`, read `import.meta.env` or use `console` in the page; `bun run lint` rejects each.
