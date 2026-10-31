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
route error page. Its HTML reporter never opens a browser automatically.

When adding hooks and CI from fragments, keep their files outside this slice's
source. Run frontend tooling from `frontend/` and backend tooling from `backend/`.
For staged frontend lint use `biome check --no-errors-on-unmatched`; generated
clients skip lint and import sorting, and orval's `biome format --write` hook
formats them. `biome.json` excludes build and test output, `.stacks/`, `.claude/`
and the Python-formatted OpenAPI spec. Keep its React and accessibility rules.
