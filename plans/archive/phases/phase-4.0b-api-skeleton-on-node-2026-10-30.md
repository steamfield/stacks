# Phase 4.0b: API skeleton on Node

Status: EXECUTED 2026-10-27 in `stacks-api` (gate and `stacks verify` green; the first live deploy and the first hosted CI run are the maintainers' steps; replaces the 2026-10-26 draft "API skeleton and hosting spike", whose Workers spike moved to 4.0f under D35)

| Field | Value |
|---|---|
| Goal | The private `stacks-api` repository is a bun workspace (`apps/api`, `apps/web`, `packages/contract`) whose Effect HTTP program serves only `GET /healthz`, `GET /openapi.json` (generated from the contract), the signed static index files and a minimal built Astro site, runs as a Node server on a host the maintainers control, and keeps the runtime and static serving behind `apps/api/src/platform/` so 4.0f can move it to Workers without touching routes or domain code |
| Traces to | "no public registry exists yet" (assumption 6, which phase 4 replaces with a real host). D35 (a private repository, Node first, portable core). D16 (Workers is the production target) |
| Depends on | D35, and the bundled `astro-api` stack, released in 0.3.1: the repository is scaffolded with the installed CLI, `stacks new astro-api <path>`. Nothing else here: `/healthz` and static files need no shared schema, so `@steamfield/stacks-format` (4.0a) is first needed by 4.1b |
| Blocks | 4.0c (the static directory it deploys into), 4.0e (the site the directory pages join), 4.0f (what it migrates), and through 4.0f, 4.1b (the platform layer and test harness) |
| Decisions needed | None |
| Settles | The API's program structure and workspace layout; how it is tested; which Effect HTTP exports it uses; how static files are served on Node; how the Node host is run and deployed by hand |

## Scope

In:

- Creating `stacks-api` with `bun run dev new astro-api <path>` from this checkout, then filling it in: Effect program, config, logging, error mapping, `/healthz`, `/openapi.json`, a 404 envelope for every unknown path, tests, and the repository's own gate and CI.
- `packages/contract`: the `HttpApi` definition (a `HealthGroup` only) and its schemas, imported by both apps.
- `apps/web`: an Astro site with static output, React islands and Tailwind, holding one minimal page (`/`, a placeholder that says the directory is coming) and a 404 page. 4.0e adds the directory pages.
- A Node entry, `apps/api/src/platform/node.ts`, that serves the routes and, after them, a static directory (the built site plus the index files) through Effect's `HttpStaticServer`.
- A by-hand deploy to the maintainers' host under a maintainers' domain, documented in `stacks-api/apps/api/README.md`.
- A portability test that serves the same route app through `HttpRouter.toWebHandler`, the shape a Worker's `fetch` needs.

Out:

- Wrangler, the Workers runtime, D1, the Workers static assets layer and the Workers test harness: 4.0f.
- The registry index and bundles (4.0c), the official-names file and directory pages (4.0e). The index files are static files built and signed in this repository; the pages are Astro pages in `apps/web`.
- Ingest, storage and scheduled work (4.1b, 4.1c), which start after 4.0f. The Node server never holds a store.
- Any change to this repository beyond this plan file and the `astro-api` stack it depends on.

## Design

### Where this fits

This sub-phase gives the hosted side a running, tested API that does almost nothing, on a host the maintainers already run. 4.0c puts the signed index into the static directory served here, 4.0e adds the official-names file and the directory pages, 4.0f moves the whole program to Workers, and 4.1b adds the first real route and the store after that.

### Workspace layout

The bundled `astro-api` stack sets the conventions (it builds on the backend-only `typescript-api` stack: namespaced `Context.Service` classes with static layer factories, schemas decoded at the boundary, fixed tagged errors with one exhaustive status table, no state across requests); this plan names only what the API adds.

```
stacks-api/
  packages/contract/src/
    api.ts              HttpApi definition: HealthGroup only, and its schemas
    errors.ts           tagged errors, apiErrorTable and ApiErrorEnvelope, so the client decodes them too
  apps/api/src/
    handlers/health.ts
    config.ts           the only place that reads env (and, from 4.0f, Worker bindings)
    logging.ts          structured logs, no request bodies, no IPs
    app.ts              the HttpRouter layer of the api's handlers, over AppLayer
    platform/node.ts    the Node entry: NodeHttpServer, port, graceful shutdown, static serving
    platform/headers.ts the `_headers` subset applied to static responses on Node
  apps/api/tests/
    helpers/server.ts   a real HTTP server around platform/node.ts's layer
    health.test.ts
    static.test.ts
    portable.test.ts    app.ts through HttpRouter.toWebHandler, called with a Request
  apps/web/
    astro.config.mjs    output: "static"; React and Tailwind integrations
    src/pages/          index.astro, 404.astro
```

Only `apps/api/src/platform/` imports `@effect/platform-node` or `node:*`; the stack's boundary rule enforces it. `app.ts` and everything it imports run unchanged on Workers, which `portable.test.ts` checks as far as Node can: same status, headers and body through the web handler as through the server. Static serving is a platform concern because each runtime has its own: `HttpStaticServer` on Node, the static assets layer on Workers (4.0f).

Error responses use `packages/contract/src/errors.ts::ApiErrorEnvelope` (roadmap, Contracts: API error envelope), `{ "error": { "tag", "message", "retryable" } }`, the CLI's field names without `next` and `details`. A miss on an API path (anything under `/v1/`, or `/healthz` or `/openapi.json` with a wrong method) returns the `NotFound` envelope with status 404; any other path that is neither a route nor a static file gets the site's built `404.html` with status 404. The split is by path, as the `astro-api` stack specifies, so the response never depends on what a client puts in `Accept`.

`packages/contract/src/errors.ts::apiErrorTable` is the one exhaustive table from tag to status and `retryable`, checked by the type system the same way the CLI's `errorTable` is. This sub-phase defines four rows; [4.1b](phase-4.1b-telemetry-ingest-and-storage-2026-10-30.md) adds the four the ingest route needs, and no handler picks a status outside the table:

| Tag | Status | Retryable | Added in |
|---|---|---|---|
| `BadInput` | 400 | no | 4.0b |
| `NotFound` | 404 | no | 4.0b |
| `Unavailable` | 503 | yes | 4.0b |
| `Defect` | 500 | no | 4.0b |
| `MethodNotAllowed` | 405, with `Allow` | no | 4.1b |
| `PayloadTooLarge` | 413 | no | 4.1b |
| `UnsupportedMediaType` | 415 | no | 4.1b |
| `RateLimited` | 429, with `Retry-After` | yes | 4.1b |

`/healthz` returns a static `ok` here. Once 4.1b gives the API a store (on Workers), it checks the store and returns 503 when the store is down.

The API's service keys use the scaffolded rule's `<project>/<Name>` namespace, here `stacks-api/<Name>` (for example `stacks-api/Config`), so they never collide with the CLI's `stacks/<Name>` keys.

One server-level middleware (the `middleware` option of `HttpRouter.serve` in `platform/node.ts` and of `toWebHandler`, not a route middleware, so it also sees route misses and static responses) owns the envelope and the one request log line. Both get `{ disableLogger: true }`, because the built-in logger logs every response, including misses and static files, and writes a defect's message. In Effect 4.0.6 a decode failure (`HttpApiError.HttpApiSchemaError`) and an oversized body (`HttpApiPayloadTooLarge`) reach the middleware as defects, not as typed failures; the middleware maps a schema error of kind `Params`, `Query`, `Headers` or `Payload` to `BadInput`, and treats `Body` and `ResponseHeaders` (response encoding, a server bug) as `Defect`. The framework answers a non-JSON body itself with a plain-text 415 before any handler runs; 4.1b's middleware rewrites that response into the `UnsupportedMediaType` envelope.

### Static files

The static directory is one tree assembled at deploy time: the Astro build output of `apps/web` (`apps/web/dist/`), plus the index files 4.0c and 4.0e build and sign in this repository, copied in from an output directory outside both repositories and never committed. `config.ts` reads its path as `STATIC_DIR`.

`platform/node.ts` mounts the route app first and `HttpStaticServer` (root `STATIC_DIR`, index `index.html`) after it, so an API route always claims its path before a file of the same name, and `/stacks/x/` resolves to `/stacks/x/index.html`. A request that escapes the directory (`%2e%2e`, an absolute path, an encoded slash) is a 404. Cache lifetimes come from the `_headers` file 4.0c writes into the directory, the format the Workers static assets layer reads; on Node, `platform/headers.ts` applies the subset 4.0c uses (a path pattern and its headers). One file then keeps the cache rules the same before and after 4.0f. HTML pages with no `_headers` rule get `Cache-Control: public, max-age=300`.

### Host and deploy

The Node server runs under the host's service manager, behind a reverse proxy that terminates TLS and gives it a maintainers' domain, the name the CLI's index URL (4.0d) uses. The same name stays after 4.0f; only where it points changes. The proxy's access log is off or writes no client IP, because the API's own logs carry none and the proxy shouldn't undo that. `deploy` is a script a maintainer runs by hand: build both apps, assemble the static directory, copy the API bundle and the directory to the host, restart the service, then check `/healthz` and `/`. The host's name and credentials live in the maintainer's environment, never in the repository. The repository's own CI runs its gate; the API deploys by hand until that CI deploys it (5.2 covers only the index).

### Package scripts

At the workspace root: `dev`, `build` (the API's Node bundle into `apps/api/dist/` and the site into `apps/web/dist/`), `start`, `typecheck`, `lint`, `format`, `test`, `coverage`, `check` and `clean`, as the stack declares them, plus `deploy`, which this sub-phase adds, fanned out to each workspace. No secret is read or needed in this sub-phase.

### Realistic edge cases

- An index file and a route share a path (a future `/v1/...` route named like a static file): the route wins, by mount order, and `static.test.ts` pins that order.
- A directory request without the trailing slash (`/stacks/x`): `HttpStaticServer` answers 301 to the slash form in Effect 4.0.6; the test pins it, and Astro is configured with `trailingSlash: "always"` so the site's own links never depend on it.
- The static directory is missing or empty at startup (a deploy copied nothing): the server starts, `/healthz` still answers 200, and every static path is a 404, so a bad deploy is visible from `/` rather than a crash loop.
- A deploy copies the site but not the index files, or the reverse: `deploy` checks that `v1/index.json` (once 4.0c lands) and `index.html` both exist in the assembled directory before copying.
- A client sends `HEAD` or `If-None-Match` for a static file: whatever `HttpStaticServer` supports is kept; nothing custom is added.
- A request path with a query string (`/?ref=x`) is served the same file.

## Files and areas touched

| Path | Change |
|---|---|
| `stacks-api/` | New repository from `bun run dev new astro-api <path>`, run from this checkout |
| `stacks-api/packages/contract/src/` | `HttpApi` definition and schemas, as above |
| `stacks-api/apps/api/src/`, `apps/api/tests/` | As above |
| `stacks-api/apps/web/` | The minimal site and its 404 page |
| `stacks-api/apps/api/README.md` | How to run locally, how the static directory is assembled, how a maintainer deploys by hand |
| This file | What it got wrong, after the work |

## Acceptance tests

1. `GET /healthz` returns 200 `{ "status": "ok" }` through a real local HTTP server around the Node layer.
2. The same request through `HttpRouter.toWebHandler` over `app.ts` returns the same status, content type and body.
3. `GET /nope`, `GET /v1/entries/stack/Bad_Id/x.json` and `GET /v1/entries/stack/%2e%2e/x.json` return 404 with the `NotFound` envelope. (Tests use invalid ids and percent-encoded dots because `fetch` normalizes a literal `../` before the request is sent.)
4. Every tag in `apiErrorTable` maps to exactly one status; a test iterates the table and checks each tag's response status and `retryable`, and every body decodes with `ApiErrorEnvelope`.
5. A handler defect returns 500 with a `Defect` envelope, and the log line has the class and stack frames but no message (same rule as the CLI).
6. Over a fixture static directory: `GET /` serves the site's `index.html`; `GET /stacks/x/` serves `stacks/x/index.html`; a fixture file is served with the `Cache-Control` its `_headers` rule gives; a fixture file at `healthz` doesn't shadow the route; `GET /missing` returns 404 with the site's `404.html`, and `GET /v1/missing` and `POST /healthz` return 404 with the `NotFound` envelope.
7. With `STATIC_DIR` pointing at an empty directory, the server starts and `/healthz` returns 200.
8. No module outside `apps/api/src/platform/` imports `@effect/platform-node`, `node:*` or `bun`; the boundary rule's own test probes one of each.
9. `apps/web` builds with no client JavaScript on `index.astro` beyond what an island adds, and `packages/contract` typechecks as imported by both apps.

## Exit criteria

- Acceptance tests pass; `bun run check` green in `stacks-api`, and its CI green.
- A maintainer has run `deploy` once and `/healthz` and `/` answer on the maintainers' domain.

## What this plan may get wrong

- `HttpRouter.toWebHandler` on Node may differ from workerd in ways the portability test can't see (streams, `Request` subclasses). 4.0f's harness is the real check; this test only stops Node-only code reaching `app.ts`.
- `HttpStaticServer.layer`'s options in Effect 4.0.6 are `root`, `index`, `spa`, `cacheControl`, `mimeTypes` and `prefix` (checked against the installed declarations). 2026-10-27, from reading its 4.0.6 source: `layer` mounts `GET /*`; a miss becomes a `RouteNotFound` the layer turns into a plain-text 404, so the server-level middleware rewrites it by path (the `NotFound` envelope on an API path, `404.html` elsewhere); a directory without a trailing slash gets a 301 to the slash form; a missing root doesn't fail at startup, which acceptance test 7 relies on.
- 2026-10-27: the draft had a request middleware catch `HttpApiSchemaError` by tag and check `content-type` before decoding. In Effect 4.0.6 `HttpApiBuilder` turns `HttpApiSchemaError` and `HttpApiPayloadTooLarge` into defects, and its payload decoder answers a non-JSON body with its own plain-text 415 (a missing `content-type` counts as JSON). The server-level middleware inspects the defect and rewrites those responses into the envelope instead.
- 2026-10-27: `apiErrorTable` and `ApiErrorEnvelope` were in `apps/api/src/errors.ts`. The stack puts every tagged error in `packages/contract` so the site's client can decode them, so the contract owns both.
- A public name for a host on a private network needs a tunnel or a proxy with a public address. If neither is available for the demo, the CLI's remote origin (4.0d) points at a local URL and the deploy waits.
- The `_headers` subset may grow past what a small parser should handle. If 4.0c needs more than path patterns and fixed headers, move the cache rules into config and generate `_headers` from it in 4.0f.
- The `astro-api` stack is new. If scaffolding from it needs fixes, they land in this repository's registry first, so the next scaffold gets them, and the private repository is patched by hand to match.
- 2026-10-27, after execution: the response rewriting above runs in a global router middleware (`HttpRouter.middleware(..., { global: true })` in `app.ts`), not a server-level one; in Effect 4.0.6 a middleware passed to `HttpRouter.serve` can't replace the response.
- 2026-10-27: Astro keeps its default `trailingSlash`. `"always"` made the dev server intercept the API proxy's paths; the static server's 301 to the slash form still covers `/stacks/x`.
- 2026-10-27: acceptance test 3's `GET /nope` envelope holds only with no `STATIC_DIR`. With a static directory, a non-API miss is the site's `404.html` (test 6); the `/v1/` misses are the envelope either way.
- 2026-10-27: `_headers` patterns match the whole path with literal dots, and a header two matching rules set is joined with `, ` in file order, which is what the Workers static assets layer does. The parser reads the file once at startup.
- 2026-10-27: every `/v1/` path is answered by the API, so the static server never serves `v1/index.json` today. 4.0c, which writes the index there, has to serve existing static files under `/v1/` before the `NotFound` envelope.
- 2026-10-27, host and deploy: the Node host is one Docker container in its own Compose project (`compose.yaml`, `Dockerfile` on `node:24-slim`) on the maintainers' server, in place of a service manager and a file copy. `bun run deploy` builds both apps, assembles the static directory and runs `docker compose up -d --build --wait` against the host's daemon over SSH (`DEPLOY_HOST`), so the image builds on the host and nothing goes through a registry or CI; it then checks `/healthz` and `/` at `DEPLOY_URL`. The container publishes `DEPLOY_PORT`, and the first deploy is checked on the host's LAN address; the reverse proxy, domain and its access-log setting are the maintainers' step and change only `DEPLOY_URL`. One replica, so a deploy has a few seconds' gap. Workers stays the production target (D16, 4.0f).
