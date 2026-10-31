# Database

PostgreSQL runs in Docker Compose for development and tests. The app talks to it through Drizzle ORM on the `pg` (node-postgres) driver. Migrations are checked-in SQL under `drizzle/` and are the only source of schema: tests build their databases by running them, never by pushing the schema.

## Services and ports

`compose.yaml` at the repo root has two services from the same official `postgres` image (current major, alpine variant, unless the image decision chose another):

| Service   | Host port               | Data                                                                                                | Used by                                      |
| --------- | ----------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `db`      | `${PORT_DB:-5432}`      | a named volume, mounted where the image docs say for that major (the path changed in recent majors) | the dev and production servers, `db:migrate` |
| `db-test` | `${PORT_DB_TEST:-5433}` | tmpfs, with `fsync`, `synchronous_commit` and `full_page_writes` off                                | `test:db`, `e2e`                             |

Both read `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` from the environment with `app` defaults, publish on `127.0.0.1` only, and have a `pg_isready -U <user> -d <db>` healthcheck with a start period. Set the top-level Compose `name` to the project slug.

Host ports and the Compose project name are shared by every checkout on the machine. A second checkout or worktree sets its own `COMPOSE_PROJECT_NAME`, `PORT_DB` and `PORT_DB_TEST` in `.env`, and its URLs to match, so it never reuses another checkout's containers. `stacks verify` passes `PORT_DB` and `PORT_DB_TEST` defaults to its steps, and those override Compose's `.env` values, so run verify with the chosen ports in its environment too.

## Environment

| Variable            | Default when unset                                                                   | Read by                               |
| ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| `DATABASE_URL`      | none at runtime; tooling falls back to `postgres://app:app@localhost:${PORT_DB}/app` | the database module, `drizzle.config` |
| `TEST_DATABASE_URL` | `postgres://app:app@localhost:${PORT_DB_TEST}/postgres` (the maintenance database)   | the test harness, Playwright setup    |

Add both, the ports and the `POSTGRES_*` values to `.env.example` beside the lines already there; never replace the file. The running app has no fallback: a missing `DATABASE_URL` fails the first query with an error that names the variable, so production never connects to a local default by accident. Only the developer tooling (`drizzle.config`, the test harness) builds a local default from the port.

drizzle-kit and the test runners run on Node, outside the framework's env loading, and Bun doesn't hand its loaded `.env` to a Node child. `drizzle.config` loads `.env.local` and `.env` itself when they exist (Node's built-in env-file loader), before reading `DATABASE_URL`.

## Migrations

- `db:generate` runs drizzle-kit's generate against the schema file and writes a new migration under `drizzle/`. Review the SQL before committing it, and never edit a migration after it's committed; add a new one.
- If a schema change could be a rename, `db:generate` may ask for a choice an agent's shell cannot answer. Put the rename in its own change, or ask the person to run generation in a terminal. Verify never generates migrations.
- `db:migrate` applies the committed migrations to `DATABASE_URL`. It's an explicit step for development and release, never part of app start.
- `db:check` fails when the migration history is inconsistent or when the schema has changes no migration covers. It never writes to `drizzle/`: it runs drizzle-kit's consistency check, then copies `drizzle/` to a temporary directory under the project, generates into the copy (point `drizzle.config`'s output directory at a relative-path env override for this) and fails if the copy gained a file. Check the generator output as well as its exit status: some releases report errors while exiting successfully. Fail unless generation confirms it completed. Remove the temporary copy even on failure. It needs no database. If the installed drizzle-kit's own `check --help` says it compares the schema with the migrations, use that alone.
- `db:up` is `docker compose up -d --wait db db-test`, so it fails loudly when a service never turns healthy. `db:down` is `docker compose stop db`: it keeps the dev data and leaves `db-test` running, because another test run may be using it and its tmpfs data dies when it stops. Nothing in the project runs `docker compose down -v`; a person removes volumes.

`drizzle.config` sets the PostgreSQL dialect, the schema file, `drizzle/` as output and strict mode. The schema file must load under plain Node: no `server-only` import, no path aliases, no imports from app code.

The first migration defines `items` with a generated identity id, `name` text not null and unique, and `created_at` with a default. Run `db:generate`, review the SQL and commit it under `drizzle/`. Add that directory to the formatter's ignore file: drizzle-kit writes JSON snapshots that must stay in its own format for lint and drift checks.

`pg` returns `bigint` and `numeric` columns as strings. Use integer identity ids unless the schema needs a bigger range, and parse deliberately where it does.

## The database module

One module owns the pool and the Drizzle instance. It creates both on first use, not at import, so the production build and code that never queries don't need a database. The dev server reloads modules, so the module keeps the pool on `globalThis` in development and reuses it. Give the pool a short connection timeout so a down database fails a request in seconds rather than hanging, and handle the pool's idle-client error event so a lost connection logs a diagnostic without credentials instead of terminating the server. The app's pool closes when the server process exits; tests and scripts end the pools they create.

Export a factory that builds a repository from any Drizzle instance, and a default repository on the shared one. The app uses the default; tests build one on their own database. Repositories return typed rows and map expected database errors to results the caller can show: a unique violation (Postgres error code `23505`) becomes a field error, never a thrown error that reaches the error boundary. Other errors are thrown.

Readiness runs `select 1` through the same pool with a bounded wait. It answers 200 `{"status":"ready"}` or 503 `{"status":"unavailable"}`, and never includes the error text. Liveness never touches the database. Test both after stopping a database that has already served a query, not only against one that was never reachable.

## SvelteKit placement

In SvelteKit: keep the schema in `src/lib/server/db/schema.ts`, with no app aliases or framework env imports because drizzle-kit loads it under plain Node. Put the lazy pool, Drizzle instance and readiness query in `src/lib/server/db/index.ts`; use the installed SvelteKit release's private runtime environment API for `DATABASE_URL`. If the release requires declaring environment variables, allow it to be absent at startup and fail on the first query instead. Build-time env cannot supply a runtime database URL. `src/lib/server/items-repository.ts` exports the factory that accepts a Drizzle instance; `src/lib/server/items.ts` keeps the existing service's list and add interface over the shared repository. Do not import `server-only`: SvelteKit guards server modules itself.

The `+page.server.ts` load and action await the service. Return the duplicate-name constraint as the action's existing field error with `fail`, leaving the shared zod parser and form intact. Do not prerender the page or `/api/ready`; put the readiness handler in `src/routes/api/ready/+server.ts`. Keep `src/routes/api/health/+server.ts` database-independent, returning `{"status":"ok"}` without the old item count.
