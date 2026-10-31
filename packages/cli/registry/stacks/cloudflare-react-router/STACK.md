---
schema_version: 1
id: cloudflare-react-router
kind: stack
name: React Router on Cloudflare Workers
description: A full-stack React Router app on Cloudflare Workers with server rendering, JSON resource routes, typed bindings and a cron handler slot, plus Tailwind, Biome and integration tests that run in the local Workers runtime.
tags: [typescript, react, web, fullstack, cloudflare, workers, scripts, bun, node]
deps:
  app: [react, react-dom, react-router, tailwindcss, "@tailwindcss/vite"]
  dev: ["@react-router/dev", "@cloudflare/vite-plugin", wrangler, vite, typescript, "@biomejs/biome", vitest, "@cloudflare/vitest-plugin", "@vitest/coverage-istanbul", "@types/node", "@types/react", "@types/react-dom"]
tools: [bun, node, git]
decisions:
  - "Package manager (default: bun)."
  - "Worker name (default: project slug)."
fragments:
  default: [agent-ops, ci-github]
  optional: [cloudflare-d1, git-hooks, ce-plugin]
env:
  PORT_WEB: "5173"
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run test }
  - { name: coverage, layer: test, run: bun run coverage }
  - { name: build, layer: build, run: bun run build }
  - name: web
    phase: serve
    layer: serve
    run: "bun run dev --port ${PORT_WEB} --strictPort"
    expect: { http: "http://localhost:${PORT_WEB}/healthz", within: 90s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  dev: Run React Router in the local Workers runtime
  build: Build the Worker and browser assets
  typecheck: Generate Worker and route types, then run tsc
  lint: Check owned source with Biome
  format: Apply Biome formatting and safe fixes
  test: Run local Workers integration tests
  coverage: Run Workers tests with Istanbul coverage and the framework HTTP tests
  check: Run lint, typecheck, tests, and production build
---

## What stacks wrote

A Workers entry, React Router root layout and safe error boundary, a page whose loader reads the public `GREETING` binding, JSON `/healthz`, and a harmless scheduled-handler slot. The slice includes adjacent Workers tests, real HTTP tests of the built framework, Tailwind, strict TypeScript, Biome, Vite, Wrangler and Vitest configs, plus development and deployment docs. Read the code before extending it.

## Layout

Register new routes in `app/routes.ts`, put their modules in `app/routes/`, and keep server services in `app/.server/`. `workers/app.ts` is the Worker boundary. `workers/scheduled.ts` owns scheduled work and is the separate unit-test entry. Read `docs/DEVELOPMENT.md` for bindings, logging and test boundaries, and `docs/DEPLOYMENT.md` before adding deployment.

## Setup

1. Add every declared app dependency with `bun add` and dev dependency with `bun add -d`, resolving current releases within the Cloudflare integration's peer ranges. Use the declared `@cloudflare/vitest-plugin` and `@vitest/coverage-istanbul`; keep the coverage provider `istanbul` because Workers cannot collect native V8 coverage. No generator is needed.
2. Set the Worker name in `wrangler.jsonc` to the project slug. Add `compatibility_date` using the newest date supported by both installed local runtimes, in Wrangler's date format; it is deliberately absent from the shipped config. Start with today; if the test runtime rejects it, use the newest supported date its error reports. Keep the Cloudflare Vite plugin's `ssr` environment wiring, SSR enabled and Tailwind's Vite plugin. Do not deploy or provision resources.
3. Run `bun run typecheck` to generate binding and route types, then lint, test, coverage and build. If the installed releases reject shipped code or config, update it to those releases without dropping checks, rules, tests or coverage floors. Generated `worker-configuration.d.ts` stays ignored and is never hand-edited. Run `bun run format` after editing setup metadata.
4. Record the supported Node runtime in `.node-version` and `engines.node`, and current Bun in `packageManager`. Vitest and Wrangler run on Node. Put necessary compatibility constraints in AGENTS.md under Build workarounds with a removal condition.
5. Fill README, AGENTS.md and selected adapter documents from the finished project, including CI and pending Cloudflare setup. Run `stacks verify` and `bun run check` until green.

## Conventions

- Loaders receive typed bindings through `context.get(cloudflareContext)`; return only public page data. Keep binding validation in `app/.server/` like `greeting.ts`. Worker code never reads `process.env`.
- Use the shipped root boundary's fixed messages. Exception details, URLs, secrets and the full environment never go into HTML or logs. `workers/app.ts` logs fixed request fields and `app/entry.server.tsx` owns server error logging.
- Local secrets go in ignored `.dev.vars`, public configuration in Wrangler vars. Workers use web APIs, never log files, child processes or a Node HTTP server.
- Scheduled work accepts bindings and scheduled time, and propagates rejections. Use `waitUntil` only when its lifetime semantics fit the operation. Leave cron triggers unset until the application chooses a job and schedule.

## Testing and commands

The shipped scripts are the command contract: `dev`, `build`, `typecheck`, `lint`, `format`, `test`, `coverage` and `check`. Typecheck generates Worker and route types before strict `tsc`, including unchecked-index checks and no emit. Keep Biome's recommended rules, organized imports, Tailwind parser and generated-output exclusions when adapting it.

`test` and `coverage` build first. Vitest runs adjacent binding and scheduled-work tests in the local Workers runtime; its Node project starts local Wrangler against the built Worker and tests the page, resource route, error boundary, CSS and scheduled export over HTTP. Extend both boundaries for new routes and services. Tests need no account or credentials, own their temporary persistence and stop their servers. Coverage instruments the service and scheduled work with Istanbul; HTTP tests prove framework wiring. Never substitute a response stub, `bun test` or `--bun`.

<!-- stacks:when with=cloudflare-d1 -->
Keep `/healthz` and the `web` probe database-free; the fragment adds `/readyz` for the database. If `tests/http.test.ts` still starts its servers through one `start()` helper, migrate each server's persistence directory there with `migrateLocalD1` before `wrangler dev` starts, and keep both test servers.
<!-- stacks:end -->

<!-- stacks:when with=ci-github -->
CI reads Bun from packageManager and Node from .node-version, installs frozen dependencies, then runs lint, typecheck, coverage and build through the shipped scripts. Keep deployment separate per `docs/DEPLOYMENT.md`.
<!-- stacks:end -->

## Gotchas

- Framework virtual modules do not belong in the unit Workers pool. Keep its separate scheduled entry and the real HTTP test of the built framework.
- Cloudflare bindings are not Node environment variables. Never expose secrets through `VITE_` variables or serialize the environment into loader data.
- Regenerate types after adding bindings or routes. Ignore generated declarations, route types, build output, `.wrangler/`, secrets and dependencies.
- Deployment requires the user's Cloudflare account and credentials. Cloud resources, domains, production bindings and enabling cron belong under Pending user actions.
