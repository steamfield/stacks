# The app

This is a browser-only app. Everything in `src/` ships to the user as JavaScript, and there is no server of its own to hide anything behind.

## Boundaries

`biome-plugins/boundaries.grit` enforces the first three; `bun run lint` reports a break.

- **Network**: only `src/api/` calls `fetch`. A new endpoint is a zod schema and a `queryOptions` factory beside `src/api/items.ts`, calling `api.get(path, schema)`. Pages never see a raw `Response`.
- **Config**: only `src/config.ts` reads `import.meta.env`. A new setting gets a schema field with a default, a line in `.env.example`, a test in `src/config.test.ts` and a README row. `main.tsx` passes the parsed config down; components don't read it.
- **Logging**: only `src/logging.ts` touches `console`. Components get the logger from `useServices()`. Records carry an event name and flat fields: path, status, request id, counts. Never a request or response body, a token or what the user typed.
- **Secrets**: none. Vite inlines every `VITE_*` value into the bundle, so an API key there is public. Calls that need a secret go through a backend the app talks to.

## Errors

Every failed call rejects with `ApiError` (`src/api/errors.ts`), whose `kind` is `http`, `network` or `decode`. `userMessage` turns one into the sentence the UI shows, and `isRetryable` decides what TanStack Query retries (network failures and 408, 429, 502, 503, 504, twice). A new status gets a case in those two functions and a test row; pages never branch on statuses. `ErrorState` shows the message, the request id from the `x-request-id` header and a retry button.

A page handles its own loading, empty and error states from the query result. `RouteError` covers what a page can't: an unmatched URL (404) and an error thrown while rendering. It logs the error's name, never its message.

## Routes and pages

`src/app/routes.tsx` lists every route as data-router objects (`Component`, `ErrorBoundary`, `children`). A new page goes in `src/features/<name>/`, gets a route entry, and reads data with `useQuery(xQuery(api, ...))`. Use `<Link>` and `useNavigate`, never `window.location`, so navigation stays client-side.

Server rendering, file-based routes and `@react-router/dev` belong to a different kind of project. Keep this one a static build that any file host can serve.

## Deploying

`bun run build` writes `dist/`. The host must answer unknown paths with `index.html` (a SPA fallback or rewrite), or a reload on `/items/1` returns the host's 404. `vite preview` does this, which is why the browser test's reload passes locally; configure the production host to match.
