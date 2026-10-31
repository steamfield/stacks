---
schema_version: 1
id: react-vite
kind: stack
name: React SPA on Vite
description: A browser-only React single-page app built with Vite and served as static files, with React Router, TanStack Query over a typed fetch client with zod, Biome, Vitest with Testing Library and MSW, and Playwright tests of the built site.
tags: [typescript, react, web, static, spa, scripts, bun, node]
deps:
  app: [react, react-dom, react-router, "@tanstack/react-query", zod]
  dev: [vite, "@vitejs/plugin-react", typescript, "@types/node", "@types/react", "@types/react-dom", "@biomejs/biome", vitest, "@vitest/coverage-v8", happy-dom, "@testing-library/react", "@testing-library/dom", "@testing-library/jest-dom", "@testing-library/user-event", msw, "@playwright/test"]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version. Node runs Vite, Vitest and Playwright; Bun installs and runs scripts."
  - "API base URL: /api on the same origin (default), with the host or a dev proxy forwarding it to the API. An absolute URL (VITE_API_URL) instead needs the API to allow this origin with CORS and expose x-request-id."
  - "Styling: one plain stylesheet (default), or Tailwind CSS when the person asks for it, set up the way the installed Vite plugin docs describe."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github]
  optional: [rr, ce-plugin, posthog]
env:
  PORT_WEB: "4173"
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
    run: "bun run preview --port ${PORT_WEB} --strictPort"
    expect: { http: "http://localhost:${PORT_WEB}/", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  dev: Run the Vite development server
  build: Build the static site into dist/
  preview: Serve dist/ locally, with index.html for unknown paths
  typecheck: Run tsc over the app, tests and configs
  lint: Run Biome checks, including the boundary plugin
  format: Apply Biome formatting and safe fixes
  test: Run Vitest once
  test:watch: Watch Vitest tests
  coverage: Run Vitest with coverage
  e2e: Build, then run the Playwright tests against vite preview
  check: Run lint, typecheck, tests and e2e
  clean: Remove build, test and coverage output
  prepare: Install git hooks and the Playwright browser outside CI
---

# React SPA on Vite

## What stacks wrote

A client-side React app with one payload, an items list and detail page fed by an external API. `src/main.tsx` parses config and mounts the providers; `src/config.ts` validates the `VITE_*` settings with zod; `src/api/` is the only code that calls `fetch`, decoding each response with a zod schema and rejecting with a typed `ApiError`; `src/logging.ts` writes structured console records; `src/app/` holds the routes, layout and error page. Unit and component tests run on Vitest with MSW standing in for the API, and Playwright tests the built site with the API routed in the browser. The configs, package scripts, a Biome boundary plugin and `docs/guidance/react-vite/` ship too. Read the code before extending it.

Link `docs/guidance/react-vite/index.md` from AGENTS.md.

## Layout

- `src/api/`: client, errors, query client, and one module per resource (schema plus `queryOptions`).
- `src/app/`: `routes.tsx` (every route), `layout.tsx`, `route-error.tsx`, `services.tsx` (the API client and logger in context).
- `src/features/<name>/`: pages. `src/components/`: shared UI such as `ErrorState`.
- `tests/`: MSW server, fixtures shared with Playwright, the `renderRoute` helper, and the Grit probes. `e2e/`: Playwright. `biome-plugins/boundaries.grit`: the boundary rules.

## Setup

1. Add every declared app and dev dependency at its current release with `bun add` and `bun add -d`, checking peer ranges. Match `@types/node` to the chosen Node major. No generator is needed; keep the shipped source, tests and configs.
2. Run `bun run lint`, `bun run typecheck`, `bun run test` and `bun run e2e`. Where an installed release rejects shipped code or config (a renamed API, a moved option), update it from that release's docs or declarations, keeping every check, lint rule and assertion. `prepare` installs Chromium after `bun install` outside CI.
3. Record the Node LTS in `.node-version`, Bun in `packageManager`, and the installed versions of Vite, React, React Router and TypeScript in the README.
4. Fill the README's `stacks:fill` markers and AGENTS.md (commands, a single-file test example, the boundaries, the guidance link), then run `stacks verify` until green. If a default port is busy, set free `PORT_WEB` and `PORT_E2E` values in verify's environment.

## Conventions

The shipped code keeps these; new code does too. `docs/guidance/react-vite/app.md` has the detail.

- Only `src/api/` calls `fetch`, only `src/config.ts` reads `import.meta.env`, and only `src/logging.ts` touches `console`. The Grit plugin fails lint on a break, and `tests/boundaries.test.ts` proves each rule fires.
- Nothing secret goes in a `VITE_*` variable: Vite inlines them into the bundle. A call that needs a key goes through a backend.
- Each endpoint is a zod schema and a `queryOptions` factory in `src/api/`. Pages read with `useQuery`, render pending, error, empty and success states, and never see a raw `Response`.
- Failures are `ApiError` with `kind` `http`, `network` or `decode`. `userMessage` and `isRetryable` in `src/api/errors.ts` are the one status table; extend them with a test row.
- Log events with flat fields (path, status, request id), never bodies, tokens or user input.
- Routes are data-router objects in `src/app/routes.tsx`. Stay in data mode: React Router's framework mode (`@react-router/dev`, server rendering, file routes) is a different stack.
- Biome's recommended rules plus the React domain (hook rules, exhaustive dependencies), import types, no non-null assertions and no floating promises. Keep them when adapting the config.

## Testing

Vitest has two projects: `app` runs `src/**/*.test.{ts,tsx}` on happy-dom with MSW, and `node` runs `tests/**/*.test.ts`, which includes the harness's hook tests. Component tests render real routes with `renderRoute(path)` and change one API answer per test with `server.use(...)`; unhandled requests fail. A new endpoint adds a fixture, a default handler and tests for success, empty, an HTTP error with its request id, and a wrong-shaped body.

`bun run e2e` builds, serves `dist/` with `vite preview` on `PORT_E2E`, and runs Chromium with one worker against routed API responses: list to detail, a deep-link reload, the not-found page and a 500 with its request id. Details in `docs/guidance/react-vite/testing.md`.

<!-- stacks:when with=ci-github -->
CI sets up Bun from `packageManager` and Node from `.node-version`, installs frozen dependencies, runs lint, typecheck and coverage, installs Chromium with its system dependencies, then runs e2e. Upload Playwright reports and test results on failure. No credentials are needed.
<!-- stacks:end -->

## Commands

`package.json` wires every declared command; mirror them in AGENTS.md with a scoped example such as `bun run test src/api/client.test.ts`. `preview` serves the last build, so run `build` first. `clean` removes only build, test and coverage output.

<!-- stacks:when with=git-hooks -->
`scripts/prepare.ts` already runs `lefthook install` when `lefthook.yml` exists outside CI, so don't add another installer. pre-commit runs Biome with fixes on staged files; pre-push runs typecheck and tests.
<!-- stacks:end -->

## Gotchas

- A static host must rewrite unknown paths to `index.html`. `vite preview` does, so a deep-link reload passes locally and then 404s on a host left at its defaults. Configure the rewrite where you deploy.
- Vite reads `.env`, `.env.local` and `.env.[mode]` at build time and bakes the values in; changing one needs a rebuild, and `import.meta.env` types come from `vite/client` in `tsconfig.json`.
- A cross-origin API must send CORS headers and `Access-Control-Expose-Headers: x-request-id`, or the browser hides the request id. A refused CORS request reaches the app as a `network` error.
- Never use `bun test` or `--bun` on Vite, Vitest or Playwright; they run on Node. The guard hook denies them.
- `react-router-dom` is folded into `react-router`; import everything, `RouterProvider` included, from `react-router`.
- MSW in Node answers only requests made in Vitest. Playwright routes the API with `page.route`, so no `mockServiceWorker.js` is generated or shipped.
- `msw` prints a warning and fails the test for a request no handler covers; add the handler instead of loosening `onUnhandledFrame`.
