---
schema_version: 1
id: sveltekit
kind: stack
name: SvelteKit app on Node
description: A full-stack SvelteKit app built with the Node adapter and served by Node, with server load functions, zod-validated form actions, svelte-check, Vitest and a Playwright test against the production build.
tags: [typescript, svelte, web, fullstack, scripts, bun, node]
deps:
  app: [zod]
  dev: [svelte, "@sveltejs/kit", "@sveltejs/adapter-node", "@sveltejs/vite-plugin-svelte", vite, typescript, svelte-check, "@types/node", eslint, "@eslint/js", eslint-plugin-svelte, eslint-config-prettier, typescript-eslint, globals, prettier, prettier-plugin-svelte, vitest, "@vitest/coverage-v8", jsdom, "@testing-library/svelte", "@testing-library/jest-dom", "@testing-library/user-event", "@playwright/test"]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version and engines.node. Node runs Vite, svelte-check, Vitest, Playwright and the built server; Bun installs and runs scripts."
  - "Styling: scoped component styles plus the shipped global stylesheet (default)."
  - "Formatter: the shipped Prettier config and Svelte plugin (default), checked by lint; .editorconfig uses matching tabs."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github]
  optional: [rr, ce-plugin, drizzle-postgres]
env:
  PORT_WEB: "3000"
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run test }
  - { name: build, layer: build, run: bun run build }
  - { name: e2e, layer: test, run: bun run e2e }
  - name: web
    phase: serve
    layer: serve
    run: "PORT=${PORT_WEB} bun run start"
    expect: { http: "http://localhost:${PORT_WEB}/api/health", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  dev: Run the Vite development server
  build: Build the Node server with the Node adapter
  start: Serve the production build on Node (PORT, default 3000)
  typecheck: Sync SvelteKit's generated types, then run svelte-check
  lint: Run the Prettier check and ESLint
  format: Apply Prettier formatting
  test: Run Vitest once
  test:watch: Watch Vitest tests
  coverage: Run Vitest with coverage
  e2e: Build, then run the Playwright tests against the Node server
  check: Run lint, typecheck, tests and e2e
  clean: Remove build, generated and test output
  prepare: Sync SvelteKit's generated types; outside CI, install git hooks and the Playwright browser
---


## What stacks wrote

An items page with a server load, zod-validated form action, enhanced form and in-memory service; a live JSON health endpoint, safe API error envelope, request logging hook and error page; adjacent Vitest tests and Playwright tests against the Node build. The configs, scripts and guidance under `docs/guidance/sveltekit/` are part of the slice. Read the code before extending it.

## Layout

Routes stay in `src/routes/`, shared schemas and components in `src/lib/`, and state or external I/O in `src/lib/server/`. Tests sit beside their code; `tests/` holds shared test helpers and hook tests, and `e2e/` covers the production server.

## Setup

1. Add the declared app dependency with `bun add zod` and every dev dependency with `bun add -d`, resolving current releases. Check SvelteKit, svelte-check and typescript-eslint's installed TypeScript peer ranges; install the newest TypeScript release inside their intersection. Do not add a generator or replace the shipped files.
2. Run `bun run format` once to format the composed harness, then `bun run lint`, `bun run typecheck`, `bun run test` and `bun run e2e`. Update shipped code or config the installed releases reject, preserving every check and lint rule. Read installed declarations first, then the matching svelte.dev docs, before adapting an API from memory.
3. Record current Node LTS in `.node-version` and `engines.node`, Bun in `packageManager`, and resolved toolchain versions in AGENTS.md. List any peer-range constraint and when to remove it under Build workarounds.
4. Fill README's markers with actual commands and settings. Fill AGENTS.md and the harness docs from the composed project, linking `docs/guidance/sveltekit/index.md`. Run `stacks verify` until green.

## Conventions

- `+page.server.ts` validates every form POST through `parseItem`, returns expected failures with `fail(400, ...)`, and awaits the service. Successful writes redirect with 303 so reloading a plain form submission cannot repeat it. Keep submitted values and field errors together.
- `AddItemForm.svelte` works without JavaScript. Its enhance callback disables submission while pending and calls the kit's default update so load reruns after a write.
- Components receive data as props and never import server modules. Only server modules read private runtime settings or perform I/O; `src/env.ts` declares and validates the private `APP_TITLE` setting.
- `items.ts` keeps its shared store on `globalThis` across dev reloads. This data is shared by every user and disappears on restart; per-user data belongs in locals, cookies or persistent storage.
- `hooks.server.ts` generates request IDs and writes structured logs with method, route pattern, status and duration. Never log submitted values, query strings, cookies or credentials. Unexpected errors log only their class and request ID.
- The hook maps failed `/api/` responses to `{error:{code,message,requestId}}` through `server/errors.ts`. `+error.svelte` shows a status and fixed safe text. Preserve those boundaries when adding routes.
- Live routes render per request; do not prerender the page, health endpoint or their layouts.

## Tool configuration

`vite.config.ts` owns the Node adapter and SvelteKit config. The installed kit rejects a separate `svelte.config.js`. Package imports define `#lib/*`; route types still come from `./$types`. TypeScript extends `$app/tsconfig`, generated by `svelte-kit sync`; keep strictness, `noUncheckedIndexedAccess` and the includes for app code, tests, scripts and hooks.

`lint` checks Prettier and ESLint's flat config, including eslint-plugin-svelte. `typecheck` runs svelte-check with warnings treated as failures. Plain tsc skips components. Vitest separates Node server tests from jsdom components, enabling browser resolution only in the component project. Keep `tests/db/` out of the base test suite; a database config must replace the server project's includes too.

`scripts/e2e.ts` builds with the exact test origin, runs Playwright, and restores the normal build in a finally block, including after a failed test. Playwright uses Chromium, one worker, CI forbidOnly, failure traces and a fresh server on `PORT_E2E` (default 3100). The separate `web` probe uses `PORT_WEB` (default 3000). Set these before running checks when their ports are occupied.

## Testing

Adjacent Vitest tests cover config defaults and validation, schema errors, isolated service state, direct actions with real FormData requests, safe error handling and component rendering. New behavior gets tests through those same public boundaries; do not mock the service.

`e2e/items.spec.ts` proves server-rendered seed data, enhanced validation and writes without a document navigation, reload persistence, the JavaScript-disabled path, live health headers, safe API errors, the 404 page and cross-origin POST rejection. Tests use localhost only and no .env.

<!-- stacks:when with=drizzle-postgres -->
The database fragment replaces the service behind the existing async exports. Move service and action tests to its real-database suite and remove the reset helper. Keep schema and component tests Docker-free. Health becomes database-independent liveness without the item count; adapt its browser schema while keeping status, no-store and request-ID assertions. Readiness goes at `/api/ready`; the hook preserves its 503 `{"status":"unavailable"}` body while adding the same headers. Test that response through the hook as well as the repository.
<!-- stacks:end -->

<!-- stacks:when with=ci-github -->
CI reads Bun from packageManager and Node from .node-version, installs frozen dependencies, runs lint, typecheck and coverage, installs Chromium with system dependencies, then runs e2e. Upload Playwright reports and test results on failure.
<!-- stacks:end -->

## Commands

The shipped package scripts match the declared commands. `start` runs `node build`; `prepare` syncs generated types and, outside CI, installs hooks when lefthook.yml exists and downloads Chromium. `clean` removes generated app and test output. Mirror scripts in AGENTS.md with a scoped example: `bun run test src/lib/item-schema.test.ts`.

<!-- stacks:when with=git-hooks -->
The prepare script already installs lefthook when configured. pre-commit formats and lints staged files, including Svelte; pre-push runs typecheck and test in parallel.
<!-- stacks:end -->

## Gotchas

- The public origin is a build-time setting. `APP_ORIGIN` overrides the default `http://localhost:<PORT_WEB>`; use the actual public origin for deployment and rebuild after any port or origin change. Never disable CSRF checks, trust every origin, or trust forwarding headers without a proxy that overwrites them.
- `node build` does not load .env. Pass production settings as real environment variables. `APP_TITLE` is validated at server startup and defaults to Items.
- Use the newest TypeScript release supported by all installed peer ranges. Drop this resolution constraint when those tools support the newest compiler and its JavaScript API.
- `.svelte-kit/` and the kit's files under node_modules are generated. Run install or typecheck when types are missing; never edit generated files.
- The type-check-on-write hook runs plain tsc, so it cannot replace svelte-check.
- Keep load functions and form actions when adapting a release that offers newer data APIs.
- Never force `--bun` on Vite, Vitest or Playwright, and never substitute `bun test` for Vitest.
