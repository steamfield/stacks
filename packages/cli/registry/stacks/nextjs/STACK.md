---
schema_version: 1
id: nextjs
kind: stack
name: Next.js app on Node
description: A full-stack Next.js App Router app served by Node, with server components, Server Actions validated by zod, ESLint, Vitest with Testing Library, and a Playwright browser test against the production build.
tags: [typescript, react, web, fullstack, scripts, bun, node]
deps:
  app: [next, react, react-dom, zod, server-only]
  dev: [typescript, "@types/node", "@types/react", "@types/react-dom", eslint, eslint-config-next, prettier, vitest, "@vitest/coverage-v8", "@vitejs/plugin-react", jsdom, "@testing-library/react", "@testing-library/dom", "@testing-library/jest-dom", "@testing-library/user-event", "@playwright/test"]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version and engines.node. Node runs next, Vitest and Playwright; Bun installs and runs scripts."
  - "Styling: CSS modules plus one global stylesheet (default), or Tailwind CSS when the person asks for it, set up the way the installed Next docs describe."
  - "Formatter: Prettier with its defaults and the shipped .prettierignore (default), checked by lint."
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
    run: "bun run start --port ${PORT_WEB}"
    expect: { http: "http://localhost:${PORT_WEB}/api/health", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  dev: Run the Next development server
  build: Build the production app
  start: Serve the production build on Node
  typecheck: Generate route types and run tsc
  lint: Run ESLint and the Prettier check
  format: Apply Prettier formatting
  test: Run Vitest once
  test:watch: Watch Vitest tests
  coverage: Run Vitest with coverage
  e2e: Build, then run the Playwright tests against the production server
  check: Run lint, typecheck, tests and e2e
  clean: Remove build, test and coverage output
  prepare: Install git hooks and the Playwright browser outside CI
---

# Next.js app on Node

## What stacks wrote

A working App Router slice: the root layout and server-rendered items page, a process-local items service, a zod-validated Server Action and client form, `/api/health`, error and not-found pages, validated server config, structured logs, colocated unit tests and Playwright tests against the production build. The tool configs and package scripts ship too; read the code before extending it.

Read `docs/guidance/nextjs/index.md` and link it from AGENTS.md.

## Look up the installed release first

Next changes routing, caching and config conventions between majors. Look things up in this order: installed declarations and `node_modules/next/dist/docs/`, then the matching page on nextjs.org, then memory last. If bundled docs are absent, use the site for the installed major.

## Layout

- `src/app/`: layout, page, actions, error boundary, not-found page, health route and global CSS.
- `src/components/add-item-form.tsx`: client form with action state, field errors and pending feedback.
- `src/lib/item-schema.ts`: shared input parser and serializable action state.
- `src/lib/server/`: config, items service and structured logging; each imports `server-only`.
- Colocated `*.test.ts(x)`: unit and component tests. `tests/helpers/`: Vitest setup. The harness adds `tests/hooks/`.
- `e2e/items.spec.ts`: real production-server page, action, health and 404 tests.
- `scripts/prepare.ts`: git hooks and Chromium installation outside CI.

## Setup

1. Add all declared app and dev dependencies with `bun add` and `bun add -d`, checking peer ranges. Install the newest TypeScript and ESLint releases supported by Next and its ESLint plugins, rather than forcing unsupported majors. Match `@types/node` to the chosen Node major. Keep the shipped scripts and configs; no generator is needed.
2. Run lint, typecheck, test and e2e. Where the installed release rejects shipped code or config, update it using its docs without weakening a check, lint rule or assertion. `typecheck` generates route types before tsc; `e2e` builds before starting the production server.
3. Record Node LTS in `.node-version` and `engines.node`, Bun in `packageManager`, and installed tool versions and any compatibility workaround with its removal condition in README.
4. Fill README's `stacks:fill` markers and AGENTS.md with the actual commands, single-file test examples, server/client boundary and guidance links. Fill the harness documentation when present. Run `bun run format` after adding the fragments to normalize their shared files with Prettier, then run `stacks verify` until green. If a default port is busy, choose free `PORT_WEB` and `PORT_E2E` values in verify's environment.

## Conventions

Keep the shipped boundaries when adding code:

- Server components and actions call `src/lib/server/items.ts`; client components receive serializable props. Keep `"use client"` at the leaves and `server-only` first in every server module.
- `config.ts` alone reads the app's environment, lazily validates it with zod and caches it. New settings get a schema field, an `.env.example` line, a test and README documentation.
- Treat every Server Action as a public endpoint. `parseItem` validates FormData on the server and returns submitted values and `{ error: { code, fields } }` for expected failures. Do not throw validation failures. The action revalidates the page after a successful write.
- `items.ts` keeps state on `globalThis` for development reloads and returns copies. It is process-local, resets on restart and is not persistence. The page reads it per request rather than baking a snapshot into the build.
- `logging.ts` writes structured JSON with UTC time, event and request ID, never submitted names or raw errors. The health route returns its request ID and a no-store response. Extend the allowlisted fields when a new boundary needs them.
- `error.tsx` shows a fixed safe message and retries; it logs only the framework digest. Unexpected failures propagate to Next. Missing routes use `not-found.tsx`.

## Tool configuration and tests

Keep the shipped Next plugin, route-type includes, strict TypeScript and unchecked index access. ESLint uses `eslint-config-next`'s flat core-web-vitals and TypeScript configs; `lint` also checks Prettier with its defaults and the shipped ignore file. Add generated output to the ignores, never format `.stacks/`.

Vitest runs on Node with the React plugin and the `@/*` alias; component tests select jsdom per file. The `server-only` alias is test-only: the production build enforces the real boundary. Unit tests exercise the parser, isolated real service, config, safe log records, form feedback and error retry. Keep service test resets test-only.

Vitest cannot render async server components or supply Next's action/revalidation context. Playwright runs Chromium against `next build` plus `next start`, with one worker, no server reuse and retained traces on failure. Its tests cover seed data, rejected input without a write, successful action/revalidation, reload persistence within that process, health JSON and a real 404. Use unique names and condition waits; tests need no secrets or network beyond localhost.

<!-- stacks:when with=ci-github -->
CI sets up Bun from packageManager and Node from `.node-version`, installs frozen dependencies, runs lint, typecheck and coverage, installs Chromium with system dependencies, then runs e2e. Upload Playwright reports and test results on failure. No credentials are needed.
<!-- stacks:end -->

## Commands

`package.json` wires every declared command. Mirror them in AGENTS.md, including a scoped example such as `bun run test src/lib/item-schema.test.ts`. `prepare` runs the shipped helper after install; `clean` removes only build, test and coverage output.

<!-- stacks:when with=git-hooks -->
If the prepare helper already runs `lefthook install`, don't add another installer. pre-commit runs ESLint with `--fix` and Prettier on staged files; pre-push runs typecheck and tests in parallel.
<!-- stacks:end -->

## Gotchas

- Drop TypeScript/ESLint compatibility resolution once Next and its plugins support the newest majors; check their peer ranges on upgrades.
- `next dev` may add an AGENTS.md block pointing at bundled docs. Keep it; deleting it brings it back.
- Never force `--bun` on Next, Vitest or Playwright, and never use `bun test`. These run on Node; Bun installs and runs scripts. Bun doesn't pass its loaded `.env` to Node children; Next loads its own `.env*`.
- Caching defaults differ by release and config. Read the installed caching and revalidation docs when a write shows stale data; don't add dynamic flags without checking why.
- `.next/` and `next-env.d.ts` are generated. Change source or config, never them.
- Next's types require `NODE_ENV` in child-process environments. `tsconfig.tools.json` checks the Node-only scripts and harness separately to keep their isolated environments free of Next's ambient augmentation; `typecheck` runs both programs.
- Production hides thrown messages. Read the server output and Playwright's `test-results/<test>/error-context.md` and trace for the cause.
