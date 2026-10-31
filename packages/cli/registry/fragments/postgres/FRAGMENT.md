---
schema_version: 1
id: postgres
kind: fragment
category: service
name: PostgreSQL with SQLAlchemy for Python
description: "PostgreSQL for the FastAPI stacks (python-react, python-api): Docker Compose dev and test services with healthchecks, a SQLAlchemy async notes store, Alembic migrations with a drift check, a readiness route, and tests on a private database per file cloned from a migrated template."
tags: [database, postgres, service]
applies_to: [python-react, python-api]
requires_tools: [docker]
tools: [docker]
deps:
  backend: [sqlalchemy, asyncpg, alembic]
decisions:
  - "Postgres image (default: the official postgres image, current major, alpine variant). Use an image with the extensions the project needs, such as pgvector, when the person asks for them."
  - "Run migrations on app start (default: no). db-migrate is an explicit development and release step."
env:
  PORT_DB: "5432"
  PORT_DB_TEST: "5433"
verify:
  - name: compose-pinned
    phase: setup
    layer: check
    run: "test -s compose.yaml && ! grep -n 'stacks:fill' compose.yaml"
  - { name: db-up, phase: setup, layer: install, run: make db-up }
  - { name: db-migrate, phase: setup, layer: install, run: make db-migrate }
  - { name: test-db, layer: test, run: make test-db }
  - { name: db-check, layer: check, run: make db-check }
  - { name: db-down, phase: teardown, layer: install, run: make db-down }
commands:
  db-up: Start db and db-test and wait until both are healthy
  db-migrate: Apply migrations to DATABASE_URL (in development it defaults to db on PORT_DB)
  db-check: Fail if the models and the migrations disagree (alembic check against a database at head)
  test-db: Database tests, each file on its own database cloned from a migrated template
  db-down: Stop the dev database and keep its data; db-test keeps running
---

# PostgreSQL with SQLAlchemy

## What stacks wrote

`compose.yaml` runs `db` (named volume) and `db-test` (tmpfs), both on `127.0.0.1` with healthchecks. The Python project also has:

- `app/db/`: `models.py` (`Base` with a constraint naming convention, `NoteRow`), `notes.py` (`SqlNotes`, the `NoteStore` on Postgres; a lost database is `ServiceUnavailable`) and `__init__.py` (`database_url`, `open_database`).
- `app/api/ready.py`: the readiness route.
- `alembic.ini` and `migrations/` (async `env.py`, `versions/0001_notes.py`).
- `tests/db/`: `harness.py` (a per-run template migrated by `alembic upgrade head`, a clone per test file, drops by recorded name only), `conftest.py`, `test_harness.py` and `test_notes.py`.

Migrations are the only schema source; tests run them and never create tables from models.

<!-- stacks:when stack=python-react -->
These live under `backend/`; `compose.yaml` and `.env.example` stay at the repo root. Readiness is `GET /health/ready`, which the Vite proxy already forwards with `/health`.
<!-- stacks:end -->
<!-- stacks:when stack=python-api -->
Readiness is `GET /readyz`, beside `/healthz` and outside `/v1`.
<!-- stacks:end -->

## What to add

1. Pin the `compose.yaml` image to the current major (`postgres:<major>-alpine`, from the image's tags page) and delete the `stacks:fill` line above it.
2. Add `sqlalchemy` with its `asyncio` extra (it pulls in greenlet), `asyncpg` and `alembic` with `uv add`, resolving current releases.
3. `Settings` gains `database_url: SecretStr | None = None` and `port_db: int = 5432`. The shipped `app.db.database_url` uses `DATABASE_URL` when set, builds the Compose dev URL from `PORT_DB` in development only, raises in production, and returns `None` in tests, so the Docker-free suite keeps `MemoryNotes`.
4. In the lifespan, enter `open_database(app.state.settings)`, store the result on `app.state.database`, and set `app.state.note_store` to `database.notes`, or `MemoryNotes()` when it's `None`. Mount `ready.router` beside the health router.
5. In `pyproject.toml`: add `--ignore=tests/db` to pytest's `addopts` (`make test` stays Docker-free; an explicit `pytest tests/db` still collects them), and add `"app/db/*"` to coverage's `omit` (test-db covers it). The root `conftest.py`'s `isolated_environment` also deletes `DATABASE_URL`, beside the variables it already clears.
6. Makefile targets matching `commands`: `db-up` is `docker compose up -d --wait db db-test`; `db-migrate` `uv run alembic upgrade head`; `db-check` `uv run alembic check`; `test-db` `uv run pytest tests/db -n $(TEST_WORKERS)`; `db-down` `docker compose stop db`. Add `db-new-migration` (`uv run alembic revision --autogenerate -m "$(NAME)"`) and `db-shell` (`docker compose exec db psql -U app app`).
7. `.env.example` gets `PORT_DB`, `PORT_DB_TEST`, `DATABASE_URL=postgresql+asyncpg://app:app@localhost:5432/app` and `TEST_DATABASE_URL=postgresql://app:app@localhost:5433/postgres`, beside the existing lines.
8. Regenerate the committed OpenAPI spec, since the readiness route is new.

<!-- stacks:when stack=python-react -->
In python-react, mount the router in `app/routers.py::register_routers`, run the Alembic and pytest targets inside `backend/` like the other backend targets, and regenerate with `make generate-api`.
<!-- stacks:end -->
<!-- stacks:when stack=python-api -->
In python-api, mount the router in `create_app` and regenerate with `make openapi`.
<!-- stacks:end -->

A second checkout sets its own `COMPOSE_PROJECT_NAME`, ports and URLs in `.env`, and runs `PORT_DB=... PORT_DB_TEST=... stacks verify` with the same ports, since verify's defaults beat Compose's `.env`.

## Tool configuration

- `alembic check` is the drift check. New schema goes in the models first, then `make db-new-migration NAME=...`; review the revision and never edit an applied one.
- Keep the naming convention on `Base.metadata` and FastAPI dependency annotations available at runtime.
- Teardown stops only `db`: stopping `db-test` would discard a concurrent run's databases. A crashed run's leftovers are listed for a person, never dropped by prefix.

<!-- stacks:when with=ci-github -->
## CI

In the job that runs the backend tests, add a Postgres service container with the same image and healthcheck, mapped to port 5432, and set `TEST_DATABASE_URL` to its `postgres` database. Run `make db-migrate db-check test-db`: the development URL default reaches the service on 5432.
<!-- stacks:end -->

## AGENTS.md

A **Database** section: services and ports, the `db-*` and `test-db` targets, migrations as a release step, adding a migration, and the harness call (`notes_db = setup_test_database("notes")`).
