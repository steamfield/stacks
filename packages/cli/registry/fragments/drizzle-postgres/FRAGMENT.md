---
schema_version: 1
id: drizzle-postgres
kind: fragment
category: service
name: PostgreSQL with Drizzle for Next.js and SvelteKit
description: "PostgreSQL for the Next.js and SvelteKit stacks through Drizzle ORM and node-postgres (pg): Docker Compose dev and test databases, checked-in SQL migrations with a drift check, a server-only database module and repository, a readiness route, and tests on databases cloned from a migrated template."
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
  - { name: db-up, phase: setup, layer: install, run: bun run db:up }
  - { name: db-migrate, phase: setup, layer: install, run: bun run db:migrate }
  - { name: test-db, layer: test, run: bun run test:db }
  - { name: db-check, layer: check, run: bun run db:check }
  - { name: db-down, phase: teardown, layer: install, run: bun run db:down }
commands:
  db:up: Start the dev and test databases and wait until both are healthy
  db:migrate: Apply the checked-in migrations to the dev database
  db:check: Fail if the migrations are inconsistent or miss a schema change, without writing any
  db:down: Stop the dev database and keep its data
  test:db: Run the database tests, each file on its own database cloned from a migrated template
---

# PostgreSQL with Drizzle

Local Postgres for development and tests, Drizzle ORM on the `pg` driver, checked-in SQL migrations, and a test harness that gives each test file a private database cloned from a template the run migrated once. Migrations are the only schema source: tests and verify apply them and never push the schema or generate new migrations.

Read `docs/guidance/drizzle-postgres/index.md` and the two files it links, `database.md` and `testing.md`, before writing database code, and link the index from AGENTS.md. The index sets the lookup order for Drizzle's current APIs: the installed declarations and `drizzle-kit --help` first, orm.drizzle.team next, memory last.

## What to add

1. Add `compose.yaml` with dev and test services as `database.md` specifies. Extend `.env.example` with the database ports, credentials and URLs; document separate Compose names, ports and URLs for a second checkout.
2. Install the declared dependencies, check peer ranges, add `drizzle.config` and a plain-Node schema, then generate and commit the first migration for `items` as `database.md` describes. Ignore `drizzle/` in the formatter.
3. Wire `db:up`, `db:migrate`, `db:generate`, `db:check`, `db:down` and `test:db` as the guidance specifies. Keep `db:generate` development-only, list it in AGENTS.md, and add `test:db` and `db:check` to the host's `check` script.
4. Add the database module, one repository, readiness route and tests as the host section and `testing.md` describe.

Pool lifecycle belongs to the server process: one pool per process, created on first use, closed by the process or by the test that opened it. Never open a pool per request.

<!-- stacks:when stack=nextjs -->
## Next.js placement

Server-only code stays in `src/lib/server/`, and each module there imports `server-only` first, except the schema:

```text
src/lib/server/db/schema.ts    Drizzle tables; no server-only import (drizzle-kit loads it under Node)
src/lib/server/db/index.ts     pool, Drizzle instance, readiness check
src/lib/server/items-repository.ts   factory taking a Drizzle instance: list, add
src/lib/server/items.ts        the service the page and action already call, same exports, now on the repository
src/app/api/ready/route.ts     readiness, rendered per request
```

The items service keeps the async `listItems` and `addItem` exports the page and action already await. Map duplicate names to the action's existing `INVALID_INPUT` state with a `name` field error ("An item with this name already exists"). Remove the in-memory store and `resetItemsForTest`; move `src/lib/server/items.test.ts` to `tests/db/` against a real database. The page, form and item-write browser assertions stay.

`/api/health` stays the liveness check for the `web` verify probe and stops reporting the item count, so it returns `{"status":"ok"}` without touching the database. Update the health schema in `e2e/items.spec.ts` to match, keeping its status, no-store and request-ID assertions. Say so in README. Readiness lives at `/api/ready`.

The items page now reads the database, so it must render per request: opt it out of build-time prerendering the way the installed caching docs describe, or `next build` queries a database verify hasn't given it. Keep the existing revalidation after a write.

`vitest.db.config` reuses the base config's React plugin settings, `@/*` alias and `server-only` mapping, runs `tests/db/**/*.test.ts` in the node environment with the global setup from `testing.md`, and the base config excludes `tests/db/`. `e2e` needs `db:up` first; the Playwright global setup fails with a message naming `db:up` when `db-test` doesn't answer.
<!-- stacks:end -->

<!-- stacks:when stack=sveltekit -->
## SvelteKit placement

Follow the SvelteKit sections in `database.md` and `testing.md`. Put the schema, lazy pool and repository under `src/lib/server/`; SvelteKit enforces the server-directory boundary, so omit `server-only` and use the shipped `#lib/*` imports. Keep the items service's async `listItems` and `addItem` exports for `+page.server.ts`, mapping duplicate names to the form action's field error. Move the adjacent service and action tests to `tests/db/` and remove the in-memory reset helper. The database Vitest config must replace the server project's includes with `tests/db/**/*.test.ts`, keeping Node resolution; the component project's browser resolution must not reach server tests. The page load and `/api/ready` query per request, without prerendering. Preserve the hook's 503 readiness body and keep `src/hooks.server.test.ts` in the base suite to prove it survives request middleware. `/api/health` returns only `{"status":"ok"}` and never queries Postgres; document its removed item count in README and update the e2e health schema, preserving its status, no-store and request-ID assertions. Keep the shared zod parser, form and browser assertions.
<!-- stacks:end -->

<!-- stacks:when with=ci-github -->
## CI

In the job that runs the tests, add a Postgres service container (the same image, a healthcheck, port 5432 mapped) and set `TEST_DATABASE_URL` to its maintenance database. Run `db:check` and `test:db` before e2e; e2e creates its own database on the same service. No credentials are needed.
<!-- stacks:end -->

## AGENTS.md

A **Database** section: the two services and their ports, how a second checkout moves them, the `db:*` and `test:db` scripts, that migrations are the only schema source and run as an explicit step, how to add a migration (`db:generate`, read the SQL, commit), the `setupTestDatabase(label)` call, and a link to `docs/guidance/drizzle-postgres/index.md`.
