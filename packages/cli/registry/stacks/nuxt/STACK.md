---
schema_version: 1
id: nuxt
kind: stack
name: Nuxt app on Node
description: A full-stack Vue app on Nuxt served by Node, with server API routes, a page that loads them with useFetch, a zod-validated form with field errors, typed runtime config, ESLint, Vitest in Nuxt's test environment and a Playwright test against the production server.
tags: [typescript, vue, nuxt, web, fullstack, scripts, bun, node]
deps:
  app: [nuxt, vue, vue-router, zod]
  dev: [typescript, vue-tsc, "@types/node", "@nuxt/eslint", eslint, prettier, vitest, "@vitest/coverage-v8", "@nuxt/test-utils", "@vue/test-utils", happy-dom, "@playwright/test"]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version and engines.node. Node runs Nuxt, Vitest, Playwright and the built server; Bun installs and runs scripts."
  - "Styling: scoped component styles plus the shipped global stylesheet (default), or a CSS module such as Tailwind when the person asks for it, added the way its Nuxt module docs describe."
  - "Formatter: Prettier with the shipped 100-column config and ignore file (default), checked by lint."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github]
  optional: [rr, ce-plugin]
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
  dev: Run the Nuxt development server
  build: Build the Node server into .output/
  start: Serve the production build on Node (PORT, default 3000)
  typecheck: Run nuxt typecheck (vue-tsc over the app, server, shared code and tools)
  lint: Run ESLint and the Prettier check
  format: Apply Prettier formatting
  test: Run Vitest once (unit and Nuxt-environment projects)
  test:watch: Watch Vitest tests
  coverage: Run Vitest with coverage
  e2e: Build, then run the Playwright tests against the production server
  check: Run lint, typecheck, tests and e2e
  clean: Remove generated, build and test output
  prepare: Run nuxt prepare; outside CI, install git hooks and the Playwright browser
---

# Nuxt app on Node

## What stacks wrote

A working Nuxt slice in the `app/` layout: `app.vue` with the default layout, a notes page that loads `/api/notes` with `useFetch` during server rendering, a form component that posts to a zod-validated route and shows its field errors, and the error page. On the server, `server/api/` holds the notes, health and unknown-path routes, `server/utils/` the process-local notes store, the validated runtime config and a JSON-lines logger, and `server/plugins/request-log.ts` request IDs and one log line per request. `shared/schemas/note.ts` is the schema both sides use. Unit tests sit beside the code, component tests run in Nuxt's test environment, and Playwright tests the built server. The configs, package scripts and `docs/guidance/nuxt/` ship too; read the code before extending it.

Read `docs/guidance/nuxt/index.md` and link it from AGENTS.md.

## Look up the installed release first

Nuxt moved app code under `app/` in its current major, and model memory often writes the older root layout, Nuxt 3 config keys or old test-utils setup. Look things up in this order: installed declarations (`node_modules/nuxt/dist/`, `node_modules/@nuxt/test-utils/dist/`, `.nuxt/imports.d.ts`), then the matching nuxt.com page for the installed major, then memory last.

## Layout

- `app/`: `app.vue`, `layouts/`, `pages/`, `components/`, `error.vue` and `assets/`. Composables go in `app/composables/`, auto-imported.
- `server/api/`: one file per route and method; `server/utils/` (auto-imported into server code): state, config, logging; `server/plugins/`: Nitro lifecycle hooks.
- `shared/`: code both sides import as `#shared/...`; it imports neither `app/` nor `server/`.
- Tests beside the code (`*.test.ts`); `e2e/` for Playwright; `tests/` for harness hook tests and helpers.
- `scripts/prepare.ts`: runs `nuxt prepare`, then git hooks and Chromium outside CI.

## Setup

1. Add every declared app dependency with `bun add` and every dev dependency with `bun add -d`, resolving current releases. vue-tsc needs TypeScript's JavaScript API, which the newest TypeScript major may not ship: install the newest TypeScript release vue-tsc can load (`bun run typecheck` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` from vue-tsc when it can't). Match `@types/node` to the chosen Node major. No generator is needed; keep the shipped files.
2. Set `compatibilityDate` in `nuxt.config.ts` to today's date, as Nuxt asks, so Nitro and Nuxt behave as they do in the release you installed. Run `bun install` once more if the first `bun add` reported that `nuxt prepare` failed (it runs before `@nuxt/eslint` is installed).
3. Run `bun run format` once to format the composed harness files, then `bun run lint`, `bun run typecheck`, `bun run test` and `bun run e2e`. Update shipped code or config the installed releases reject, preserving every check, lint rule and assertion; read the installed declarations first.
4. Record current Node LTS in `.node-version` and `engines.node`, Bun in `packageManager`, and resolved tool versions plus the TypeScript constraint and when to drop it in README.
5. Fill README's `stacks:fill` markers and AGENTS.md with the actual commands, a scoped test example and the app/server boundary, linking the guidance. Fill the harness docs when present. Run `stacks verify` until green. If a default port is busy, choose free `PORT_WEB` and `PORT_E2E` values in verify's environment.

## Conventions

- Pages read server data with `useFetch` and an explicit `key`, and call its `refresh()` after a write; writes and user-triggered calls use `$fetch` inside handlers. App code never imports from `server/` and never reads `process.env`.
- Every route validates its body or query with the shared zod schema (`readValidatedBody(event, (b) => Schema.safeParse(b))`), throws `createError` with a status and `data.fields` for expected failures, and returns `{ <resource> }`. The form shows the server's field messages; it doesn't repeat the rules.
- `runtimeConfig` in `nuxt.config.ts` declares every setting with its default; private keys stay top level, `public` holds only what the browser may see. `serverConfig()` validates it once with zod. A new setting gets a default, a schema field, an `.env.example` line and a test.
- `log()` writes JSON lines with a fixed field list: never bodies, query strings, cookies, headers or error messages. The request plugin logs one line per request, including thrown errors, and an unexpected error's class only.
- `error.vue` shows the status and fixed text, never `error.message`.
- `server/utils/notes.ts` is process-local, shared by every user and lost on restart. Replace it behind the same async functions; keep its reset test-only.
- Don't add explicit imports for what Nuxt auto-imports (Vue, composables, `server/utils`). Imports that aren't auto-imported are explicit.

## Tool configuration

`nuxt.config.ts` registers the `@nuxt/eslint` module, which writes `.nuxt/eslint.config.mjs` on prepare; `eslint.config.mjs` imports it as `#nuxt-eslint` (the `imports` map in `package.json`; keep that name) and extends it with ignores and turns off only `vue/html-self-closing`, which conflicts with Prettier. `lint` runs ESLint with zero warnings, then the Prettier check.

`tsconfig.json` references Nuxt's generated app, server, shared and node configs plus `tsconfig.tools.json` (configs, scripts, e2e, hook tests and hooks). Keep all five references; `typecheck` is `nuxt typecheck`, which runs `vue-tsc -b` over them. Strict mode and unchecked index access come from Nuxt's generated configs.

`vitest.config.ts` has two projects: `unit` (Node) for `shared/`, `server/` and `tests/`, with the `#shared` alias, and `nuxt` (`defineVitestProject`, happy-dom) for `app/`. Keep `tests/db/` out of `unit`. Playwright uses Chromium, one worker, CI forbidOnly, failure traces and a fresh built server on `PORT_E2E` (default 3100); the separate `web` probe uses `PORT_WEB` (default 3000).

## Testing

Unit tests cover the schema's messages, the store's isolation, config defaults and rejection without echoing values, and log records. Component tests mount the form and error page with `mountSuspended` and stand in for the route with `registerEndpoint`. `e2e/notes.spec.ts` proves server-rendered seed data, a rejected empty note with its field error and no write, a write that refreshes the list, reload persistence, health with no-store and a request ID, the 400 body with `data.fields`, a JSON 404 for an unknown API path and the error page for an unknown page. New behavior gets tests at the same boundaries; don't mock our own modules.

<!-- stacks:when with=ci-github -->
CI reads Bun from packageManager and Node from `.node-version`, installs frozen dependencies (which runs `nuxt prepare` through the prepare script), runs lint, typecheck and coverage, installs Chromium with system dependencies, then runs e2e. Upload Playwright reports and test results on failure.
<!-- stacks:end -->

## Commands

The shipped package scripts match the declared commands. `start` runs `node .output/server/index.mjs`; `prepare` runs the shipped helper after every install. Mirror scripts in AGENTS.md with a scoped example: `bun run test server/utils/notes.test.ts`.

<!-- stacks:when with=git-hooks -->
The prepare script already runs `lefthook install` when its config exists outside CI; don't add another installer. pre-commit formats and lints staged files, including `.vue`; pre-push runs typecheck and test in parallel.
<!-- stacks:end -->

## Gotchas

- `.nuxt/` is generated by `nuxt prepare` (install, typecheck, build and dev run it). Lint, typecheck and the editor fail without it; run `bunx nuxt prepare`, never edit it. `.output/` is the built server.
- The built server doesn't load `.env`. Pass `PORT`, `NUXT_LOG_LEVEL` and `NUXT_PUBLIC_APP_TITLE` as real environment variables; a `NUXT_*` variable only overrides a key `nuxt.config.ts` declares.
- Without `key`, a `useFetch` after a write can show stale data; call `refresh()`.
- A click before hydration hits the server-rendered HTML, not the Vue handler; e2e waits for hydration first.
- The shared typecheck-on-write hook runs plain tsc, which checks nothing through the solution `tsconfig.json`; `typecheck-nuxt-on-write` runs vue-tsc instead.
- Drop the TypeScript constraint once vue-tsc loads the newest TypeScript major.
- Never force `--bun` on Nuxt, Vitest or Playwright, and never substitute `bun test` for Vitest. Run `nuxt dev` and `bun run start` in the background.
