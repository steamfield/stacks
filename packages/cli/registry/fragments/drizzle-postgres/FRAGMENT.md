---
schema_version: 1
id: drizzle-postgres
kind: fragment
category: service
name: PostgreSQL with Drizzle for Next.js and SvelteKit
description: "PostgreSQL for the Next.js and SvelteKit stacks through Drizzle ORM and node-postgres (pg): Docker Compose dev and test databases, checked-in SQL migrations with a drift check, a server-side database module and repository, a readiness route, and tests on databases cloned from a migrated template."
tags: [database, postgres, drizzle, service]
applies_to: [nextjs, sveltekit]
conflicts: [effect-sql-postgres]
requires_tools: [docker]
tools: [docker]
deps:
  app: [drizzle-orm, pg]
  dev: [drizzle-kit, "@types/pg"]
decisions:
  - "Postgres image (default: the official postgres image, current major, alpine variant). Use an image with the extensions the project needs, such as pgvector, when the person asks for them."
  - "Run migrations on app start (default: no). db:migrate is an explicit development and release step. If a host can run only one command on deploy, run db:migrate before the server in that command, never inside a request."
  - "Seed data in development (default: none). The end-to-end setup inserts the rows its tests expect; add a db:seed script only when the person asks for one."
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
  db:migrate: Apply the checked-in migrations to the dev database
  db:check: Fail if the migrations are inconsistent or miss a schema change, without writing any
  db:down: Stop the dev database and keep its data; db-test keeps running
  test:db: Database tests, each file on its own database cloned from a migrated template
---

# PostgreSQL with Drizzle

## What stacks wrote

`compose.yaml` runs `db` (dev data in a named volume) and `db-test` (tmpfs, durability off), both bound to `127.0.0.1` with `pg_isready` healthchecks. A second checkout sets its own `COMPOSE_PROJECT_NAME`, `PORT_DB` and `PORT_DB_TEST` in `.env`, and runs verify with those ports in its environment.

<!-- stacks:when stack=nextjs -->
- `src/lib/server/db/schema.ts` (the `items` table; loads under plain Node, so no `server-only` and no aliases), `db/index.ts` (lazy pool on `globalThis`, short connect timeout, idle-error log without credentials, `isReady`) and `items-repository.ts` (`itemsRepository(db)`, mapping Postgres `23505` to `{ status: "duplicate" }`).
- `src/app/api/ready/route.ts`: 200 `{"status":"ready"}` or 503 `{"status":"unavailable"}`, no error text.
<!-- stacks:end -->
<!-- stacks:when stack=sveltekit -->
- `src/lib/server/db/schema.ts` (the `items` table; loads under plain Node, so no `#lib` or `$app` imports), `db/index.ts` (lazy pool on `globalThis` reading `DATABASE_URL` from `$app/env/private`, short connect timeout, idle-error log without credentials, `isReady`) and `items-repository.ts` (`itemsRepository(db)`, mapping Postgres `23505` to `{ status: 'duplicate' }`).
- `src/routes/api/ready/+server.ts`: 200 `{"status":"ready"}` or 503 `{"status":"unavailable"}`; the hook keeps that body.
<!-- stacks:end -->
- `drizzle.config.ts` (loads `.env.local` and `.env` itself; output overridable through `DRIZZLE_OUT`) and `scripts/db-check.ts`, the drift check: `drizzle-kit check`, then generation into a temporary copy of `drizzle/` that must gain nothing.
- `tests/db/`: `databases.ts` (run-owned names, advisory locks, drops by recorded name only), `global-setup.ts` (one migrated template per run), `harness.ts` (`setupTestDatabase(label)`: a clone per file; read `t.db` inside tests), `harness.test.ts` (two concurrent runs, a failed migration) and `items-repository.test.ts` (round trip, duplicate, rollback, readiness up and down). `vitest.db.config.ts` runs them in Node.
- `e2e/db-setup.ts`: Playwright's own database on `db-test`, migrated and seeded with the two items the page tests expect, dropped at the end.

Read them before extending. Migrations are the only schema source: tests and verify run them and never push the schema. A crashed run's leftovers are reported, never dropped by prefix.

## What to add

1. Pin the `compose.yaml` image to the current major (`postgres:<major>-alpine`) and delete the `stacks:fill` line.
2. Install the declared dependencies and check their peer ranges. Run `db:up`, then `db:generate` for the first migration; read the SQL and commit `drizzle/`. Add `drizzle/` to `.prettierignore`.
3. Add the scripts: `db:up` is `docker compose up -d --wait db db-test`, `db:migrate` is `drizzle-kit migrate`, `db:generate` is `drizzle-kit generate`, `db:check` is `bun scripts/db-check.ts`, `db:down` is `docker compose stop db` (stopping `db-test` would discard a concurrent run's databases; nothing runs `down -v`), `test:db` is `vitest run --config vitest.db.config.ts`. Put `db:check` and `test:db` in `check` before `e2e`.
4. Make the items service a thin layer over `defaultItemsRepository()`, keeping the async `listItems` and `addItem` exports. Map a duplicate to the existing field error, "An item with this name already exists.", and delete the in-memory store, its reset helper and `src/lib/server/items.test.ts`.
5. Make `/api/health` liveness only: `{"status":"ok"}`, no database. Update its e2e schema, keep its status, no-store and request-ID assertions, add a spec that `/api/ready` returns `ready`, and say in README that health lost its item count.
6. In `playwright.config.ts` set `globalSetup: "./e2e/db-setup.ts"` and give the web server `DATABASE_URL: databaseUrl(e2eDatabase())`, importing both. `e2e` needs `db:up` first.
7. Extend `.env.example` with `DATABASE_URL` (port `PORT_DB`, database `app`), `TEST_DATABASE_URL` (port `PORT_DB_TEST`, database `postgres`), the ports and the `POSTGRES_*` values, keeping the existing lines.

<!-- stacks:when stack=nextjs -->
The duplicate maps to the action's `INVALID_INPUT` state with a `name` field error. The page already renders per request; replace its "Items live in this server process" line. Once `test:db` covers the service, drop any base test that imported the in-memory store.
<!-- stacks:end -->
<!-- stacks:when stack=sveltekit -->
Add `DATABASE_URL: { schema: z.string().optional() }` to `src/env.ts`, so the server starts without one and fails on the first query. Return the duplicate from the action as `fail(400, { name, errors: { name: "..." } })` and add a browser spec for it. In `src/routes/page.server.test.ts` keep only the invalid-input test (it never reaches the database); e2e covers load and write. `src/hooks.server.test.ts` already covers the readiness 503.
<!-- stacks:end -->

<!-- stacks:when with=ci-github -->
## CI

In the job that runs the tests, add a Postgres service container (the pinned image, a healthcheck, port 5432 mapped) and set `TEST_DATABASE_URL` to its `postgres` database. Run `db:check` and `test:db` before e2e; e2e creates its own database on the same service. No credentials are needed.
<!-- stacks:end -->

## Drizzle's current API

Drizzle changes config shape, migration layout and migrator entry points between releases. Look things up in the installed declarations under `node_modules/drizzle-orm/` and `node_modules/drizzle-kit/`, then `bunx drizzle-kit <command> --help`, then orm.drizzle.team. If `db:generate` asks whether a change is a rename, the agent's shell can't answer: put the rename in its own change or ask the person to run it. Never edit a committed migration. `pg` returns `bigint` and `numeric` as strings.

## AGENTS.md

A **Database** section: the two services and their ports, how a second checkout moves them, the `db:*` and `test:db` scripts, that migrations are the only schema source and run as an explicit step, how to add a migration (`db:generate`, read the SQL, commit), `setupTestDatabase(label)`, and readiness at `/api/ready`.
