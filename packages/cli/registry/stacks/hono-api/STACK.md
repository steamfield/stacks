---
schema_version: 1
id: hono-api
kind: stack
name: Hono API on Node
description: A TypeScript JSON API on Hono served by Node, with zod-validated routes that generate an OpenAPI document, one error envelope, request ids and pino JSON logs, and Vitest tests that call the app in process and over a real port.
tags: [typescript, api, hono, node, bun, scripts]
deps:
  app: [hono, "@hono/node-server", "@hono/zod-openapi", zod, pino]
  dev: [typescript, "@types/node", "@biomejs/biome", vitest, "@vitest/coverage-v8", pino-pretty]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version. Node runs the server and Vitest; Bun installs, runs scripts and bundles."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github, rest-api]
  optional: [rr, ce-plugin, docker-deploy]
env:
  PORT_API: "3000"
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run test }
  - { name: http-contract, layer: test, run: bun run test tests/http-contract.test.ts }
  - { name: build, layer: build, run: bun run build }
  - name: api
    phase: serve
    layer: serve
    run: "bun run start"
    expect: { http: "http://localhost:${PORT_API}/healthz", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  dev: Run the server from source on Node, restarting on change, with readable logs
  build: Bundle the server into dist/main.js
  start: Run the built server
  typecheck: Run tsc over the app, tests and tooling
  lint: Run Biome checks, including the boundary plugin
  format: Apply Biome formatting and safe fixes
  test: Run Vitest once
  test:watch: Watch Vitest tests
  coverage: Run Vitest with coverage thresholds
  check: Run lint, typecheck, tests and the build
  clean: Remove build and coverage output
  prepare: Install git hooks outside CI
---

# Hono API on Node

## What stacks wrote

A JSON API with one payload, an in-memory notes resource (list, get, create). `src/main.ts` reads the environment and signals; `src/server.ts` is the only module that touches Node's HTTP server; `src/app.ts` builds the whole API as a platform-free fetch handler with request ids, the request log, a body limit, `/openapi.json`, and the not-found and error handlers. `src/config.ts` validates settings with zod, `src/errors.ts` holds the one status table and the error envelope, `src/logging.ts` the pino logger and request log, and `src/router.ts` the `createRouter()` every route module uses. Tests run on Vitest: unit tests beside the code, `tests/http-contract.test.ts` through `app.request()`, `tests/server.test.ts` over a real port. The configs, package scripts, a Biome boundary plugin and `docs/guidance/hono-api/` ship too. Read the code before extending it.

Link `docs/guidance/hono-api/index.md` from AGENTS.md.

## Layout

- `src/schemas/<resource>.ts`: zod schemas with `.openapi()` names. `src/services/<resource>.ts`: the store interface and its in-memory implementation. `src/routes/<resource>.ts`: `createRoute` declarations and handlers, mounted in `app.ts`.
- `tests/helpers/app.ts`: `testApp()`, a fresh app with captured log records. `biome-plugins/boundaries.grit`: the boundary rules, probed by `tests/boundaries.test.ts`.

## Setup

1. Add every declared app and dev dependency at its current release with `bun add` and `bun add -d`. Check `@hono/zod-openapi`'s peer range for zod and hono before adding them, and match `@types/node` to the chosen Node major.
2. Write the Node LTS to `.node-version` and the Bun version to `packageManager`.
3. Run `bun run lint`, `bun run typecheck`, `bun run test` and `bun run build`. Where an installed release rejects shipped code or config (a renamed export, a moved option), update it from that release's declarations, keeping every check, lint rule and assertion.
4. Fill the README's `stacks:fill` markers and AGENTS.md (commands, a single-file test example, the boundaries, the guidance link), then run `stacks verify` until green.

## Conventions

The shipped code keeps these; new code does too. `docs/guidance/hono-api/api.md` has the detail.

- Every route is a `createRoute()` registered with `.openapi()` on a router from `createRouter()`, so validation and `/openapi.json` can't drift. Handlers read input only through `c.req.valid(...)`.
- Errors: throw an `AppError` subclass; `app.onError` renders `{ "error": { "code", "message", "requestId", "issues"? } }` with the status from `errorTable`. A new failure adds a row there and a contract test.
- `node:*`, `@hono/node-server` and `process` stay in `src/main.ts` and `src/server.ts`; `console` stays out of `src/`; `z` comes from `@hono/zod-openapi`. The Grit plugin fails lint on a break.
- Log with the pino logger, flat fields, never bodies, headers, query strings or tokens. The request log records method, route pattern, status, duration and request id.
- Routes live under `/v1`; `/healthz` and `/openapi.json` stay outside it. A create returns 201 with `Location`; a list takes `limit` and `cursor` and returns `nextCursor`.

## Testing

Unit tests sit beside the code (`src/**/*.test.ts`). `tests/http-contract.test.ts` drives the real app with `app.request()` and asserts statuses, envelopes, headers and request records; verify runs it on its own. `tests/server.test.ts` serves on port 0 and calls it with `fetch`. A new endpoint adds its success, every error status it returns, and its validation edges to the contract tables. Details in `docs/guidance/hono-api/testing.md`.

<!-- stacks:when with=ci-github -->
CI sets up Bun from `packageManager` and Node from `.node-version`, installs frozen dependencies, then runs lint, typecheck, coverage and the build. No credentials are needed.
<!-- stacks:end -->

## Commands

`package.json` wires every declared command; mirror them in AGENTS.md with a scoped example such as `bun run test src/config.test.ts`. `dev` stays in the foreground: run it in the background, or use `bun run build && bun run start` on a free `PORT_API`, then stop it. `start` serves the last build.

<!-- stacks:when with=git-hooks -->
`scripts/prepare.ts` already runs `lefthook install` when `lefthook.yml` exists outside CI, so don't add another installer.
<!-- stacks:end -->

## Gotchas

- The validation hook belongs to each `OpenAPIHono` instance, not to the app a router is mounted on. A router made with `new OpenAPIHono()` answers bad input with Hono's plain-text 400; use `createRouter()`.
- `c.req.json()` throws on a malformed body and skips the schema; declare the body in `createRoute()` and let the validator parse it.
- Hono answers a wrong method on a declared path with 404, not 405; the contract tests pin that.
- Bun runs Hono natively, which tempts a switch of runtime. The server and tests run on Node: never `bun test`, `--bun`, or `bun src/main.ts`. The guard hook denies them.
- Node runs `src/*.ts` by stripping types, so relative imports keep their `.ts` extension and the code uses only erasable syntax (no enums, no parameter properties).
