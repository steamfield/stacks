---
schema_version: 1
id: python-react
kind: stack
name: Python API + React SPA
description: FastAPI backend (uv, ruff, mypy strict, pytest) plus a React single-page app (Vite, React Router in SPA mode, TanStack Query, Tailwind, shadcn/ui) that talks to the API through a typed client generated from its OpenAPI spec.
tags: [python, typescript, react, web, api, fullstack, monorepo, make, bun, node]
deps:
  backend: [fastapi, uvicorn, pydantic, pydantic-settings, structlog]
  backend-dev: [ruff, mypy, pytest, pytest-asyncio, pytest-xdist, pytest-cov, pytest-randomly, httpx]
  frontend: [react, react-dom, react-router, "@tanstack/react-query", zod, tailwindcss, "@tailwindcss/vite", class-variance-authority, lucide-react]
  frontend-dev: ["@react-router/dev", vite, "@vitejs/plugin-react", typescript, "@biomejs/biome", vitest, "@vitest/coverage-v8", happy-dom, "@testing-library/react", "@testing-library/jest-dom", "@testing-library/user-event", msw, "@faker-js/faker", orval, "@playwright/test"]
tools: [uv, bun, make, git, jq]
merge: [.claude/settings.json]
decisions:
  - "Python version: the newest stable CPython that FastAPI, ruff, and mypy support (default). Setup writes it to .python-version and requires-python."
  - "Frontend package manager: bun (default), or npm/pnpm; swap every command consistently."
  - "Database: none (default); add --with postgres for Postgres + SQLAlchemy + Alembic."
  - "Auth: none (default); leave a current-user dependency as the seam."
  - "Production SPA serving: static host on the API's origin behind a reverse proxy (default), or FastAPI serving the build."
  - "Commit the generated API client and openapi.json (default: yes)."
env:
  PORT_API: "8000"
  PORT_WEB: "5173"
fragments:
  default: [agent-ops, git-hooks, ci-github, posthog]
  optional: [postgres, docker-deploy, rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: typecheck, layer: typecheck, run: make typecheck }
  - { name: test, layer: test, run: make test }
  - { name: home-route-test, layer: test, run: cd frontend && bun run test app/routes/home.test.tsx }
  - { name: api-contract, layer: check, run: make check-api }
  - { name: build, layer: build, run: make build }
  - { name: e2e, layer: test, run: make e2e }
  - name: api
    phase: serve
    layer: serve
    run: make dev-api
    expect: { http: "http://localhost:${PORT_API}/health", within: 90s }
  - name: web
    phase: serve
    layer: serve
    run: make dev-web
    expect: { http: "http://localhost:${PORT_WEB}/", within: 90s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Install backend and frontend dependencies
  lint: Lint and format-check both halves
  format: Auto-format and auto-fix both halves
  typecheck: mypy strict + tsc
  test: Backend and frontend tests
  coverage: Tests with coverage thresholds enforced
  build: Production frontend build
  dev: Run API and web dev servers together
  dev-api: API dev server with reload on PORT_API
  dev-web: Web dev server on PORT_WEB (proxies /api to PORT_API)
  backend-install: uv sync (--locked when CI is set)
  backend-lint: ruff check + ruff format --check
  backend-format: ruff format + ruff check --fix
  backend-typecheck: mypy strict
  backend-test: pytest (parallel)
  backend-coverage: pytest with the coverage floor
  frontend-install: bun install (frozen lockfile when CI is set)
  frontend-lint: Biome lint and format check
  frontend-format: Biome formatting and safe fixes
  frontend-typecheck: React Router typegen + tsc
  frontend-test: vitest run
  frontend-coverage: vitest with coverage thresholds
  frontend-build: Static SPA build into frontend/build/client
  generate-api: Dump OpenAPI from the backend and regenerate the typed client
  check-api: Fail if frontend/openapi.json no longer matches the backend's spec (run generate-api)
  e2e: Playwright end-to-end tests (installs the browser on first run)
  clean: Remove caches and build output
---

## What stacks wrote

`backend/` contains the FastAPI app factory, settings, request logging, error handlers, health route, in-memory notes payload and tests reused from the Python API slice. `frontend/` contains a React Router SPA, a QueryClient provider, the health screen, its MSW tests, a typed fetch boundary validated with generated zod schemas, and Playwright tests against both real servers. The Makefile, tool configs and reference docs are shipped too; read the code before extending it.

## Layout

Add routers under `backend/app/api/` and mount them in `app/routers.py`. Keep business logic in `app/services/` and wire models in `app/schemas.py`. Feature components belong in `frontend/app/components/<feature>/`; owned shadcn-style primitives live in `components/ui/`. See `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT.md`.

## Setup

1. No project generator. In `backend/`, select the newest stable CPython supported by the declared packages with `uv python pin`, set matching `requires-python` in the shipped `pyproject.toml`, then `uv add` every backend dependency and `uv add --dev` every backend-dev dependency from deps. In `frontend/`, `bun add` every frontend dependency and `bun add --dev` every frontend-dev dependency. Install required peers too, including React's types, Node's types and Testing Library's DOM peer if the package manager leaves them out.
2. Run `make generate-api`: this writes `frontend/openapi.json`, orval's client/hooks/MSW handlers and zod schemas in `frontend/app/api/generated/`. These outputs depend on installed releases and are intentionally generated during Setup. Commit them with both lockfiles.
3. Apply the selected fragments, including their edits to shipped entry points, then run `make install lint typecheck test build e2e check-api coverage`. Update shipped code or config the installed releases reject without dropping a rule, reducing coverage or weakening a check. The home test must use the real query provider and fetch boundary; Playwright must call the real backend.
4. Record Python in `backend/.python-version` and `requires-python`, Bun in `frontend/package.json`'s `packageManager`, and Node in `.node-version`. Set ruff's target to that Python version. Copy `.env.example` to `.env` only when changing defaults.
5. Fill the README's `stacks:fill` marker, then `stacks verify` until green. Fill the agent-ops instructions from the project as built.

## Conventions

- `backend/app/main.py` owns startup and lifespan resources. Keep imports free of network connections and file writes. `Settings` reads the root `.env` even when commands run in `backend/`; env overrides it.
- Routers use `ApiModel` and a `response_model`. Python uses snake_case, wire fields use camelCase. Keep stable tag/function operation ids; renaming a route function renames its client.
- Raise `AppError` through the error table. `app/error_handlers.py` owns the public code/message/details/requestId envelope and the same OpenAPI response model for 404, 422 and 500. Never expose exception text or request bodies. Extend the HTTP tests with each new failure.
- `app/middleware.py` validates or generates request ids, echoes them and logs one sanitized request record with the route pattern. `/health` stays dependency-free. The notes store is ephemeral; accounts and persistence remain application work.
- React Router stays in SPA mode, with no server loaders or actions. `app/lib/api.ts` owns transport/errors and the public `VITE_API_BASE_URL`; `app/lib/health.ts` demonstrates decoding generated results before UI use. Use generated query keys for invalidation.
- The Vite config reads the root env and proxies `/api` and `/health` to PORT_API. A separate API origin must explicitly allow the web origin in CORS settings.
- Generated files are read-only; run `make generate-api` after backend changes. Biome skips their lint and import sorting; orval's post-generation hook formats them. `make check-api` compares the committed spec as parsed JSON with a fresh backend dump, without rewriting it.
- Keep the configured lint rules, strict mypy/TypeScript and coverage floors when adapting releases. `frontend/biome.json` preserves React and accessibility checks, type imports/exports, const enforcement and organized imports. It excludes build and test output, `.stacks/`, `.claude/` and the Python-formatted spec; generated TypeScript stays format-checked.
- Extend the owned UI primitives in place, use theme tokens and cva variants, and give interactive elements accessible names. Adding a shadcn component may require its current utility dependencies; keep the `~` aliases from tsconfig.

## Testing

Backend service and config tests sit next to code; `backend/tests/test_http.py` exercises the real ASGI app with httpx inside its native lifespan context. It checks notes, error bodies, request ids, logs and OpenAPI. Mock external boundaries, never your own modules.

Frontend tests render the real home route with a fresh QueryClient and generated MSW handlers. `tests/setup.ts` rejects unhandled requests and resets handlers between tests. Add success, failure and malformed-response cases with each client boundary. Cross-origin handlers need CORS headers and OPTIONS if the test DOM preflights. Playwright owns two servers on separate test ports and shuts them down; never reuse a user's server. `make coverage` enforces both halves' floors.

## Commands

`make help` lists combined install, lint, format, typecheck, test, coverage, build, dev, e2e, generate-api, check-api and clean targets, plus the backend/frontend sub-targets. Mirror those and a single-test command in AGENTS.md. `frontend/package.json` owns the frontend scripts.
<!-- stacks:when with=git-hooks -->

The install target already guards lefthook on its config's existence and skips it in CI. Staged frontend lint uses `biome check --no-errors-on-unmatched`; run it from `frontend/` so it reads that config.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->

CI has filtered backend/frontend jobs. Backend runs `make backend-install backend-lint backend-typecheck backend-coverage`; frontend sets up both runtimes, then `make backend-install frontend-install frontend-lint frontend-typecheck frontend-coverage frontend-build check-api`. A required Playwright job runs `make e2e`. Bun setup reads `frontend/package.json`'s packageManager; Python setup reads `backend/.python-version`. Generated-code CI regenerates and checks the diff.
<!-- stacks:end -->
<!-- stacks:when with=postgres -->

Replace the shipped MemoryNotes behind NoteStore with a SQLAlchemy store created in the lifespan and a notes migration. Keep the HTTP contract, test it on the fragment's private per-file database, and keep `/health` DB-free.
<!-- stacks:end -->

## Gotchas

- Bare `vitest` watches in a TTY; scripts use `vitest run`.
- React Router typegen must precede tsc; `.react-router/` is generated.
- Ruff TC can move annotations FastAPI evaluates at runtime. Keep runtime-evaluated bases and API/test exceptions; dependencies elsewhere need the same care.
- If orval fails under Bun with `Cannot find module 'ajv/dist/core'`, install the current ajv as a frontend dev dependency and record it under Build workarounds.
- Keep fetch clients returning the success body rather than an HTTP wrapper; confirm the installed orval's options in `orval.config.ts` before adapting them.
- Warnings are errors in pytest. Fix deprecations or document targeted ignores; keep the rule. Ruff sometimes renames rule prefixes.
- A static SPA host must fall back to `index.html` for deep links.
