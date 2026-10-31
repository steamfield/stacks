---
schema_version: 1
id: python-api
kind: stack
name: FastAPI service (Python API)
description: A Python JSON API on FastAPI and Uvicorn with no frontend, managed with uv and make. pytest runs the real app in process, structlog request logs carry ids, errors share one envelope, and verify fails when the committed OpenAPI spec drifts.
tags: [python, api, make]
deps:
  runtime: [fastapi, uvicorn, pydantic, pydantic-settings, structlog]
  dev: [ruff, mypy, pytest, pytest-asyncio, pytest-xdist, pytest-cov, pytest-randomly, httpx, asgi-lifespan]
tools: [uv, make, git, jq]
merge: [.claude/settings.json]
decisions:
  - "Python version: the newest stable CPython that FastAPI, ruff, and mypy support (default). Setup writes it to .python-version and requires-python."
  - "Packaging: an unpackaged application with no build backend, deployed as source (default). If the service must ship as a wheel, add a build backend, a build target that builds and installs the wheel, and a verify step for it."
  - "Resource path prefix: /v1 (default), with /healthz and the OpenAPI document outside it."
  - "Database: none (default; the example resource is in memory); add --with postgres for Postgres + SQLAlchemy + Alembic."
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
  - name: api
    phase: serve
    layer: serve
    run: make start
    expect: { http: "http://127.0.0.1:${PORT_API}/healthz", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: uv sync (--locked when CI is set), then install configured hooks outside CI
  lint: ruff check + ruff format --check
  format: ruff format + ruff check --fix
  typecheck: mypy strict over app, tests and scripts
  test: pytest (parallel)
  coverage: pytest with the coverage floor
  dev: Uvicorn with reload on PORT_API
  start: Uvicorn without reload on PORT_API, as production runs it
  openapi: Write the app's OpenAPI spec to openapi.json
  check-openapi: Fail if openapi.json no longer matches the app's spec (run make openapi)
  clean: Remove caches and coverage output
---

# FastAPI service (Python API)

## What stacks wrote

A working FastAPI app factory, validated settings, lifespan-owned in-memory notes store, error table and handlers, request-id and logging middleware, wire schemas, and `/healthz`. Create, read and cursor-paginated list routes under `/v1/notes` exercise the boundaries. Unit tests sit beside config and the store; `tests/` calls the real ASGI app with lifespan management. The Makefile, pyproject tool configuration, OpenAPI dumper, env example and reference docs ship too; read the code before extending it.

## Setup

1. No generator. Use the shipped `pyproject.toml`. `uv add` every runtime dependency (Uvicorn with its standard extra), then `uv add --dev` every dev dependency, resolving current releases.
2. `make install lint typecheck coverage`. Update shipped code or config the installed release rejects, keeping every linter, strict type checking, test and coverage floor. Do not replace the shipped rule sets with generated defaults.
3. Record the chosen Python with `uv python pin` and set `project.requires-python` to match it. Set ruff's target-version to that Python. Record Python and uv versions in AGENTS.md.
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
