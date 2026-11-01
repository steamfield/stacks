---
schema_version: 1
id: typescript-api
kind: stack
name: TypeScript HTTP API with Effect
description: A Node HTTP API on Effect's HttpApi, with schema-first REST resources, tagged errors mapped through one status table, structured request logs, a platform-free core that also runs as a web fetch handler, Vitest through real HTTP, and a one-route proving slice.
tags: [typescript, api, effect, node, bun, scripts]
deps:
  app: [effect, "@effect/platform-node"]
  dev: [typescript, "@biomejs/biome", vitest, "@vitest/coverage-v8", "@types/node", "@types/bun"]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version and engines.node; Node runs the server and Vitest, Bun installs and runs scripts."
merge: [.claude/settings.json, .codex/hooks.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github, effect, rest-api]
  optional: [rr, ce-plugin, docker-deploy, openrouter-ai, effect-sql-postgres, effect-otlp]
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
    run: "bun run dev:server"
    expect: { http: "http://localhost:${PORT_API}/healthz", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  dev: Run the foreground server and preserve logs
  dev:server: Run the server from source on Node, restarting on change
  dev:bg: Start or reuse this checkout's background server
  logs: Query development records with filters or JSON output
  dev:status: Report checkout server health and log problems
  dev:stop: Stop this checkout's background server
  build: Bundle the Node server into dist/
  start: Run the built server with optional .env loading
  typecheck: Run tsc without emitting
  lint: Run Biome checks
  format: Apply Biome formatting and safe fixes
  test: Run Vitest
  test:watch: Watch Vitest tests
  coverage: Run Vitest with coverage
  check: Run lint, typecheck, tests and the build
  clean: Remove project build, test and log output
  prepare: Install project hooks outside CI
---

# TypeScript HTTP API with Effect

Read `docs/guidance/typescript-api/index.md` before implementation; it supplies the shared guidance for every selected agent.

The proving slice is already written: `GET /healthz` through config, logging, a service and the error table, a payload-taking `POST /v1/health-checks/live` for decode and media-type cases, `/openapi.json`, and `tests/http-contract.test.ts` covering the acceptance matrix on both transports. Keep the core platform-free so the same app also runs as a web fetch handler.

## Layout

`src/api.ts` is the `HttpApi` definition, composed from one group per resource in `src/api/<resource>.ts`. `src/handlers/<resource>.ts` implements each group. Domain programs and services live in `src/services/`; boundary schemas in `src/schemas/`, one dependency-free file per domain re-exported from `index.ts`. `config.ts`, `errors.ts` and `logging.ts` own those boundaries. `app.ts` builds the platform-free app and the global request middleware. `src/platform/node.ts` is the only entry and the only module importing `@effect/platform-node` or `node:*`. Tests live in `tests/`, helpers in `tests/helpers/`; `tests/helpers/failures.ts` holds test-only routes that the contract suite mounts. Shipped `scripts/` own development process management. Logs live in ignored `logs/`. A new resource copies the health files' shape.

Read `docs/api-foundation.md` for lint, testing and development requirements.

## Setup

1. Add the declared dependencies with `bun add` and `bun add -d` together, letting them resolve to current compatible versions and checking peer ranges; pin `@types/node` to the `.node-version` major (a bare add picks the newest). Write Node LTS to `.node-version` and `engines.node`, and the current Bun to `packageManager`.
2. Run lint, typecheck, test and build. The shipped `package.json` scripts, `tsconfig*.json`, `biome.json`, `vitest.config.ts`, `src/` and `tests/` were written against an earlier Effect release: where the installed one renamed or moved an API, update the code to it, following `effect-api.md` to find the current mechanism; never loosen a test to fit.
3. If the installed Node can't run `node src/platform/node.ts` without a flag, add it to the scripts and record it under Build workarounds.
4. Fill README and AGENTS for this base before adding any resource.

## Runtime and boundaries

Follow `docs/guidance/typescript-api/effect-api.md` for services, runtime, config, errors and the HTTP boundary. New settings go in config, `.env.example` and README. The shipped boundary checks keep Node and Bun in `src/platform/`, forbid `console` in `src/`, and require Schema from `effect`. Core code uses Effect's `FileSystem`, `Path` and `HttpClient` services.

## HTTP API

Resources live under `/v1` unless the project chose no prefix; `/healthz` and `/openapi.json` stay outside it. Every error body is `{ "error": { "tag", "message", "retryable" } }`. The base error rows are `BadInput` (400), `NotFound` (404), `Unavailable` (503, retryable) and `Defect` (generic 500); add `UnsupportedMediaType` (415) with the first body endpoint. A wrong method gets the 404 envelope. Serve `/openapi.json` from the definition.

## Logging and development

Convert logger inputs to a plain LogEntry for testing, then format JSON with UTC `time`, lowercase `level`, `msg`, annotations, `detail` and an allowlisted `error`. The request middleware logs method, route pattern, status, duration and `requestId`; return `x-request-id` and log health probes at debug. In development write readable terminal lines and JSONL to `logs/server.jsonl`; in production write JSON to stdout only. Respect `NO_COLOR` and case-insensitive `LOG_LEVEL`. A file sink recreates a deleted log directory, warns once on failure and never fails a request.

The shipped dev wrapper copies terminal output to `logs/dev.log`, rotates prior logs, owns `logs/dev.pid`, and refuses duplicate checkout servers or occupied ports. Background start waits for `/healthz`, reports failures in `logs/dev-bg.err`, and stop signals only the wrapper and the server groups it recorded. Agents use `dev:bg` and `dev:stop`, never broad process killing. `dev:server` runs `src/platform/node.ts` on Node with watch mode on `PORT_API`; verify calls it directly so it doesn't rotate the user's logs.

## Tool configuration and tests

`docs/guidance/typescript-api/tooling.md` explains the shipped Biome, TypeScript and Vitest configuration; keep its requirements when adapting them. `tests/http-contract.test.ts` implements `docs/acceptance/typescript-api.md`, and verify runs it separately; extend its table for each new endpoint. Use real layers and HTTP boundaries per `docs/guidance/typescript-api/testing.md` and run hook tests for every target agent.

<!-- stacks:when with=ci-github -->
CI sets up Bun from packageManager and Node from .node-version, installs frozen dependencies, then runs lint, typecheck, coverage and the build. Upload logs and coverage on failure. No external credentials are needed.
<!-- stacks:end -->

## Commands and gotchas

The shipped `package.json` wires every declared script; agents query `logs` and `dev:status` before restarting. `start` reads `PORT_API`, else `PORT`, else 3000, and `build` doesn't inline env, so the bundle reads it at runtime. Document command names, logs and hook ownership in AGENTS, plus a Debugging section with `jq` queries over `logs/server.jsonl` (one request by `requestId`, errors only, slow requests).

<!-- stacks:when with=git-hooks -->
If `scripts/prepare.ts`, run by the `prepare` script after every `bun install`, already runs `lefthook install`, don't add another install step. pre-push runs `bun run typecheck` alongside `bun run test`, in parallel.
<!-- stacks:end -->

<!-- stacks:when with=effect -->
The Effect API reference (`docs/guidance/effect/api.md`) also records, under the installed release's names, every HTTP mechanism `effect-api.md` describes by behavior: the API declaration, error status annotations, server-level middleware, the test client, serving on Node and as a web handler.
<!-- stacks:end -->

The server and Vitest run on Node: never `bun test`, never `--bun`, and never run the server under Bun to save a step, because runtime differences hide until deploy. Bun doesn't pass its loaded `.env` to a Node child. Record configuration workarounds with their removal condition. The architecture stays Effect-based even when the optional Effect testing fragment is excluded.
