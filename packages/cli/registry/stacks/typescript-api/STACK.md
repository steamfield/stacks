---
schema_version: 1
id: typescript-api
kind: stack
name: TypeScript HTTP API with Effect
description: A Node HTTP API on Effect's HttpApi, with schema-first REST resources, tagged errors mapped through one status table, structured request logs, a platform-free core that also runs as a web fetch handler, Vitest through real HTTP, and a small proving slice.
tags: [typescript, api, effect, node, bun, scripts]
deps:
  app: [effect, "@effect/platform-node"]
  dev: [typescript, "@biomejs/biome", vitest, "@vitest/coverage-v8", "@types/node", "@types/bun"]
tools: [bun, node, git, ps, lsof]
decisions:
  - "Node version: current LTS (default), recorded in .node-version and engines.node; Node runs the server and Vitest, Bun installs and runs scripts."
merge: [.claude/settings.json, .codex/hooks.json]
fragments:
  required: [claude-harness]
  default: [claude-harness-docs, git-hooks, ci-github, effect, rest-api]
  optional: [rr, ce-plugin, docker-deploy, openrouter-ai, effect-sql-postgres, effect-otlp, code-docs]
env:
  PORT_API: "3000"
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run coverage }
  - { name: http-contract, layer: test, run: bun run test tests/http-contract.test.ts }
  - { name: build, layer: build, run: bun run build }
  - name: dev-cycle
    layer: check
    timeout: 3m
    run: "if bun run dev:status >/dev/null 2>&1; then echo 'A dev server is running; stop it first: bun run dev:stop' >&2; exit 1; fi; bun run dev:bg && bun run dev:stop"
  - name: api
    phase: serve
    layer: serve
    run: "bun run dev:server"
    expect: { http: "http://localhost:${PORT_API}/healthz", within: 60s }
  - name: readme-filled
    layer: check
    tags: [hygiene]
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
  coverage: Run Vitest with coverage floors
  check: Run lint, typecheck, coverage and the build, as CI does
  audit: Check dependencies for published advisories (bun audit; needs the network)
  clean: Remove project build, test and log output
  prepare: Install project hooks outside CI
---

# TypeScript HTTP API with Effect

## What stacks wrote

A working API written against an earlier Effect release; Setup step 2 brings it to the installed one. `src/platform/node.ts` is the only entry and `src/app.ts` the platform-free app with its request middleware. The health resource runs through every layer (`src/api/`, `src/handlers/`, `src/services/`, `src/schemas/`) over `config.ts`, `errors.ts` and `logging.ts`: `GET /healthz`, `POST /v1/health-checks/:checkId` for decode, size and media-type cases, and `/openapi.json`. `tests/http-contract.test.ts` runs the matrix in `docs/acceptance/typescript-api.md` on a Node listener and the web fetch handler; `scripts/` holds the dev server tooling and its tests. `docs/guidance/typescript-api/index.md` links the guidance for Effect, testing, tooling and verification. Read the code before extending it; a new resource copies the health files' shape.

## Setup

1. Run the brief's install commands, then check peer ranges and pin `@types/node` to the `.node-version` major. Write Node LTS to `.node-version` and `engines.node`, and the current Bun to `packageManager`.
2. Run `bun run check`. The shipped code and configs were written against an earlier Effect release: where the installed one renamed or moved an API, update the code to it, following `docs/guidance/typescript-api/effect-api.md` to find the current mechanism. Never loosen a test or a coverage floor to fit.
3. If the installed Node can't run `node src/platform/node.ts` without a flag, add it to the scripts and record it under Build workarounds with its removal condition.
4. Fill README and AGENTS for this base before adding any resource.

## Conventions

- Resources live under `/v1` unless the project chose no prefix; `/healthz` and `/openapi.json` stay outside it. A wrong method gets the 404 envelope. Every error body is `{ "error": { "tag", "message", "retryable" } }`.
- A new failure is a tagged error, its `apiErrorTable` row and its status annotation, added together.
- Only `src/platform/` imports Node, Bun or `@effect/platform-node` or touches `process`, and nothing in `src/` uses `console`; `biome-plugins/boundaries.grit` enforces both. Core code uses Effect's `FileSystem`, `Path` and `HttpClient` services, so the same app runs as a web fetch handler.
- A new setting goes in `config.ts`, `.env.example` and the README's Configuration section.
- When adapting the Biome, TypeScript or Vitest config, keep the rules `tooling.md` lists.

## Testing

Each new endpoint extends the table in `tests/http-contract.test.ts`, so it runs on both transports with real layers. Run one test with `bun run test tests/http-contract.test.ts -t "accepts the proving payload"`. `bun run coverage` enforces the floors in `vitest.config.ts`; never lower them.

<!-- stacks:when with=ci-github -->
CI sets up Bun from `packageManager` and Node from `.node-version`, installs frozen dependencies, then runs `bun run check`. Upload logs and coverage on failure. No external credentials are needed.
<!-- stacks:end -->

## Commands

Agents run the server with `bun run dev:bg` (reuses a healthy one, including a foreground `bun run dev`, which `dev:stop` also stops; logs to `logs/dev.log`) and `bun run dev:stop`, read `bun run dev:status` and `bun run logs` before restarting, and never kill server processes by name. `build` doesn't inline env (`--env=disable`), so the bundle reads it at runtime; keep the flag.

Document the commands, logs and hook ownership in AGENTS, plus a Debugging section with `jq` queries over `logs/server.jsonl` (one request by `requestId`, errors only, slow requests).

<!-- stacks:when with=git-hooks -->
If `scripts/prepare.ts`, run by the `prepare` script after every `bun install`, already runs `lefthook install`, don't add another install step. pre-push runs `bun run typecheck` alongside `bun run test`, in parallel.
<!-- stacks:end -->

<!-- stacks:when with=effect -->
The Effect API reference (`docs/guidance/effect/api.md`) also records, under the installed release's names, every HTTP mechanism `effect-api.md` describes by behavior: the API declaration, error status annotations, server-level middleware, the test client, serving on Node and as a web handler.
<!-- stacks:end -->

## Gotchas

- The server and Vitest run on Node: never `bun test`, never `--bun`, and never run the server under Bun to save a step, because runtime differences hide until deploy.
- Bun doesn't pass its loaded `.env` to a Node child, so the Node scripts load it with `--env-file-if-exists`.
- The `dev-cycle` verify step starts and stops the background server, so it moves the last run's logs to `logs/*.prev.*`, and it fails while a dev server from this checkout is running. The `api` serve step calls `dev:server` directly.
- The architecture stays Effect-based even when the `effect` fragment is excluded.
