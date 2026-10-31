---
schema_version: 1
id: astro-fullstack
kind: stack
name: Astro site + Effect API
description: A Bun workspace with a static Astro site (React islands, Tailwind), a Node API on Effect's HttpApi and a shared contract package, so islands call the API through a typed client. The API can also serve the built site.
tags: [typescript, api, effect, node, astro, react, web, fullstack, monorepo, bun, scripts]
deps:
  contract: [effect]
  api: [effect, "@effect/platform-node"]
  web: [astro, "@astrojs/react", react, react-dom, tailwindcss, "@tailwindcss/vite", effect]
  web-dev: ["@astrojs/check", "@types/react", "@types/react-dom", happy-dom, "@testing-library/react", "@testing-library/dom", "@testing-library/jest-dom"]
  root-dev: [typescript, "@biomejs/biome", vitest, "@vitest/coverage-v8", "@types/node", "@types/bun"]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version and engines.node; Node runs the API and Vitest, Bun installs and runs scripts."
  - "Serve the built site from the API process (default: yes, through STATIC_DIR, one origin for pages and API); or host apps/web/dist separately behind the same origin."
  - "Production site URL for canonical links (default: https://example.com)."
merge: [.claude/settings.json, .codex/hooks.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github, effect, rest-api]
  optional: [rr, ce-plugin, effect-sql-postgres, effect-otlp]
env:
  PORT_API: "3000"
  PORT_WEB: "4321"
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run test }
  - { name: http-contract, layer: test, run: bun run test --project api apps/api/tests/http-contract.test.ts }
  - { name: build, layer: build, run: bun run build }
  - name: api
    phase: serve
    layer: serve
    run: "bun run dev:api"
    expect: { http: "http://localhost:${PORT_API}/healthz", within: 60s }
  - name: web
    phase: serve
    layer: serve
    run: "bun run dev:web"
    expect: { http: "http://localhost:${PORT_WEB}/", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  dev: Run the API and the site in the foreground and preserve logs
  dev:api: Run the API from source on Node, restarting on change
  dev:web: Run the Astro dev server, proxying API paths to the API
  dev:bg: Start or reuse this checkout's background API and site
  logs: Query development records with filters or JSON output
  dev:status: Report checkout server health and log problems
  dev:stop: Stop this checkout's background API and site
  build: Bundle the API into apps/api/dist and build the site into apps/web/dist
  start: Run the built API, serving the built site when STATIC_DIR is set
  typecheck: Type-check the contract, the API, the tooling and the site (astro check)
  lint: Run Biome checks
  format: Apply Biome formatting and safe fixes
  test: Run every Vitest project
  test:watch: Watch Vitest tests
  coverage: Run Vitest with coverage
  check: Run lint, typecheck, tests and the build
  clean: Remove build, test and log output in every workspace
  prepare: Install project hooks outside CI
---

## What stacks wrote

A Bun workspace with a shared Effect HTTP contract, a Node API and a static Astro site with a React island. The API ships health and payload endpoints, configuration, the error table, safe structured logging, global request middleware and static-file serving; the site shows live API status through the contract client. Source, tests, tool configs, development scripts and guidance are present; read the code before extending it.

Read `docs/guidance/astro-fullstack/index.md` before implementation; it supplies the shared guidance for every selected agent.

## Layout

- `packages/contract/index.ts` is the public entry for `src/api.ts`, `src/groups/health.ts`, schemas and errors. It imports only Effect.
- `apps/api/src/` holds `app.ts`, `config.ts`, `logging.ts`, `handlers/`, `services/` and the only runtime entry, `platform/node.ts`.
- `apps/api/tests/http-contract.test.ts` runs the HTTP acceptance matrix on Node and web transports. Configuration, error and logging unit tests sit beside their source; platform tests and HTTP helpers stay in `tests/`.
- `apps/web/src/` holds `layouts/BaseLayout.astro`, `pages/index.astro`, `pages/404.astro`, `islands/ApiStatus.tsx` with its test, `lib/api.ts` and Tailwind styles.
- Root package scripts, TypeScript and Vitest projects configure the workspace; `biome.json` loads `biome-plugins/boundaries.grit`. `scripts/` owns development servers and logs; `tests/hooks/` checks the scripts and agent hooks.

Workspaces use fixed internal names `@app/contract`, `@app/api` and `@app/web`. Application imports cross only the contract's public `packages/contract/index.ts`, using relative paths so Node can load source without workspace transpilation. The site never imports the API.

Read `docs/api-foundation.md` for lint, testing and development requirements.

## Setup

1. Add the declared dependencies to their named workspaces with `bun add` or `bun add -d`. Put `web-dev` in `apps/web`, `root-dev` and fragments' `dev` at root, Vitest in each workspace too, and Effect at root for the boundary probes. Check peer ranges and resolve current compatible releases; align Effect packages together. Install the newest TypeScript within `@astrojs/check`'s supported peer range.
2. Run lint, typecheck, test and build. Update shipped code or config the installed releases reject, using their declarations and docs; keep every check, lint rule and assertion. No generator is needed. Confirm Node runs `apps/api/src/platform/node.ts` with type stripping; if a flag is needed, add it to the scripts and record it under Build workarounds.
3. Record current Node LTS in `.node-version` and `engines.node`, and the installed Bun in `packageManager`; match `@types/node` to the Node major. Record release workarounds with their removal conditions.
4. Set `site` in `apps/web/astro.config.mjs` to the chosen production URL. Fill README and AGENTS for this base, including the harness documentation's markers, before adding a resource. Run `stacks verify` until green, then `stacks verify --all`.

## Conventions

- Copy the health resource's contract, handler and service shape. Follow `docs/guidance/astro-fullstack/effect-api.md` and the `rest-api` rule.
- Keep `app.ts` platform-free; both transports must pass the same matrix.
- Add settings through `config.ts`, `.env.example` and README; build layers once at the platform entry.
- Build pages without a running API; islands use `lib/api.ts`. Add server rendering only after asking.
- Use Tailwind and accessible HTML. Follow `docs/guidance/astro-fullstack/astro.md` for proxies and browser settings.
- Resolve `STATIC_DIR` against the repository root. API paths retain their envelopes; site misses use `404.html`. Logs never include bodies or credentials.

## Testing

`vitest.config.ts` names `api`, `web` and `hooks` projects. The HTTP suite implements `docs/acceptance/astro-fullstack.md`: real Node listeners and the web handler, fresh layers, safe error bodies and logs, request ids, payload limits and static files. Extend it with new endpoints. The island's Testing Library tests replace only fetch and return contract-encoded bodies; never mock the client or contract. `bun run build` integrates every Astro route and bundles the Node entry. Keep the coverage floors in `docs/api-foundation.md`. Follow `docs/guidance/astro-fullstack/testing.md`.

<!-- stacks:when with=ci-github -->
CI sets up Bun from packageManager and Node from .node-version, installs frozen dependencies, then runs lint, typecheck, coverage and the build. No credentials are needed.
<!-- stacks:end -->

## Commands and gotchas

Follow `docs/guidance/astro-fullstack/development.md` for process ownership and logs; document commands in AGENTS.md.

<!-- stacks:when with=git-hooks -->
The shipped `scripts/prepare.ts` already runs `lefthook install` after every `bun install` (skipped in CI or without lefthook), so don't add another install step. pre-push runs `bun run typecheck` alongside `bun run test`.
<!-- stacks:end -->

<!-- stacks:when with=effect -->
The generated Effect skill records the HTTP mechanisms in `effect-api.md` and `astro.md` against the installed release.
<!-- stacks:end -->

The API and Vitest run on Node: never `bun test`, never `--bun`. Bun doesn't pass its loaded `.env` to a Node child. `dev:web` passes `--ignore-lock` to prevent Astro backgrounding itself under an agent. Delete `apps/web/.astro/` for stale generated types. Drop the TypeScript compatibility workaround once `@astrojs/check` supports the current major. Build-time switches use Astro's env schema, not secret `PUBLIC_` values.
