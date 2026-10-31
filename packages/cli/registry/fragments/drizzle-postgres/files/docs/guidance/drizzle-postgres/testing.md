# Database tests

Database tests run against real Postgres on the `db-test` service; nothing in the database layer is mocked. Ordinary `test` stays Docker-free: database tests live in `tests/db/`, the base Vitest config excludes that directory, and `test:db` runs it with its own config. Run `bun run db:up` first. Without it the harness fails with a connection error that names `TEST_DATABASE_URL` and `db:up`.

## Who owns which database

Several runs can share `db-test` at once: two agents, two checkouts on different ports, a watch run beside a full one. Each run creates databases under names only it knows and drops only those names. Never list databases by prefix to clean up, and never truncate or drop anything you didn't create in this run. Leftovers from a crashed run are reported, never dropped automatically.

Postgres silently truncates identifiers longer than 63 bytes, which can make two names collide. Keep every generated name well under that: a short project prefix, an 8-character run id, a short label and a 4-character random suffix.

## The Vitest harness

1. **One template per run**, in the database config's global setup, which runs once before any worker. Generate the run id there. On the maintenance database, create `<prefix>_tpl_<runid>` and run the committed migrations on it with Drizzle's node-postgres migrator. If creating or migrating fails, drop the template and rethrow. Close every connection to the template before the setup returns: `CREATE DATABASE ... TEMPLATE` fails while anything is connected to it. Hand the template name to the workers the way the installed Vitest's global setup docs describe (its provide and inject API), and drop the template in the global teardown.
2. **One database per test file.** `setupTestDatabase(label)` registers `beforeAll`, which runs `CREATE DATABASE "<prefix>_<runid>_<label>_<rand>" TEMPLATE "<template>"` and opens a pool and a Drizzle instance on the copy, and `afterAll`, which ends the pool, then runs `DROP DATABASE ... WITH (FORCE)` on that name. It returns getters (`t.db`, `t.url`) filled in `beforeAll`, so read them inside tests, not at module scope.
3. **Within a file**, tests share the database. Give each test unique values, or wrap it in a transaction that rolls back. Never truncate tables.

Raise the hook timeout if the default is a few seconds: the first file waits for the template.

Vitest's global teardown and file hooks may not run on Ctrl+C. Run Vitest under a parent that records each database this run successfully created, forwards interrupts, waits for the workers to exit, then drops those exact recorded names even on interruption. Handle failures while recording a newly created name by dropping it before returning the error. Do not infer ownership from a prefix. Prove the interrupt path with a running test and check both the template and its clone are gone.

## What the database tests prove

- The repository inserts a row and reads it back from its own database.
- A duplicate name comes back as the field error, and nothing is written.
- A transaction that throws after an insert leaves no row behind (rollback).
- Readiness returns ready against the test database and unavailable against an unreachable URL (a closed local port), with no error text in the body.
- The harness: two template setups with different run ids at once, where one run's teardown leaves the other's databases in place; and a migration that fails leaves no template behind.

Scoped first: `bun run test:db tests/db/<file>.test.ts`, then `bun run test:db`.

## The end-to-end database

Playwright runs the production server against its own run-owned database on `db-test`, never against the dev database:

- The Playwright config computes the database name once (`<prefix>_e2e_<random>`) and stores it in `process.env` when it isn't set yet, so the workers, which load the config again, see the same name. The web server's environment gets `DATABASE_URL` pointing at that name on the `TEST_DATABASE_URL` server.
- Global setup creates the database, runs the committed migrations, then inserts the two seed items the page tests expect through the repository. Global teardown drops it `WITH (FORCE)`.
- The server's pool connects on the first request, so the order of web server start and global setup doesn't matter.
- One spec checks `/api/ready` returns 200 with `status` `ready`.

## SvelteKit test placement

In SvelteKit: keep the base Vitest config on SvelteKit's Vite config and exclude `tests/db/` from ordinary `test`, so schema and component tests remain Docker-free. `vitest.db.config` reuses that Vite plugin, Testing Library plugin and aliases, but runs `tests/db/**/*.test.ts` in Node with the global setup above. Move the service and directly called action tests that read or write items into `tests/db/`; use the cloned database rather than resetting a module store. Preserve tests of zod parsing and form rendering in the base suite. The action tests still pass a real `Request` with `FormData` and assert the `fail` result or the repository rows.

The Playwright web server runs the built Node adapter with the run-owned `DATABASE_URL` from its config. `e2e` needs `db:up` before global setup; if `db-test` is unavailable, name that command in the failure. Its global setup migrates and seeds the two items the SvelteKit page spec expects, and global teardown drops only its own database. Keep the existing enhanced and JavaScript-disabled submissions, cross-origin rejection, health and 404 assertions; add the readiness assertion. The pool must connect lazily so server startup does not depend on whether global setup or the web server starts first.

## In CI

The test job runs a Postgres service container from the same image with a healthcheck, and points `TEST_DATABASE_URL` at its maintenance database. It runs `db:check`, then `test:db`, then e2e. No `.env` and no account are needed.
