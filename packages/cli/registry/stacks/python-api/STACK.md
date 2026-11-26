---
schema_version: 1
id: python-api
kind: stack
name: FastAPI service (Python API)
description: A Python JSON API on FastAPI and Uvicorn with no frontend, managed with uv and make. pytest runs the real app in process, structlog request logs carry ids, errors share one envelope, and verify fails when the committed OpenAPI spec drifts.
tags: [python, api, make]
deps:
  runtime: [fastapi, uvicorn, pydantic, pydantic-settings, structlog]
  dev: [ruff, mypy, pytest, pytest-asyncio, pytest-xdist, pytest-cov, pytest-randomly, httpx, asgi-lifespan, pip-audit]
tools: [uv, make, git, bash, curl]
merge: [.claude/settings.json]
decisions:
  - "Python version: the newest stable CPython that FastAPI, ruff, and mypy support (default). Setup writes it to .python-version and requires-python."
  - "Packaging: an unpackaged application with no build backend, deployed as source (default). If the service must ship as a wheel, add a build backend, a build target that builds and installs the wheel, and a verify step for it."
  - "Resource path prefix: /v1 (default), with /healthz and the OpenAPI document outside it."
  - "Database: the postgres fragment when it was selected, otherwise none (default; the example resource is in memory, and `stacks add postgres` adds Postgres + SQLAlchemy + Alembic later)."
  - "Auth: none (default); add a current-user dependency when authentication is needed."
  - "CORS: off (default); add it from settings only when a browser on another origin calls the API."
env:
  PORT_API: "8000"
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [postgres, docker-deploy, rest-api, rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: typecheck, layer: typecheck, run: make typecheck }
  - { name: test, layer: test, run: make coverage }
  - { name: openapi-drift, layer: check, run: make check-openapi }
  - name: dev-cycle
    layer: check
    timeout: 3m
    run: "if bash scripts/dev-bg.sh status >/dev/null; then echo 'A dev server is running; stop it first: make dev-stop' >&2; exit 1; fi; make dev-bg && make dev-stop"
  - name: api
    phase: serve
    layer: serve
    run: make start
    expect: { http: "http://127.0.0.1:${PORT_API}/healthz", within: 60s }
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: uv sync (--locked when CI is set), then install configured hooks outside CI
  lint: ruff check + ruff format --check
  format: ruff format + ruff check --fix
  typecheck: mypy strict over app, tests and scripts
  test: pytest (parallel)
  coverage: pytest with the coverage floor
  ci: lint, typecheck, coverage and check-openapi, as CI runs them
  audit: pip-audit over the locked dependencies (needs the network)
  dev: Uvicorn with reload on PORT_API
  dev-bg: make dev in the background, logging to logs/dev.log; reuses the server it started and refuses a port another server answers
  dev-stop: Stop the process group dev-bg recorded in logs/dev.pid
  dev-status: Exit 0 when the server dev-bg started is running, else 1
  start: Uvicorn without reload on PORT_API, as production runs it
  openapi: Write the app's OpenAPI spec to openapi.json
  check-openapi: Fail if openapi.json no longer matches the app's spec (run make openapi)
  clean: Remove caches and coverage output
---

# FastAPI service (Python API)

## What stacks wrote

A FastAPI app factory with validated settings, a lifespan that owns an in-memory notes store, an error table and its handlers, request-id and logging middleware, wire schemas and `/healthz`. Create, read and cursor-paginated list routes under `/v1/notes` exercise those boundaries. Unit tests sit beside config and the store; `tests/` calls the real ASGI app. The Makefile, pyproject tool config, OpenAPI dumper, background dev-server script (`scripts/dev-bg.sh`) and `docs/` (architecture, HTTP contract, development) ship too; read the code before extending it.

## Setup

1. No generator. Pin the chosen Python with `uv python pin`, which writes the `.python-version` CI reads, and set `project.requires-python` to match; ruff takes its target version from it. Then `uv add` every runtime dependency, writing the install line's `uvicorn` as `uvicorn[standard]`, and `uv add --dev` every dev dependency.
2. `make format` (a newer ruff can rewrite syntax), then `make install lint typecheck coverage`. Update shipped code or config the installed release rejects, keeping every rule, strict typing, test and the coverage floor. Don't replace the shipped rule sets with generated defaults.
3. `make openapi` and commit `openapi.json`. It's generated here because it embeds FastAPI's OpenAPI version.
4. Record the Python and uv versions in AGENTS.md, fill README's `stacks:fill` marker, then run `stacks verify` until green.

## Conventions

- Mount routers only in `app/main.py::create_app`; new ones go in `app/api/`. Imports do no I/O, and the lifespan owns resources. Services in `app/services/` don't import FastAPI.
- A new setting gets a validated default in `app/config.py::Settings`, a test and an `.env.example` entry; secrets use `SecretStr`. Tests pass explicit Settings.
- Wire models live in `app/schemas.py` on the camelCase `ApiModel` base, with one response shape per resource. Routes stay thin. Stores implement the async `NoteStore` seam; a database adapter maps dependency failures to `ServiceUnavailable` with the cause chained.
- Raise `AppError` subclasses, never `HTTPException`; the error table owns messages, statuses and retryability. Unexpected exceptions become generic 500s, logged by class and frames, never messages or locals.
- Logs never carry bodies or query values. Uvicorn's access log stays off so the middleware writes the one request record.
- Every resource route sets `operation_id` in camelCase verb-noun form (`listNotes`, `getNote`, `createNote`). Generated clients name their functions after it, so never change an existing one. Health routes keep the factory's `<tag>_<function>` fallback. Keep the `no-store` default and existing cache policies.
- After changing a route or schema, run `make openapi` and commit `openapi.json` with the change.

## Testing

Extend `tests/test_http.py` with each new endpoint's success, validation and error cases. For a dependency-down case, override the store dependency, never the route or middleware. Run one test with `uv run pytest tests/test_http.py::test_health`, and set `TEST_WORKERS=2` on a shared machine.

## Commands

Run the API with `make dev-bg` and stop it with `make dev-stop`. Don't `kill` or `pkill` Uvicorn: the reload supervisor and its worker are separate processes, and stopping one leaves the other holding the port. A foreground `make dev` isn't recorded, so dev-bg refuses while it holds the port. Stop the background server before `stacks verify`: its dev-cycle step fails while `make dev-status` finds one, and the serve step needs the port.

<!-- stacks:when with=git-hooks -->
If `make install` already runs `lefthook install`, don't add another install step. pre-commit formats staged Python with ruff and re-stages fixes, then lints; pre-push runs `make test`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->
CI uses uv's setup action (cache on, Python read from `.python-version`), then `make install ci` with CI set, then `make audit` as its own step: the audit needs the network, so it stays out of `ci`.
<!-- stacks:end -->
<!-- stacks:when with=postgres -->
The postgres fragment ships SqlNotes (the NoteStore on Postgres), the notes migration and readiness at `/readyz`; the lifespan uses SqlNotes when a database URL is configured and MemoryNotes otherwise, so the Docker-free suite is unchanged. The 503 test still overrides get_note_store. `/healthz` stays DB-free. The CI job with the Postgres service runs `make install ci`, then the fragment's `make db-migrate db-check test-db`.
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
