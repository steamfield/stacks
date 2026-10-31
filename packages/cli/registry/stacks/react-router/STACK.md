---
schema_version: 1
id: react-router
kind: stack
name: React Router with Effect
description: A server-rendered (SSR) React Router app served by Node, with loaders and actions on shared Effect services, typed HTTP errors and structured logs, plus Tailwind, shadcn/ui, Vitest and a Playwright smoke test.
tags: [typescript, react, web, effect, fullstack, scripts, bun, node]
deps:
  app: [react, react-dom, react-router, "@react-router/node", "@react-router/serve", isbot, effect, tailwindcss, "@tailwindcss/vite", class-variance-authority, lucide-react]
  dev: ["@react-router/dev", vite, "@vitejs/plugin-react", typescript, "@biomejs/biome", vitest, "@vitest/coverage-v8", happy-dom, "@testing-library/react", "@testing-library/dom", "@testing-library/jest-dom", "@testing-library/user-event", "@types/node", "@types/react", "@types/react-dom", "@playwright/test"]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version and engines.node."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github, effect]
  optional: [posthog, rr, ce-plugin, openrouter-chat, effect-sql-postgres, effect-otlp]
env:
  PORT_WEB: "5173"
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
    run: "bun run dev:server --port ${PORT_WEB} --strictPort"
    expect: { http: "http://localhost:${PORT_WEB}/healthz", within: 90s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  dev: Run the foreground server and preserve logs
  dev:server: Run the framework development server
  dev:bg: Start or reuse this checkout's background server
  dev:stop: Stop this checkout's background server
  build: Build the SSR application
  start: Serve the production build with PORT_WEB or PORT
  typecheck: Generate route types and run tsc
  lint: Run Biome checks
  format: Apply Biome formatting and safe fixes
  test: Run Vitest
  test:watch: Watch Vitest tests
  coverage: Run Vitest with coverage
  e2e: Build and run the health-route browser smoke
  check: Run lint, typecheck, tests, and the browser smoke
  clean: Remove project build, test, and log output
  prepare: Install project hooks and local browser dependencies outside CI
---

## What stacks wrote

A Node-served React Router framework app: root layout, Tailwind, a native shadcn-style button, a greeting page whose loader and form action run through the shared Effect runtime, and a database-free `/healthz`. The slice includes validated config, typed HTTP errors, structured logging, route/component tests and a Playwright test against the production build, plus configs, scripts and guidance under `docs/guidance/react-router/`; read the code before extending it.

## Layout

Explicit routes live in `app/routes.ts`, route modules in `app/routes/`, server programs and services in `app/.server/`, shared schemas in `app/schemas/`, and UI in `app/components/`. Tests sit beside server code and routes; `tests/helpers/` owns runtime setup. Browser tests live in `e2e/`. Link `docs/guidance/react-router/index.md` from AGENTS.md.

## Setup

1. Add every declared app and dev dependency at its current release with Bun. Check peer compatibility, including Effect and the selected testing fragment. No generator is needed: preserve the shipped source, tests and configs.
2. Run `bun run lint`, `bun run typecheck`, `bun run test` and `bun run e2e`. Update shipped code or config where an installed release rejects it, keeping every check and lint rule. Use `bun run format` for formatting. `prepare` installs Chromium outside CI; install it explicitly in CI before e2e.
3. Record the current Node LTS in `.node-version` and `engines.node`, and the installed Bun in `packageManager`. Node runs React Router, Vite and Vitest; Bun installs and invokes scripts.
4. Fill the README markers, AGENTS.md and the selected fragments' documentation. Implement the selected fragments after the base checks pass. Run `stacks verify` until green.

## Conventions

The shipped files are the reference; read `effect-server.md`, `routes.md` and `typescript.md` in the guidance directory before extending them.

- Loaders and actions stay thin. `programs.ts` decodes input and calls services; `http.ts` owns execution, safe errors, request ids and the completed-request log. Resource routes use `runRoute`; page data uses `runData` and throws error Responses to the root boundary.
- Only `config.ts` reads application environment through Effect Config. Add new settings there, test defaults and invalid values, and document them in `.env.example`. Runtime config failure returns a safe 500, never a successful health response.
- Add expected errors and their fixed safe status/message/retryability to `errors.ts`. Error bodies are `{ message, retryable }`; defects remain defects and their messages stay out of responses and logs.
- Services are namespaced `Context.Service` classes with static layers. Capture dependencies in the layer constructor. `runtime.ts` owns one lazy ManagedRuntime and disposes it on hot reload; no per-request runtime. The slice is stateless; when adding memory state, retain it on `globalThis` during development and allocate fresh state in tests.
- Components never import Effect or server code. A route may use server imports only inside its loader/action. Shared schemas remain platform-free; components import their types only. The server-import hook and production build enforce the boundary.
- Use `Effect.log*` with annotations. `logging.ts` owns safe application records, readable terminal output and the development file sink; production application records are JSON on stdout. Never log bodies, credentials or arbitrary SDK error objects. Request ids are returned in `x-request-id`; health logs at debug.
- Keep strict TypeScript, unchecked indexing, verbatim imports, erasable syntax, no emit and bundler resolution. Typecheck includes scripts, tests and available adapter hooks after generating route types. Preserve Biome's recommended rules, type imports/exports, unused imports, const enforcement, organized imports and Tailwind directives when adapting config.
- Biome's Playwright domain belongs to browser tests in `e2e/`. The override for Vitest files keeps their valid describe options from being checked as Playwright calls; retain the ordinary test rules there.
- `app/components/ui/button.tsx` is a native-button adaptation of the shadcn/ui variant pattern. Add only primitives a feature needs, using the current shadcn tooling and its installed dependencies; don't regenerate the foundation.

## Testing

`app/.server/*.test.ts` exercises real config, service and runtime layers, loaders/actions, decoding, error mapping, cancellation, disposal, ids, logs and file-sink recovery. `home.test.tsx` uses happy-dom and Testing Library to submit through the real action. `tests/helpers/runtime.ts` swaps and disposes test runtimes; never mock the project's own modules.

Add observable behavior tests beside new code. Use Node for server tests and happy-dom per component file; router links/forms need a routes stub. Test timers directly with TestClock when the Effect fragment is selected. E2e builds first, then serves Node on a separate port with Chromium, one worker, forbidOnly in CI and retained failure traces. It checks SSR, hydration, a form action and health without credentials.

<!-- stacks:when with=ci-github -->
CI reads Bun from packageManager and Node from .node-version, installs frozen dependencies, runs lint/typecheck/coverage, installs Chromium with system dependencies, and runs e2e. Upload Playwright reports and test results on failure.
<!-- stacks:end -->

## Commands

The shipped package scripts wire every declared command. `dev` preserves terminal output in `logs/dev.log`; `dev:bg` starts or reuses this checkout's server and `dev:stop` stops its process group. `dev:server` is the direct framework server used by verify. `start` runs `react-router-serve build/server/index.js`, with PORT_WEB taking precedence over PORT, then 3000. The framework serves the build's assets and `public/` files. `clean` removes generated outputs only. Mirror commands, logs and hook ownership in AGENTS.md.

<!-- stacks:when with=git-hooks -->
`scripts/prepare.ts` already installs lefthook outside CI when the binary and config exist, non-fatally outside a git checkout. Don't duplicate it. pre-push runs typecheck and tests in parallel.
<!-- stacks:end -->

## Gotchas

- Never force Node tooling onto Bun with `--bun` or substitute `bun test` for Vitest.
- Generate route types before tsc, including after a route rename. The before-typecheck hook does this for edited routes.
- Resource routes export only loader/action; extra server-dependent exports can pass tests and fail the client build.
- Bun doesn't automatically pass its loaded .env into child Node processes. Supply the production environment explicitly; e2e supplies its own config and needs no .env.
- `@react-router/serve` also emits a plain-text access log that includes query strings. Keep the app's Effect request logs as the structured record. A project that puts sensitive values in URLs switches to the Node adapter behind its own server, where it controls access logging.
- `prepare` downloads Chromium on first install; this can take a while. It also runs after subsequent installs.
- The architecture stays Effect-based when the optional testing fragment is excluded. Use installed declarations for APIs, then update the project's Effect skill when selected.
