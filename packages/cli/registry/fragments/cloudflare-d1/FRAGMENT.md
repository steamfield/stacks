---
schema_version: 1
id: cloudflare-d1
kind: fragment
category: service
name: Cloudflare D1 with Drizzle for React Router on Workers
description: Cloudflare D1 for the React Router on Workers stack, with a typed D1 binding, Drizzle's D1 driver, checked-in SQL migrations with a drift check, and Workers-runtime tests on isolated local storage, with no Cloudflare account.
tags: [database, sqlite, cloudflare, workers, drizzle]
applies_to: [cloudflare-react-router]
deps:
  database: [drizzle-orm]
  database-dev: [drizzle-kit]
decisions:
  - "Database name (default: project slug)."
verify:
  - { name: db-check, layer: check, run: bun run db:check }
commands:
  db:check: Fail when the Drizzle schema has changes no checked-in migration covers
---

# Cloudflare D1 with Drizzle

stacks wrote the database slice: `drizzle.config.ts`, a proving `items` table in `app/.server/db/schema.ts`, a per-request factory and the `/readyz` response in `app/.server/db/index.ts`, Workers-runtime tests in `app/.server/db/database.test.ts` with the test-binding type in `test-env.d.ts`, the drift check `scripts/db-check.sh`, and `tests/helpers/d1.ts`, which migrates the HTTP tests' persistence directory. Development, tests and verify use local D1 only; no account or cloud database is needed. Read the code before extending it.

## What to add

1. Add `drizzle-orm` with `bun add` and `drizzle-kit` with `bun add -d`.
2. Add the binding to `wrangler.jsonc`: `"d1_databases": [{ "binding": "DB", "database_name": "<database name>", "migrations_dir": "drizzle" }]`. Leave out `database_id` and `remote`: local development needs neither, and `wrangler deploy` provisions the remote database on the person's first deploy. Run `bun run typecheck` so the generated `Env` has `DB: D1Database`. The shipped files name the binding `DB`.
3. Add these `package.json` scripts and put `bun run db:check &&` at the front of `check`:
   - `"db:check": "sh scripts/db-check.sh"`, the drift check verify runs
   - `"db:generate": "drizzle-kit generate"`, for development only
   - `"db:migrate": "wrangler d1 migrations apply DB --local"`, for the developer's local database

   No install, test, verify or dev command touches the remote database. If deploy needs one, name it `db:migrate:remote`; only a person or deploy CI runs it.
4. Run `bun run db:generate` and commit `drizzle/`, the SQL and drizzle-kit's metadata. Add `"!drizzle"` to Biome's `files.includes`, since the files are generated.
5. Add `app/routes/readyz.ts`, a loader that returns `readiness(context.get(cloudflareContext).env.DB)` from `app/.server/db`, and register `route("readyz", "routes/readyz.ts")` in `app/routes.ts`. `/healthz` stays database-free, and the stack's serve probe keeps using it.
6. In `vitest.workers.config.ts`, import `readD1Migrations` from `@cloudflare/vitest-plugin`, switch to the async form `cloudflareTest(async () => ({ ...current options }))` and add the test-only binding: `miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations({ migrationsDir: "drizzle" }) } }`. Storage is isolated per test file, so every test file that touches D1 calls `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` in `beforeAll`, as `database.test.ts` does.
7. In `tests/http.test.ts`, call `await migrateLocalD1(state)` right after `start()` creates its persistence directory and before it spawns `wrangler dev`. Add a test that `/readyz` on the healthy server returns 200 with `{ status: "ok" }`.
8. If the installed drizzle-kit writes one folder per migration (`drizzle/<timestamp>_<name>/migration.sql`), add `"migrations_pattern": "drizzle/*/migration.sql"` to the binding and `migrationsPattern: "drizzle/*/migration.sql"` to `readD1Migrations`. `db:check` handles both layouts.

Keep `items` as the proving table and add no product features.

## Tool configuration

- `drizzle.config.ts` only generates SQL. Don't add `dbCredentials` or the `d1-http` driver: that would need an account token, and Wrangler applies migrations.
- `scripts/db-check.sh` runs `drizzle-kit check`, then generates into a throwaway copy of `drizzle/`. It passes only when drizzle-kit reports no schema changes and the copy still equals `drizzle/`. drizzle-kit exits 0 when generate fails, so keep the message check. If an upgrade rewords the message, update the script, don't loosen it. The copy is a `.db-check.*` directory in the project root, left behind if the check is killed: add `.db-check.*` to `.gitignore` and Biome's ignored files.
- Without a terminal, drizzle-kit can't ask whether a change is a rename. Ask the person to run `bun run db:generate`, or split the change into steps it can generate without asking.
- Migrations are append-only once applied remotely. Review generated SQL for drops and SQLite table rebuilds before any remote apply.
- Worker code builds `database(env.DB)` per request from `context.get(cloudflareContext).env`, never opens a filesystem SQLite file and logs database failures with fixed fields only.

<!-- stacks:when preset=default -->
Deploy CI applies reviewed remote migrations (`wrangler d1 migrations apply DB --remote`) before it deploys the Worker that needs them, using the person's Cloudflare credentials. Never fabricate a database id or token.
<!-- stacks:end -->

## Verify

`db-check` fails when `drizzle/` has no migration, when drizzle-kit's metadata is inconsistent, or when the schema has changes no migration covers. It never writes to `drizzle/`. `database.test.ts` runs in the stack's `test` and `coverage` steps. It checks that the checked-in migrations apply to isolated local D1 and that applying them again changes nothing. It also covers a row round trip, a unique violation that rejects, and a missing schema answered with 503. The HTTP test applies the same files through Wrangler and proves `/readyz` through the built Worker.

## AGENTS.md

Add a **Database** section: the `DB` binding, the schema in `app/.server/db/schema.ts`, migrations in `drizzle/` (generated by `bun run db:generate`, committed, append-only once remote), `bun run db:check` before every commit, and `bun run db:migrate` for the local database only. Say how tests get a migrated database (`TEST_MIGRATIONS` and `applyD1Migrations` per Workers test file, `migrateLocalD1` for HTTP tests), that local state lives in `.wrangler/state/v3/d1` and is reset by deleting that directory, and that `/readyz` checks the database while `/healthz` doesn't.

<!-- stacks:when preset=default -->
Under Pending user actions: the first `wrangler deploy` provisions the production database, and reviewed remote migrations must be applied before deploying a Worker that depends on them.
<!-- stacks:end -->
