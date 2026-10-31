---
schema_version: 1
id: effect-sql-postgres
kind: fragment
category: service
name: PostgreSQL with Effect SQL
description: "PostgreSQL for the Effect stacks (typescript-api, react-router, astro-fullstack): Docker Compose dev and test databases, migrations run by an explicit command with a drift check, a scoped connection pool, a schema-decoding repository behind an Effect service, and tests on databases cloned from a migrated template."
tags: [database, postgres, effect, service]
applies_to: [typescript-api, astro-fullstack, react-router]
conflicts: [drizzle-postgres]
requires_tools: [docker]
tools: [docker]
deps:
  database: ["@effect/sql-pg"]
decisions:
  - "Postgres image: the official postgres image, current major, alpine variant (default), or an image with the extensions the project needs."
  - "Proving resource: a minimal items resource with a unique name (default) when the project has no domain service yet; in an existing project, back its first in-memory service instead."
  - "Run migrations on server start: no (default); db:migrate is an explicit release step."
env:
  PORT_DB: "5432"
  PORT_DB_TEST: "5433"
verify:
  - name: compose-pinned
    phase: setup
    layer: check
    run: "test -s compose.yaml && ! grep -n 'stacks:fill' compose.yaml"
  - { name: db-up, phase: setup, layer: install, run: bun run db:up }
  - { name: db-migrate, phase: setup, layer: install, run: bun run db:migrate }
  - { name: test-db, layer: test, run: bun run test:db }
  - { name: db-check, layer: check, run: bun run db:check }
  - { name: db-down, phase: teardown, layer: install, run: bun run db:down }
commands:
  db:up: Start db and db-test and wait until both are healthy
  db:migrate: Apply pending migrations to DATABASE_URL
  db:check: Fail if a migration file is unlisted or the database's applied migrations differ, applying nothing
  db:down: Stop the dev database and keep its data; db-test keeps running
  test:db: Database tests, each file on its own database cloned from a migrated template
---

# PostgreSQL with Effect SQL

Use Effect's own driver, `@effect/sql-pg`, not `pg`; if its peer range needs a newer `effect`, upgrade `effect`. Look APIs up in the installed declarations first.

## What stacks wrote

`compose.yaml`: `db` (named volume) and `db-test` (tmpfs) on `127.0.0.1`. A second checkout sets `COMPOSE_PROJECT_NAME` and the ports in `.env`.

<!-- stacks:when stack=typescript-api -->
- `src/platform/database.ts`: `pgLayer`, a lazy pool with short timeouts.
- `src/migrations/`: `0001_items.ts` (`items`, unique `name`) and `index.ts`, the ordered list.
- `src/platform/migrate.ts`: `db:migrate`; `--check` applies nothing and fails on an unlisted file or a database that disagrees.
- `src/services/`: `Items` and `Readiness`, each with a memory layer, and their SQL layers (`items-sql.ts`, `readiness-sql.ts`) on the SQL client service. Rows decode through `src/schemas/items.ts`; a rejected row is a defect. `SqlError` maps once: `UniqueViolation` to `Conflict`, connection and timeouts to `Unavailable`, the rest to defects.
- `src/api/` and `src/handlers/`: `ItemsGroup` (`/v1/items`) and `ReadinessGroup` (`/readyz`, `SELECT 1` within 2 seconds; `/healthz` stays database-free).
- `src/platform/services.ts`: `sqlServices(pg)` and `DatabaseLive`, which reads `AppConfig.databaseUrl`.
- `tests/items.test.ts`: the routes over memory. `tests/db/`: run-owned databases (one migrated template per run, drops by recorded name only), `testDatabase(label)` (a clone per file), and tests of the harness, migrate entry, `items` table, SQL layers and routes (409, `/readyz` 503 beside `/healthz` 200, a rejected row answering 500 without its data), run by `vitest.db.config.ts`.
<!-- stacks:end -->
<!-- stacks:when stack=react-router,astro-fullstack -->
Write the rest in the server code (`app/.server/` or `apps/api/src/`, with root scripts calling the api workspace's): a lazy pool, numbered migrations in an ordered list, a migrate entry whose `--check` applies nothing and fails on drift, and a `tests/db/` harness cloning a per-run migrated template for each file, dropping only names it created.
<!-- stacks:end -->

## What to add

1. Pin the `compose.yaml` image to the current major (`postgres:<major>-alpine`) and delete the `stacks:fill` line.
2. Scripts: `db:up` is `docker compose up -d --wait db db-test`; `db:migrate` runs the migrate entry with Node's `--env-file-if-exists=.env`, `db:check` adds `--check`; `db:down` is `docker compose stop db` (stopping `db-test` would discard a concurrent run's databases); `test:db` is `vitest run --config vitest.db.config.ts`. Add `db:check` and `test:db` to `check`.
3. Config: a redacted `DATABASE_URL`, required in production, else Compose's `db` on `PORT_DB`; add it, `TEST_DATABASE_URL` (database `postgres`), the ports and `POSTGRES_*` to `.env.example`. Exclude `tests/db/**` from `test` and database-only modules from coverage. Add `Conflict` (409, "Resource already exists.", not retryable) to the error table.
<!-- stacks:when stack=typescript-api -->
4. Wire the shipped files into the stack's own: `databaseUrl` in `AppConfig` (`src/config.ts`); export `ConflictResponse` and `UnavailableResponse` from `src/errors.ts`; add `ReadinessGroup` and `ItemsGroup` to `src/api.ts` and their handlers to `App`; the platform entry provides `DatabaseLive` to `App`; `testServer` and `capturedApp` take an optional services layer, defaulting to `Items.layerMemory` and `Readiness.layerMemory`. Coverage excludes `src/migrations/**`, `src/platform/{database,migrate,services}.ts` and `src/services/*-sql.ts`.
<!-- stacks:end -->
<!-- stacks:when stack=react-router,astro-fullstack -->
4. The proving resource's service keeps its memory layer and gets a SQL layer in its own module, on the SQL client service (the driver stays in platform code). Decode rows with the boundary schemas; a rejected row is a defect. Map `SqlError` reasons once: `UniqueViolation` to `Conflict`; connection and timeouts to `Unavailable` (503); the rest to defects.
5. `/healthz` stays database-free; `/readyz` runs `SELECT 1` with a 2-second timeout. The platform entry provides the SQL layers; the test server defaults to memory.
6. Test the routes over memory (201, 409, 400) and through the harness, including `/readyz` 503 beside `/healthz` 200 and a rejected row answering 500 without its data.
<!-- stacks:end -->

Migrations never run at startup. Add one as the next numbered module plus its index line; never edit an applied one.

<!-- stacks:when with=ci-github -->
## CI

Add a Postgres service container, point both URLs at it, and run `db:migrate`, `db:check` and `test:db`.
<!-- stacks:end -->

## AGENTS.md

A **Database** section: services, ports, scripts, adding a migration, the harness, `/healthz` versus `/readyz`.
