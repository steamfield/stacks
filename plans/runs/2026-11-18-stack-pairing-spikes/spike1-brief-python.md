# Python API with a React SPA (workspace)

## What stacks wrote

Two parts in one repository: `backend/` is the FastAPI service from the `python-api` stack and `frontend/` is the React SPA from the `react-vite` stack, each with its own Makefile or `package.json`, tests and configs. The root holds what belongs to both: a Makefile that delegates to each part, the README, `.env.example`, `lefthook.yml`, the CI workflow and `docs/CONTRACT.md`. The `openapi-client` link adds a generated client to `frontend/`. Nothing at the root is application code.

## How the parts connect

- Request path: the browser calls `/api/<path>` on the frontend's own origin. In development and preview, Vite's proxy forwards `/api/<path>` to `http://localhost:${PORT_API}/v1/<path>`. The frontend's base URL is the same-origin path `/api`; no host is written into frontend source.
- The backend owns the contract. `backend/openapi.json` is its OpenAPI document, kept current by `make openapi` in `backend/` and checked by `make check-openapi`. The root `make api-client` copies it to `frontend/openapi.json` and regenerates the client; the frontend never edits either file by hand.
- What crosses the boundary: the `notes` resource (create, read, cursor-paginated list), the backend's error envelope, and the `X-Request-ID` header, which the frontend reads from every response and logs.
- Ports: `PORT_API` (the backend) and `PORT_WEB` (the frontend's preview and dev server) are both in the root `.env.example`. The frontend's Vite config reads `PORT_API` to find the backend.

## Setup

1. Read the two part sections below for each part's own setup; do their steps 1 and 2 (dependencies, then each part's own lint, typecheck and tests), in `backend/` first, then `frontend/`. Skip each part's "fill the README, then `stacks verify`" step: this Setup governs.
2. Add the link's dependencies in `frontend/` (the link section names them).
3. From the root, `make api-client`. This is where `frontend/openapi.json` and the generated client in `frontend/src/api/generated/` are first produced. Commit them.
4. From the root, `make check`: both parts' lint, typecheck and tests, the backend's OpenAPI drift check, the client drift check, then `make smoke`, which starts both parts and sends one request through the frontend's proxy to the backend.
5. Fill the root README, `docs/CONTRACT.md` and both parts' READMEs (`stacks:fill` markers). Record the root commands and the "Changing the API" workflow below in the root `AGENTS.md`.
6. `stacks verify` until green.

## Changing the API

1. Change the route and its schema in `backend/` and extend `backend/tests/test_http.py`.
2. From the root, `make api-client` (rewrites `backend/openapi.json`, `frontend/openapi.json` and the generated client).
3. Update the frontend: use the generated hook in the page, add an MSW handler and fixture, and tests for success, empty and error.
4. From the root, `make check`.

Operation ids come from the backend's route function names; renaming a route function renames its generated hook.

## Commands

The root Makefile delegates and holds no logic of its own beyond the cross-part targets:

- `make install`, `make lint`, `make typecheck`, `make test`: run in `backend/` (`make <target>`) then `frontend/` (`bun run <target>`).
- `make api-client`: backend `make openapi`, copy to `frontend/openapi.json`, then `bun run generate:api` in `frontend/`.
- `make check-api-client`: backend `make check-openapi`, `frontend/openapi.json` equals `backend/openapi.json`, and the frontend's `check:api`.
- `make smoke`: start both parts, one request through the proxy, stop both.
- `make check`: all of the above but install.
- `make dev`: both dev servers.

## Testing

Each part's tests run alone and need no other part running: the frontend's tests answer the API with MSW. `make smoke` is the one test that needs both parts running.

<!-- stacks:when with=git-hooks -->
`lefthook.yml` is at the root. Its pre-commit runs each part's staged-file formatting from that part's directory; pre-push runs `make test`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->
CI is one workflow at the root with a job per part plus a job that runs `make check-api-client` and `make smoke`.
<!-- stacks:end -->

---

> This section is the `python-api` part. It lives in `backend/`. Paths and commands in this section are relative to `backend/` and run there. Where it says to fill the README and run `stacks verify`, or names `README.md`, `.env.example`, git hooks or CI, the workspace section above governs: the root has its own copies.

# FastAPI service (Python API)

## What stacks wrote

A working FastAPI app factory, validated settings, lifespan-owned in-memory notes store, error table and handlers, request-id and logging middleware, wire schemas, and `/healthz`. Create, read and cursor-paginated list routes under `/v1/notes` exercise the boundaries. Unit tests sit beside config and the store; `tests/` calls the real ASGI app with lifespan management. The Makefile, pyproject tool configuration, OpenAPI dumper, env example and reference docs ship too; read the code before extending it.

## Setup

1. No generator. Use the shipped `pyproject.toml`. Pin the chosen Python with `uv python pin`, set `project.requires-python` and ruff's target-version to match it, then `uv add` every runtime dependency (Uvicorn with its standard extra) and `uv add --dev` every dev dependency, resolving current releases.
2. `make format` (a newer target can rewrite syntax), then `make install lint typecheck coverage`. Update shipped code or config the installed release rejects, keeping every linter, strict type checking, test and coverage floor. Do not replace the shipped rule sets with generated defaults.
3. Record Python and uv versions in AGENTS.md.
4. `make openapi`, then commit `openapi.json` with future route changes. Setup generates it because it embeds FastAPI's OpenAPI version. `make check-openapi` compares parsed JSON, not formatting.
5. Fill README's `stacks:fill` marker and the selected fragments' agent guidance. Run `stacks verify` until green.

## Layout and conventions

`docs/ARCHITECTURE.md` maps the boundaries, `docs/http-api.md` describes the HTTP contract, and `docs/DEVELOPMENT.md` covers setup and commands.

- `app/main.py::create_app` wires routers, handlers and middleware. The lifespan validates settings, configures structlog once at startup and owns resources. Imports do no I/O. New routers go in `app/api/`; mount them only in the factory. Services go in `app/services/` and do not import FastAPI.
- Env settings live in `app/config.py::Settings`. Add validated defaults, tests and `.env.example` entries for new settings; secrets use `SecretStr`. `.env` allows extra Make and Compose keys. Tests pass explicit Settings; `get_settings` caches process settings.
- Keep wire models in `app/schemas.py`, camelCase aliases, one resource shape for create/read/list, and thin routes. Stores implement the async `NoteStore` seam; a database adapter maps dependency failures to `ServiceUnavailable` with the original cause chained.
- Raise `AppError` values. The error table owns fixed safe messages, statuses and retryability. Framework validation, unknown paths and wrong methods use the same envelope; unexpected exceptions and response-encoding failures are generic 500s, logged once by class and frames without messages or locals.
- Use the request middleware on every route. It validates or generates ids, returns `X-Request-ID`, binds log context, logs route patterns without bodies/query values, and restores context afterwards. Uvicorn's access log stays off. Production logs are JSON on stdout; development logs are readable. Health requests log at debug.
- New endpoints declare models and summaries. Preserve stable `<tag>_<function>` operation ids, no-store defaults, existing cache policies and 304s. Regenerate OpenAPI after changing routes or schemas.

## Testing

`make test` runs pytest with xdist and random ordering; `make coverage` also enforces an 80% branch-aware floor and is the verify test step. Config and service tests live beside their code. `tests/conftest.py` enters the lifespan through asgi-lifespan, then uses httpx's ASGI transport. Extend `tests/test_http.py` for each new endpoint's success, validation and error cases. Override the store dependency for a dependency-down case, never the route or middleware. Keep strict warnings and markers.

## Commands

The shipped Makefile (`make help`) holds every declared target. Mirror them and a single-file command (`uv run pytest tests/test_http.py`) in AGENTS.md. `TEST_WORKERS` defaults to auto; reduce it on shared machines without changing test behavior.

<!-- stacks:when with=git-hooks -->
If `make install` already runs `lefthook install`, don't add another install step. pre-commit formats staged Python with ruff and re-stages fixes, then lints; pre-push runs `make test`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->
CI uses uv's setup action (cache on, Python read from .python-version), then `make install lint typecheck coverage check-openapi` with CI set.
<!-- stacks:end -->
<!-- stacks:when with=postgres -->
The postgres fragment ships SqlNotes (the NoteStore on Postgres), the notes migration and readiness at `/readyz`; the lifespan uses SqlNotes when a database URL is configured and MemoryNotes otherwise, so the Docker-free suite is unchanged. The 503 test still overrides get_note_store. `/healthz` stays DB-free.
<!-- stacks:end -->
<!-- stacks:when with=rest-api -->
The notes slice already follows the REST rule. Record /v1, the tag/message/retryable envelope, cursor limits (20 default, 100 maximum), 400 validation and 405 with Allow in AGENTS.md. Keep those contracts when adding resources.
<!-- stacks:end -->
<!-- stacks:when with=docker-deploy -->
If the root `Dockerfile` runs uvicorn directly, it binds 0.0.0.0:8000 and its healthcheck fetches `/healthz`; keep `/healthz` free of dependencies so the container stays healthy without a database.
<!-- stacks:end -->

## Gotchas

- Ruff's TC rules can move annotations FastAPI or pydantic needs at runtime. Keep the configured runtime-evaluated base classes and API/test exceptions; dependencies outside the API directory need the same care.
- httpx's ASGITransport does not run the lifespan. Keep LifespanManager and test 500s with raise_app_exceptions disabled: Starlette can re-raise after sending a response.
- Middleware inside Starlette's outer error handler misses the final 500. The shipped middleware handles unexpected exceptions before headers are sent so ids, logs and cache policy survive. Errors after headers must propagate.
- Warnings are errors. Fix deprecations or add a narrowly documented ignore; keep the rule. Ruff can rename rule prefixes between releases.
- `make start` binds 127.0.0.1. A remote host needs API_HOST=0.0.0.0. PORT_API belongs to Make; Settings reads only application settings.

---

> This section is the `react-vite` part. It lives in `frontend/`. Paths and commands in this section are relative to `frontend/` and run there. Where it says to fill the README and run `stacks verify`, or names `README.md`, `.env.example`, git hooks or CI, the workspace section above governs: the root has its own copies.

# React SPA on Vite

## What stacks wrote

A client-side React app with one payload, an items list and detail page fed by an external API. `src/main.tsx` parses config and mounts the providers; `src/config.ts` validates the `VITE_*` settings with zod; `src/api/` is the only code that calls `fetch`, decoding each response with a zod schema and rejecting with a typed `ApiError`; `src/logging.ts` writes structured console records; `src/app/` holds the routes, layout and error page. Unit and component tests run on Vitest with MSW standing in for the API, and Playwright tests the built site with the API routed in the browser. The configs, package scripts, a Biome boundary plugin and `docs/guidance/react-vite/` ship too. Read the code before extending it.

Link `docs/guidance/react-vite/index.md` from AGENTS.md.

## Layout

- `src/api/`: client, errors, query client, and one module per resource (schema plus `queryOptions`).
- `src/app/`: `routes.tsx` (every route), `layout.tsx`, `route-error.tsx`, `services.tsx` (the API client and logger in context).
- `src/features/<name>/`: pages. `src/components/`: shared UI such as `ErrorState`.
- `tests/`: MSW server, fixtures shared with Playwright, the `renderRoute` helper, and the Grit probes. `e2e/`: Playwright. `biome-plugins/boundaries.grit`: the boundary rules.

## Setup

1. Add every declared app and dev dependency at its current release with `bun add` and `bun add -d`, checking peer ranges. Match `@types/node` to the chosen Node major. No generator is needed; keep the shipped source, tests and configs.
2. Run `bun run lint`, `bun run typecheck`, `bun run test` and `bun run e2e`. Where an installed release rejects shipped code or config (a renamed API, a moved option), update it from that release's docs or declarations, keeping every check, lint rule and assertion. `prepare` installs Chromium after `bun install` outside CI.
3. Record the Node LTS in `.node-version`, Bun in `packageManager`, and the installed versions of Vite, React, React Router and TypeScript in the README.
4. Fill the README's `stacks:fill` markers and AGENTS.md (commands, a single-file test example, the boundaries, the guidance link), then run `stacks verify` until green. If a default port is busy, set free `PORT_WEB` and `PORT_E2E` values in verify's environment.

## Conventions

The shipped code keeps these; new code does too. `docs/guidance/react-vite/app.md` has the detail.

- Only `src/api/` calls `fetch`, only `src/config.ts` reads `import.meta.env`, and only `src/logging.ts` touches `console`. The Grit plugin fails lint on a break, and `tests/boundaries.test.ts` proves each rule fires.
- Nothing secret goes in a `VITE_*` variable: Vite inlines them into the bundle. A call that needs a key goes through a backend.
- Each endpoint is a zod schema and a `queryOptions` factory in `src/api/`. Pages read with `useQuery`, render pending, error, empty and success states, and never see a raw `Response`.
- Failures are `ApiError` with `kind` `http`, `network` or `decode`. `userMessage` and `isRetryable` in `src/api/errors.ts` are the one status table; extend them with a test row.
- Log events with flat fields (path, status, request id), never bodies, tokens or user input.
- Routes are data-router objects in `src/app/routes.tsx`. Stay in data mode: React Router's framework mode (`@react-router/dev`, server rendering, file routes) is a different stack.
- Biome's recommended rules plus the React domain (hook rules, exhaustive dependencies), import types, no non-null assertions and no floating promises. Keep them when adapting the config.

## Testing

Vitest's `app` project runs `src/**/*.test.{ts,tsx}` on happy-dom with MSW, and `node` runs `tests/**/*.test.ts`. Component tests render real routes with `renderRoute(path)` and change one API answer per test with `server.use(...)`; unhandled requests fail. A new endpoint adds a fixture, a default handler and tests for success, empty, an HTTP error with its request id, and a wrong-shaped body.

`bun run e2e` builds, serves `dist/` with `vite preview` on `PORT_E2E`, and runs Chromium with one worker against routed API responses: list to detail, a deep-link reload, the not-found page and a 500 with its request id. Details in `docs/guidance/react-vite/testing.md`.

<!-- stacks:when with=ci-github -->
CI sets up Bun from `packageManager` and Node from `.node-version`, installs frozen dependencies, runs lint, typecheck and coverage, installs Chromium with its system dependencies, then runs e2e. Upload Playwright reports and test results on failure. No credentials are needed.
<!-- stacks:end -->

## Commands

`package.json` wires every declared command; mirror them in AGENTS.md with a scoped example such as `bun run test src/api/client.test.ts`. `preview` serves the last build, so run `build` first. `clean` removes only build, test and coverage output.

<!-- stacks:when with=git-hooks -->
`scripts/prepare.ts` already runs `lefthook install` when `lefthook.yml` exists outside CI, so don't add another installer. pre-commit runs Biome with fixes on staged files; pre-push runs typecheck and tests.
<!-- stacks:end -->

## Gotchas

- A static host must rewrite unknown paths to `index.html`. `vite preview` does, so a deep-link reload passes locally and then 404s on a host left at its defaults. Configure the rewrite where you deploy.
- Vite reads `.env`, `.env.local` and `.env.[mode]` at build time and bakes the values in; changing one needs a rebuild, and `import.meta.env` types come from `vite/client` in `tsconfig.json`.
- A cross-origin API must send CORS headers and `Access-Control-Expose-Headers: x-request-id`, or the browser hides the request id. A refused CORS request reaches the app as a `network` error.
- Run Vite, Vitest and Playwright on Node without `--bun`; use `bun run test` for Vitest.
- `react-router-dom` is folded into `react-router`; import everything, `RouterProvider` included, from `react-router`.
- MSW in Node answers only requests made in Vitest. Playwright routes the API with `page.route`, so no `mockServiceWorker.js` is generated or shipped.
- `msw` prints a warning and fails the test for a request no handler covers; add the handler instead of loosening `onUnhandledFrame`.

---

> This section is the `openapi-client` link. The API part is `backend/`; the client part is `frontend/`. Paths and commands are relative to the part they name.

# OpenAPI client (Orval)

The client part gets a typed client generated from the API part's OpenAPI document with Orval: TanStack Query hooks, zod schemas and MSW handlers. Hand-written calls and generated hooks share one transport: Orval's mutator is the client part's existing fetch function in its API client module.

## Setup

1. In the client part, add `orval` as a dev dependency at its current release.
2. The client part's `openapi.json` is copied from the API part by a workspace command (see the workspace section). Then, in the client part, `bun run generate:api` writes `src/api/generated/`. Confirm the installed Orval's options in `orval.config.ts` before adapting them.

## How it works

- `orval.config.ts` in the client part reads `./openapi.json` beside it and writes `src/api/generated/`. Its mutator is the client part's fetch function, so generated calls get the same base URL, error type and logging as hand-written ones.
- Generated files are read-only. Never edit them; change the API part and regenerate. Lint and formatting skip `src/api/generated/`.
- `bun run check:api` regenerates into the working tree and fails if anything under `src/api/generated/` changed. A failure means the client part's `openapi.json` changed and nobody regenerated, or someone edited generated code.
- Operation names come from the API part's operation ids. A renamed operation renames its hook and breaks every import of the old name at typecheck, which is the point.
- At least one page uses a generated hook, with a test; a generated client that nothing imports passes the drift check and proves nothing.
