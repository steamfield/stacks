# Phase 4.0f: Workers migration

Status: DEFERRED 2026-10-27 (until after the hackathon demo; the API runs on Node under D35 until then)

| Field | Value |
|---|---|
| Goal | `stacks-api` runs on Cloudflare Workers with an empty D1 database and the static assets layer (D16), by adding `apps/api/src/platform/worker.ts` and the Workers bindings beside the Node entry, after a time-boxed spike that answers open questions 16 and 17. The maintainers' domain moves from the Node host to the Worker unchanged |
| Traces to | D16 (Workers is the production host), D35 (a portable core so this is an adapter swap) |
| Depends on | 4.0b. 4.0c and 4.0e if they have landed: their signed files and the site move as static assets |
| Blocks | 4.1b and every other storage- or telemetry-backed sub-phase (4.1c-4.1e, the server parts of 4.2a-4.2e): storage arrives only on D1 |
| Decisions needed | Whether the Node entry stays as a local runtime after the move (default: it stays for `dev` and the same tests run against both entries; it never runs in production again) |
| Settles | Open questions 16 and 17; the Workers test harness; the D1 driver for `effect/sql`; the Workers deploy command `stacks-api`'s CI automates |

## Scope

In:

- The spike, first, time-boxed to half a session, with findings written into this file.
- `apps/api/src/platform/worker.ts`: the Worker's `fetch` from `HttpRouter.toWebHandler` over 4.0b's `app.ts`, and a `scheduled` export that runs an Effect program (a no-op here; 4.1c gives it the maintenance program).
- `config.ts` reading Worker bindings beside env; an empty D1 database bound and reachable through `effect/sql`'s `SqlClient`, with no tables yet (4.1b writes the first migration).
- Wrangler config serving the assembled static directory (4.0b, "Static files") through the static assets layer with its `_headers`, and a maintainer's first Workers deploy.
- Moving the maintainers' domain from the Node host's proxy to the Worker.

Out:

- Any route, schema or domain change. If the move needs one, the portable core leaked a runtime assumption: fix that in a separate change first and record it here.
- Moving data. Before this sub-phase the API has no store, so D1 starts empty and there is nothing to copy.
- CI deploys, which belong to `stacks-api`'s own CI (5.2 deploys only the index).

## Design

### The spike

Each question gets a short answer and the evidence (commands run, versions) in a "Spike findings" section appended to this file.

| Question | How to answer it |
|---|---|
| Open question 17: does the Workers Vitest pool run with the API's Vitest major on Node? | Add `@cloudflare/vitest-pool-workers` and `wrangler` as dev dependencies of `apps/api` on a scratch branch; run one test that calls the Worker's fetch handler in workerd. Record the pool version and whether it accepts that Vitest |
| If not, what harness? | Node tests that start the Worker with Wrangler's local runtime (`wrangler dev`, or its programmatic API) and call it with `fetch`. Record start-up time per test file |
| Does Effect's HTTP stack run in workerd? | Serve 4.0b's `app.ts` through `HttpRouter.toWebHandler` under `wrangler dev`. Record bundle size against the Workers script limit |
| Does `@steamfield/stacks-format` run there? | Decode a fixture entry and compute a `bundleDigest` inside the Worker, from the published package |
| Do static assets get cache headers from `_headers`, and do directory indexes resolve? | Check `Cache-Control` on a fixture `v1/index.json` file and that `/stacks/x/` serves `stacks/x/index.html` under `wrangler dev`, and that the routes still claim their paths first (the assets layer's `run_worker_first` for `/healthz` and `/v1/*`) |
| Can a scheduled handler call an Effect program? | A no-op `scheduled` export run with Wrangler's scheduled-test mode |
| Is there an `effect/sql` D1 driver compatible with the installed `effect`? | Check npm. If not, write a small `SqlClient` adapter over the D1 binding; record which, so 4.1b starts from it |
| Open question 16: if D17 is declined, is a Worker needed at all? | With no telemetry, phase 4 serves only static files and `/healthz`. Answer whether static assets alone cover it, and what a later move to a plain static host would cost |

### What moves and what doesn't

`app.ts`, `packages/contract`, the handlers, schemas, errors and services don't change, and neither does `apps/web`. The platform layer changes: a Worker entry, bindings in config, the D1 binding, the static assets layer in place of `HttpStaticServer`, and the test harness the spike picks. Every test that ran against the Node server also runs against the Worker harness; tests of pure logic stay on Node.

### Domain cutover

The maintainers' domain keeps its name, so the CLI's index URL (4.0d) and anything that cached it are unaffected. A maintainer deploys the Worker, checks it on the account's Workers subdomain (`/healthz`, `/`, and `build:index --check` against that URL), then points the domain's route at the Worker and runs `build:index --check` against the domain. The Node host keeps serving until that check passes, then its service is stopped.

### Realistic edge cases

- DNS or route changes take minutes to settle, so for a while some clients reach Node and some the Worker. Both serve the same signed files and neither holds data, so a client sees the same bytes from either.
- A file present on the Node host's static directory but missing from the Worker's assets (a deploy that assembled the directory differently): `build:index --check` against the Workers subdomain fails before the cutover, which is the reason it runs there first.
- The Workers assets layer and `HttpStaticServer` may disagree on a trailing-slash redirect or on a `404.html` fallback. The 4.0b static tests run against both entries and pin one behavior; any difference is recorded here.
- A `_headers` rule the assets layer reads differently from `platform/headers.ts` changes cache lifetimes after the move. The spike's cache-header check compares each fixture rule on both.
- The Worker's script size grows past the limit once 4.1b adds ingest. The spike records the margin so 4.1b knows its budget.

## Files and areas touched

| Path | Change |
|---|---|
| `stacks-api/apps/api/src/platform/worker.ts` | New |
| `stacks-api/apps/api/src/config.ts` | Worker bindings |
| `stacks-api/apps/api/wrangler.jsonc`, `apps/api/package.json`, `apps/api/vitest.config.ts` | Wrangler, the D1 binding, the static assets directory, the Workers pool or local-runtime harness, a `deploy:workers` script |
| `stacks-api/apps/api/README.md` | The Workers deploy and domain cutover procedure |
| This file | "Spike findings" section |

## Acceptance tests

1. `GET /healthz` returns 200 `{ "status": "ok" }` through the local Workers runtime, and through the Node server, from the same `app.ts`.
2. 4.0b's 404, error-table and static tests pass against the Worker.
3. A static file served by the Workers assets layer carries the `Cache-Control` from `_headers`, and `/stacks/x/` serves its `index.html`.
4. The Worker reaches the bound D1 database through `SqlClient` (`select 1`).
5. The scheduled handler runs its Effect program once under Wrangler's scheduled-test mode.
6. After the cutover, `build:index --check` against the maintainers' domain passes (if 4.0c has landed; otherwise `/healthz` and `/` answer there).

## Exit criteria

- Spike findings written in this file, answering open questions 16 and 17 with evidence.
- Acceptance tests pass; `bun run check` green in `stacks-api`.
- The maintainers' domain serves from the Worker and the Node host's service is stopped.

## What this plan may get wrong

- Effect's HTTP modules may be too large for the Workers script limit or use an API workerd lacks. The fallback is a plain fetch handler with Schema decoding and the same routes and envelope; record it in the findings.
- The Workers pool may lag Vitest majors. If it doesn't support the API's Vitest, the Wrangler-runtime harness is slower; keep runtime tests few and keep logic tests on Node.
- Running the same tests against both entries may cost more than it catches once storage exists, since the Node entry has no D1. If so, the Node entry is kept only for the route and static tests, and storage tests run on the Worker harness alone.
