# Development

Resolve the dependencies listed in the brief before `make install`. The shipped
manifests contain tool configuration and scripts, with no dependency versions.
There is no generator step for either application. `make generate-api` runs the
backend OpenAPI dump as a module from `backend/`, then orval from `frontend/`.

```sh
make generate-api
make install lint typecheck test build e2e check-api coverage
make dev
```

The API listens on PORT_API; Vite listens on PORT_WEB and proxies `/api` and
`/health`. Both default to loopback. Vite reads the root `.env`; VITE_ values
are public and compiled into the browser bundle. Python reads the same file.
For another API origin, set VITE_API_BASE_URL and CORS_ORIGINS together.

Run a single test with `cd backend && uv run pytest tests/test_http.py` or
`cd frontend && bun run test app/routes/home.test.tsx`. Backend tests enter the
real app lifespan, so resources exist and are disposed. Frontend tests use MSW at
the HTTP boundary, with generated handlers and fresh query caches. The suite
checks failure display, retry, and invalid successful responses.

Playwright starts its own API on 18000 and web server on 15173. It refuses occupied
ports and always owns their shutdown. It exercises a real API round trip and the
route error page. Its HTML reporter never opens a browser automatically. Spec files
run in parallel workers against those two servers, so a spec must not depend on data
another spec creates. `vite.config.ts` pre-bundles the dependencies of `app/root.tsx`
and every module under `app/routes/` at startup; a route module elsewhere loads its
dependencies late, and Vite's reload then breaks pages that other workers have open.

A passing run still prints some error-looking output, all from tests of error paths:
happy-dom logs `GET http://localhost:3000/health 503 (Service Unavailable)` and 502
lines for Vitest's failure cases, and the e2e web server logs
`Error: No route matches URL "/missing"` with a stack trace for the error-page test.

When adding hooks and CI from fragments, keep their files outside this slice's
source. Run frontend tooling from `frontend/` and backend tooling from `backend/`.
For staged frontend lint use `biome check --no-errors-on-unmatched`; generated
clients skip lint and import sorting, and orval's `biome format --write` hook
formats them. `biome.json` excludes build and test output, `.stacks/`, `.claude/`
and the Python-formatted OpenAPI spec. Keep its React and accessibility rules.

## Adding a resource

Notes is the example resource to copy on the backend:

- Router: `backend/app/api/notes.py`, mounted in `app/routers.py`. Its `JsonRoute`
  class answers 415 to a request body that isn't JSON; import it from
  `app.api.notes` for other routers that accept JSON.
- Logic: `backend/app/services/notes.py`, with `test_notes.py` beside it.
- Wire models: `backend/app/schemas.py`. Each class name becomes an OpenAPI schema
  name and a generated TypeScript type, global across the app. The shared models
  are `ApiModel`, the base class, and `EmptyQuery`, the query model for routes that
  take no parameters. Give a resource's own models its name (`ProjectInput`,
  `ProjectPage`, `ProjectListQuery`). `Page` and `ListQuery` belong to Notes even
  though their names carry no prefix: `Page` holds `Note` items, and `ListQuery`
  caps `limit` at Notes' page size.
- HTTP tests: a new `backend/tests/test_<resource>.py` on the fixtures in
  `tests/conftest.py`, or more cases in `test_http.py`.

Then run `make generate-api`. On the frontend, the health screen is the example:
`app/routes/home.tsx` reads `app/lib/health.ts`, which validates the generated
hook's result. Add a route module under `app/routes/`, register it in
`app/routes.ts` with `route("<path>", "routes/<name>.tsx")`, put its components in
`app/components/<feature>/`, and test it beside the module (`<name>.test.tsx`).
End-to-end specs go in `frontend/tests/e2e/`.
