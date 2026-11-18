---
paths:
  - "backend/tests/**"
  - "frontend/tests/**"
  - "frontend/app/**/*.test.{ts,tsx}"
---

# Testing conventions

- Build backend tests on `backend/tests/conftest.py`, using the real app factory and lifespan. Test services directly; mock external boundaries, not your own code.
- Build frontend tests on `frontend/tests/render.tsx` (a fresh QueryClient with retries off) and `frontend/tests/mocks/server.ts`.
- Use generated MSW handlers by default, with inline overrides for error and empty states. Fail on unhandled requests and reset handlers per test.
- Cross-origin handlers, including tests of `VITE_API_BASE_URL`, need CORS headers; answer `OPTIONS` if the test DOM preflights.
- Put backend service tests beside the service (`app/services/test_<name>.py`) and HTTP tests in `backend/tests/test_<resource>.py`. Frontend unit tests sit beside the code as `*.test.ts(x)`; Playwright specs go in `frontend/tests/e2e/`.
- Playwright runs spec files in parallel workers against one Vite server. Keep each spec independent of the others' data, and keep route modules under `app/routes/` so Vite pre-bundles their dependencies before the first page loads.
- `make test` runs backend and frontend tests. `make e2e` runs Playwright separately; coverage thresholds belong to `make coverage`.
- Expected output on a passing run: happy-dom prints `GET … 503 (Service Unavailable)` style lines for the error-path tests, and the e2e web server logs `No route matches URL "/missing"` with a stack trace for the error-page test. Any other warning or error is a real problem.

See the project's `AGENTS.md` for commands and the remaining conventions.
