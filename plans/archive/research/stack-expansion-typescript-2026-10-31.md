# TypeScript stack expansion research

Date: 2026-10-31. Read-only research; nothing in the repo was edited. Proposals, not proven recipes: no candidate below has been built from an empty directory or benched.

## Summary

The registry has 11 stacks that use TypeScript (`astro-blog`, `astro-fullstack`, `cloudflare-react-router`, `mobile-expo`, `nextjs`, `react-router`, `sveltekit`, `tauri-react`, `typescript-api`, `typescript-cli`, `python-react`). Every standalone TypeScript API and CLI requires Effect, every React surface except Tauri renders on a server, Vue and Angular have no stack, and there's nothing for the three product kinds an agent-first developer now asks for most outside web apps: an npm library, an MCP server and a browser extension.

I propose nine new stacks, which brings TypeScript to 20:

| Rank | Id | Name | Priority |
| --- | --- | --- | --- |
| 1 | `react-vite` | React SPA on Vite | P1 |
| 2 | `hono-api` | Hono API on Node | P1 |
| 3 | `typescript-mcp` | TypeScript MCP server | P1 |
| 4 | `nuxt` | Nuxt app on Node | P1 |
| 5 | `nestjs-api` | NestJS API | P1 |
| 6 | `typescript-library` | TypeScript npm library | P1 |
| 7 | `angular` | Angular app | P2 |
| 8 | `electron-react` | Electron desktop app with React | P2 |
| 9 | `wxt-extension` | Browser extension with WXT and React | P2 |

`react-vite`, `nuxt` and `typescript-library` are already in `plans/registry-expansion.md` (Batches 2 and 4); this report keeps them and corrects their outlines where 2026 tooling moved. Two prior-research outlines are now wrong: NestJS's starter no longer uses Jest or ESLint (Nest 12 ships Vitest, oxlint and ESM), and Angular 21+ generates Vitest and zoneless projects, not Karma.

Next in line, not proposed now: `tanstack-start` (stable only since October 2026 and overlaps three full-stack React stacks), `express-api` (a variant of `hono-api`), `vscode-extension` (GUI test launches under an agent).

## Evidence

### Surveys

Stack Overflow Developer Survey 2026, web frameworks question (n = 10,281, all respondents; [source](https://survey.stackoverflow.co/2026/technology/data/web-framework)):

| Framework | Used | In registry? |
| --- | ---: | --- |
| React | 41.5% | yes (many) |
| Next.js | 20.6% | yes |
| Vue.js | 17.2% | **no** |
| Angular | 16.0% | **no** |
| Express | 15.6% | **no** |
| Svelte | 7.8% | yes |
| Astro | 6.2% | yes |
| NestJS | 5.8% | **no** |
| Nuxt.js | 4.4% | **no** |
| Fastify | 3.5% | no |
| Hono | 2.8% | only inside `mobile-expo` |
| Remix | 1.7% | (merged into React Router) |
| SolidJS | 1.5% | no |

Qwik and Electron aren't in that question.

State of JavaScript 2025 ([back-end frameworks](https://2025.stateofjs.com/en-US/libraries/back-end-frameworks/), [meta-frameworks](https://2025.stateofjs.com/en-US/libraries/meta-frameworks/)): "Express is still the leader in terms of usage, even if Nest is progressing at a nice clip"; the top three by satisfaction are "Hono, Nitro, and ElysiaJS", all new entrants. Respondents use a median of two back-end frameworks. TanStack Start was absent from the meta-framework options (still beta at launch) and topped "other meta-frameworks" with 235 write-ins. The pages render numeric percentages only in interactive charts, so I quote their text.

### npm weekly downloads

Week 2026-10-23 to 2026-10-29, from `api.npmjs.org/downloads/point/last-week/<pkg>`. Downloads include transitive installs and CI, so read them as an order of magnitude, not adoption. `hono` and `express` are inflated by being dependencies of other tools (the MCP SDK v1 pulls in `hono` through `@hono/node-server`).

| Package | Weekly | Package | Weekly |
| --- | ---: | --- | ---: |
| vite | 252.0M | @nestjs/core | 23.0M |
| react | 244.7M | @tanstack/react-router | 21.7M |
| express | 196.6M | fastify | 21.4M |
| hono | 100.9M | @modelcontextprotocol/server (v2) | 21.2M |
| @hono/node-server | 94.0M | tsup | 13.0M |
| next | 90.6M | @nestjs/cli | 12.4M |
| @modelcontextprotocol/sdk (v1) | 87.0M | electron | 11.7M |
| pino | 76.0M | solid-js | 10.9M |
| react-router | 74.1M | @tanstack/react-start | 9.9M |
| turbo | 42.5M | vue-tsc | 9.1M |
| oxlint | 40.9M | @angular/core | 8.3M |
| @biomejs/biome | 25.2M | @changesets/cli | 8.1M |
| vue | 24.2M | @angular/cli | 7.7M |
| | | tsdown | 6.3M |
| nuxt | 3.3M | @types/vscode | 2.5M |
| @slack/bolt | 3.9M | publint | 2.2M |
| electron-vite | 2.1M | elysia | 1.9M |
| discord.js | 1.7M | @arethetypeswrong/cli | 1.6M |
| @electron-forge/cli | 1.3M | @nuxt/test-utils | 1.2M |
| wxt | 1.1M | @remix-run/node | 1.0M |
| @crxjs/vite-plugin | 632K | plasmo | 577K |
| @solidjs/start | 163K | @builder.io/qwik | 63K |

### GitHub stars (2026-10-31, `gh api repos/<repo>`)

electron/electron 123.7k, angular/angular 101.1k, vitejs/vite 83.6k, nestjs/nest 77.0k, expressjs/express 69.6k, nuxt/nuxt 61.0k, vuejs/core 54.9k, fastify/fastify 37.3k, honojs/hono 32.8k, vercel/turborepo 31.3k, discordjs/discord.js 26.8k, QwikDev/qwik 22.1k, elysiajs/elysia 19.3k, TanStack/router 15.3k, modelcontextprotocol/typescript-sdk 13.7k, PlasmoHQ/plasmo 13.2k, wxt-dev/wxt 10.7k, microsoft/vscode-extension-samples 10.2k, electron/forge 7.2k, solidjs/solid-start 5.9k, electron-vite 5.6k, rolldown/tsdown 4.3k, slackapi/bolt-js 3.0k.

### Current release lines (npm, 2026-10-31)

Recorded so an author knows what the shipped files must be written against, never to ship: nuxt 4.6, @angular/core 22.2, @nestjs/core 12.3, fastify 5.12, hono 4.13, express 5.3, vite 8.3, vitest 5.0, typescript 7.0, eslint 10.14, oxlint 1.90, zod 4.6, electron 45, @electron-forge/cli 8.0, wxt 0.21, tsdown 0.23, @tanstack/react-start 1.169, @modelcontextprotocol/server 2.x, @qwik.dev/core 2.0.0-rc.

## Cross-cutting notes for every proposal

- **Tags decide fragment fit.** `agent-ops`, `ce-plugin`, `ci-github`, `git-hooks` and `rr` apply everywhere (`applies_to: []`). `claude-harness` needs tag `node` or `bun`. `rest-api` needs tag `api`. `ci-github` already branches on `node`, `bun`, `scripts`, `make` and `monorepo`, so every proposal below is covered by a `scripts` + `node` + `bun` tag set without editing it, except where a job needs a browser or display (noted per stack). `docker-deploy`, `posthog`, `drizzle-postgres` and `cloudflare-pages` are opt-in by stack id and need their `applies_to` widened plus a branch in their body before they're advertised. The Effect fragments don't apply to any proposal.
- **Allowlist.** Every `deps` name must be in `packages/cli/registry/allowlist.json` (118 npm names today); each proposal lists the names it adds.
- **Runtime split.** Follow the existing TS stacks: Bun installs and runs scripts, Node runs servers and Vitest, never `bun test` or `--bun`. Electron is the exception (see its gotchas).
- **Agent-ops pattern.** The existing non-Effect TS stacks (`nextjs`, `sveltekit`) ship `docs/guidance/<id>/*.md` as agent-neutral guidance, Claude rules under `adapters/claude/.claude/rules/` that point at it, a `guard-<id>-commands.ts` PreToolUse hook that denies wrong commands with the fix, a generated-files guard, and tests for each hook. Each proposal names what its guard and rules should cover; reuse the shape, don't invent a new one.
- **Budget.** Stack bodies stay under 2,000 words and composed briefs under 6,000. Nest, Angular and Electron are the at-risk ones; move framework reference into `files/docs/guidance/<id>/`.

---

## 1. `react-vite` (P1): React SPA on Vite

- **Name:** React SPA on Vite
- **Description:** A browser-only React single-page app on Vite with React Router, TanStack Query against a typed fetch boundary, Biome, Vitest with Testing Library and MSW, and a Playwright test of the built site.
- **Why distinct:** Every existing React web stack renders on a server (`nextjs`, `react-router`, `cloudflare-react-router`) or ships a second runtime (`python-react`, `tauri-react`, `astro-*`). "A React app with Vite" is the most common thing people ask for and has no stack; it deploys as static files and has no server code to get wrong.
- **Popularity:** React 41.5% and the most-used framework in SO 2026; `vite` 252M/wk and `react` 245M/wk; Vite 83.6k stars.
- **Deps:** `app: [react, react-dom, react-router, "@tanstack/react-query", zod]`; `dev: [vite, "@vitejs/plugin-react", typescript, "@types/node", "@types/react", "@types/react-dom", "@biomejs/biome", vitest, "@vitest/coverage-v8", happy-dom, "@testing-library/react", "@testing-library/dom", "@testing-library/jest-dom", "@testing-library/user-event", msw, "@playwright/test"]`.
- **New allowlist names:** none.
- **Tools:** bun, node, git. Tags: `[typescript, react, web, static, spa, scripts, bun, node]`.
- **Lint/format/typecheck/test:** Biome (lint and format; its hook rules cover rules-of-hooks and exhaustive deps), `tsc -b` over app and node tsconfigs, Vitest on happy-dom, Playwright Chromium.
- **Proving slice:** `src/main.tsx` (QueryClient and router providers), `src/app/router.tsx` (data router with a layout route, index, `/items/:id` and a route error element), `src/api/client.ts` (the one fetch boundary: base URL from `import.meta.env.VITE_API_URL`, zod-decoded responses, a typed `ApiError` with status), `src/config.ts` (validated `VITE_*` env, failing at startup with a readable message), `src/features/items/` (list and detail with loading, empty and error states), `public/` mock data or an MSW browser worker in dev only. The payload: the items page fetches through the client, MSW serves it in tests, and a 500 renders the error state with the request id. Tests: client decode and error mapping (unit), the items route with MSW (component), Playwright against `vite preview` (list, detail deep link, reload on a deep link, 404 route).
- **Verify:** `bun install`; `lint` (biome check); `typecheck` (tsc -b); `test` (vitest run); `build` (vite build); `e2e` (Playwright against preview); serve `bun run preview --port ${PORT_WEB} --strictPort` probing `http://localhost:${PORT_WEB}/` (env `PORT_WEB: "4173"`); readme-filled.
- **Agent-ops:** rule that nothing secret goes in `VITE_*` (it's in the bundle); a guard hook denying `bun test`, `--bun` on vitest/playwright, and foreground `bun run dev` (use preview for probes); a boundary check (Biome Grit plugin, like `typescript-api`'s) that `fetch` is only called from `src/api/`.
- **Fragments:** required `claude-harness`; default `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`, `posthog` (after adding a branch; it's a web-client fragment already), `cloudflare-pages` (widen from `astro-blog`; it deploys a static `dist/`).
- **Gotchas:** SPA fallback: `vite preview` serves `index.html` for unknown paths but a static host needs a rewrite; the e2e deep-link reload test catches it locally. MSW's service worker file (`public/mockServiceWorker.js`) is generated by `msw init`; ship no copy, generate it in Setup and exclude it from Biome. `import.meta.env` types need `vite/client` in tsconfig `types`. Don't drift into React Router framework mode (`@react-router/dev`): that's `react-router`'s stack.

## 2. `hono-api` (P1): Hono API on Node

- **Name:** Hono API on Node
- **Description:** A TypeScript JSON API on Hono served by Node, with zod-validated routes that generate an OpenAPI document, one error envelope, request ids and pino JSON logs, and Vitest tests that call the app in process and over a real port.
- **Why distinct:** `typescript-api` is Effect's HttpApi, a deliberate, heavier choice; there's no plain TypeScript API. Hono appears only as the API half of `mobile-expo` (Bun, Drizzle, Clerk), which nobody picks to get an API. Hono is the State of JS satisfaction leader and runs on Node, Bun, Deno and Workers, so a Workers host can later be a fragment rather than another stack.
- **Popularity:** SO 2026 2.8% (rising from a small base); State of JS 2025 top satisfaction; `hono` 101M/wk and `@hono/node-server` 94M/wk (inflated by MCP SDK v1); 32.8k stars.
- **Deps:** `app: [hono, "@hono/node-server", "@hono/zod-openapi", zod, pino]`; `dev: [typescript, "@types/node", "@biomejs/biome", vitest, "@vitest/coverage-v8", pino-pretty]`. `@scalar/hono-api-reference` only if the docs-UI decision is yes.
- **New allowlist names:** `@hono/node-server`, `pino`, `pino-pretty`.
- **Tools:** bun, node, git. Tags: `[typescript, api, hono, node, bun, scripts]`.
- **Lint/format/typecheck/test:** Biome, `tsc --noEmit` (erasable syntax only so `node src/server.ts` runs with type stripping), Vitest on Node.
- **Proving slice:** `src/app.ts` (builds an `OpenAPIHono` with no Node imports, so it's also a fetch handler), `src/server.ts` (the only Node module: `serve()`, SIGINT/SIGTERM shutdown), `src/config.ts` (zod-validated env, lazily read), `src/errors.ts` (`AppError` subclasses and the one status table; `app.onError` and `notFound` render `{ error: { code, message, requestId } }`), `src/logging.ts` (pino with an allowlisted request log middleware; `hono/request-id`), `src/routes/notes.ts` (an in-memory notes resource: list, get, create), `src/routes/health.ts`, `/openapi.json`. The payload: `POST /v1/notes` with an invalid body returns the 400 envelope from the validation hook, a valid one 201 with the logged request id. Tests: `app.request()` contract table (statuses, envelopes, content type, unknown route, wrong method), config, logging redaction, and one test that starts `serve()` on port 0 and calls it with `fetch`.
- **Verify:** install; lint; typecheck; test; `http-contract` (the contract file alone, as `typescript-api` does); `build` (`bun build src/server.ts --target=node` into `dist/`, or tsdown); serve `bun run start` probing `http://localhost:${PORT_API}/healthz` (env `PORT_API: "3000"`); readme-filled.
- **Agent-ops:** rule that routes are declared with `createRoute` so validation and OpenAPI can't drift; boundary plugin keeping `node:*` and `@hono/node-server` in `src/server.ts` and `console` out of `src/`; guard hook denying `bun test`, running the server under Bun, and foreground dev; a `/add-resource` command mirroring `typescript-api`'s.
- **Fragments:** required `claude-harness`; default `git-hooks`, `ci-github`, `rest-api`; optional `rr`, `ce-plugin`, `docker-deploy` (widen and add a branch), `drizzle-postgres` (widen and add a Hono branch; it's the natural non-Effect database owner).
- **Gotchas:** the zod-openapi validation hook must be set on the app (`defaultHook`) or invalid bodies return Hono's plain-text 400 instead of the envelope. `@hono/zod-openapi` tracks zod majors; check its peer range before adding zod. `c.req.json()` throws on a bad body; let the validator parse it. Bun runs Hono natively, which tempts agents to switch runtimes; the stack is Node.

## 3. `typescript-mcp` (P1): TypeScript MCP server

- **Name:** TypeScript MCP server
- **Description:** A Model Context Protocol server in TypeScript on the official SDK, over stdio, with zod-described tools, logs kept off stdout, and Vitest tests that connect a real MCP client in memory and to the built server process.
- **Why distinct:** A new product kind with no stack in any language. Stacks' users are developers who work with coding agents, and an MCP server is the thing they most often build for those agents. It's small, needs no account, and has exactly the agent mistakes a brief prevents (printing to stdout, outdated SDK imports).
- **Popularity:** `@modelcontextprotocol/sdk` (v1) 87M/wk and the v2 `@modelcontextprotocol/server` 21M/wk three months after its release; typescript-sdk 13.7k stars. v2 is the stable line implementing the 2026-07-28 spec; v1 gets fixes until at least early 2027 ([SDK README](https://github.com/modelcontextprotocol/typescript-sdk)).
- **Id note:** follows `typescript-api`/`typescript-cli`. `mcp-server` alone would block a later Python MCP stack. Search card must carry "mcp server", "model context protocol", "claude tools".
- **Deps:** `app: ["@modelcontextprotocol/server", zod]`; `dev: ["@modelcontextprotocol/client", "@modelcontextprotocol/inspector", typescript, "@types/node", "@biomejs/biome", vitest, "@vitest/coverage-v8"]`.
- **New allowlist names:** `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, `@modelcontextprotocol/inspector`.
- **Tools:** bun, node, git. Tags: `[typescript, mcp, ai, agents, node, bun, scripts]` (no `cli` or `api` tag: neither fragment set fits).
- **Proving slice:** `src/server.ts` (builds the `McpServer` and registers tools, no transport), `src/index.ts` (the only stdio entry; connects the transport, exits on stdin close and signals), `src/tools/` (one deterministic tool, say `word_count` over a text argument, and one that reads a file under a configured root and refuses paths outside it, returning an MCP tool error rather than throwing), `src/config.ts` (env-validated root and log level), `src/logging.ts` (JSON to stderr only, plus MCP logging notifications). The payload: `tools/list` returns both tools with their JSON Schemas, a path-escape call returns `isError: true` with a safe message. Tests: in-memory client/server pair for list/call/invalid input; an integration test spawning the built `dist/index.js` over stdio; a stdout-purity test asserting every stdout line parses as JSON-RPC.
- **Verify:** install; lint; typecheck; test; `build` (bundle to `dist/index.js` with a shebang); `smoke` (`npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list`, checking the tool names); readme-filled. No serve step; HTTP is a decision.
- **Agent-ops:** a boundary rule that `console.log` and `process.stdout` are banned outside the transport (this is the number-one MCP bug); a guard hook denying `@modelcontextprotocol/sdk` installs (v1) with the v2 package names as the fix; a rule pointing to `docs/guidance/typescript-mcp/` describing tool naming, descriptions written for a model, and tool errors versus protocol errors; an `.mcp.json` example in the Claude adapter so the agent can register the built server with itself.
- **Decisions:** transport stdio (default), or Streamable HTTP through `@modelcontextprotocol/node` with a serve probe; distribution as an npm `bin` (default) or local only.
- **Fragments:** required `claude-harness`; default `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`, `bun-release` (widen; a compiled binary is a reasonable MCP distribution), `openrouter-ai` does not fit (Effect).
- **Gotchas:** tutorials and model memory use v1 (`@modelcontextprotocol/sdk/server/mcp.js`); v2 moved packages and imports, so Setup must say to read installed declarations first. Inspector's CLI mode flags have changed between releases; read `--help`. A server that logs before `connect()` corrupts the handshake.

## 4. `nuxt` (P1): Nuxt app on Node

- **Name:** Nuxt app on Node
- **Description:** A full-stack Vue app on Nuxt served by Node, with server API routes, a zod-validated form posting to them, typed runtime config, ESLint, Vitest in Nuxt's test environment and a Playwright test against the production server.
- **Why distinct:** Vue is the third most-used web framework (17.2%) and has no stack at all. Nuxt is the Vue analogue of `nextjs`/`sveltekit` and already Batch 2.
- **Popularity:** Vue 17.2% and Nuxt 4.4% in SO 2026; `vue` 24.2M/wk, `nuxt` 3.3M/wk; nuxt 61.0k stars.
- **Deps:** `app: [nuxt, vue, vue-router, zod]`; `dev: [typescript, vue-tsc, "@nuxt/eslint", eslint, prettier, vitest, "@vitest/coverage-v8", "@nuxt/test-utils", "@vue/test-utils", happy-dom, "@playwright/test"]`. The official v4 starter declares only `nuxt`, `vue`, `vue-router` ([nuxt/starter v4](https://github.com/nuxt/starter/blob/v4/package.json)).
- **New allowlist names:** `nuxt`, `vue`, `vue-router`, `vue-tsc`, `@nuxt/eslint`, `@nuxt/test-utils`, `@vue/test-utils`.
- **Tools:** bun, node, git. Tags: `[typescript, vue, nuxt, web, fullstack, scripts, bun, node]`.
- **Lint/format/typecheck/test:** `@nuxt/eslint` module (generates the flat config; `eslint .`), Prettier check, `nuxt typecheck` (vue-tsc), Vitest with two projects (plain Node unit, and the `nuxt` environment from `@nuxt/test-utils`), Playwright.
- **Proving slice:** `app/` (Nuxt 4 layout: `app.vue`, `pages/index.vue`, `components/AddNoteForm.vue`, `error.vue`), `server/api/notes.get.ts`, `server/api/notes.post.ts` (zod `readValidatedBody`, `createError` with a status and data), `server/api/health.get.ts`, `server/utils/notes.ts` (process-local store), `server/utils/logger.ts` (JSON lines), `nuxt.config.ts` with typed `runtimeConfig` and private keys, `shared/` zod schema used by both sides. Payload: the page `useFetch`es notes during SSR, the form posts and shows field errors from the 400, and the list refreshes. Tests: schema and store unit tests, component test with `mountSuspended`, a server route test with `$fetch` from `@nuxt/test-utils/e2e` or a direct handler call, Playwright against `node .output/server/index.mjs`.
- **Verify:** install (runs `nuxt prepare` via postinstall); lint; typecheck; test; build (`nuxt build`); e2e; serve `PORT=${PORT_WEB} node .output/server/index.mjs` probing `/api/health` (env `PORT_WEB: "3000"`); readme-filled.
- **Agent-ops:** guard on generated `.nuxt/` and `.output/`; rule on server/client boundaries (secrets only in private `runtimeConfig`, never `public`; `server/` code never imported from `app/`); rule on auto-imports (don't add explicit imports Nuxt provides, and generated types need `nuxt prepare` after adding a composable); guard denying `bun test` and foreground `nuxt dev`.
- **Fragments:** required `claude-harness`; default `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`, `drizzle-postgres` (widen with a Nitro branch), `posthog` (after its Batch 2 revision). No React UI fragments.
- **Gotchas:** Nuxt 4 moved app code under `app/`; model memory writes Nuxt 3 root layout. `postinstall: nuxt prepare` is needed for types; with Bun, lifecycle scripts of the project itself run but a CI frozen install still needs it. `@nuxt/test-utils` needs its Vitest config through `defineVitestConfig` or projects; the API has changed across majors, read installed docs. `useFetch` keys dedupe requests; a missing key after a POST shows stale data, use `refresh()`.

## 5. `nestjs-api` (P1): NestJS API

- **Name:** NestJS API
- **Description:** A Node REST API on NestJS with modules, controllers and providers, validated config, a global exception filter mapping domain errors to one envelope, Swagger docs, JSON logs, and Vitest unit and Supertest end-to-end tests.
- **Why distinct:** The opinionated, decorator-based API framework larger teams standardize on; a developer asking for Nest won't accept Hono or Effect. Its DI and module system make agent conventions (where a provider goes, how a module exports) the main value of a brief.
- **Popularity:** SO 2026 5.8% (above Fastify and Hono); State of JS 2025 "progressing at a nice clip"; `@nestjs/core` 23.0M/wk, `@nestjs/cli` 12.4M/wk; 77.0k stars.
- **Correction to prior research:** Nest 12 (`nest new`) defaults to ESM, Vitest and oxlint; Jest remains only for CommonJS projects ([Nest 12 release](https://github.com/nestjs/nest/releases/tag/v12.0.0), [current starter package.json](https://github.com/nestjs/typescript-starter/blob/master/package.json)). Follow the starter.
- **Deps:** `app: ["@nestjs/common", "@nestjs/core", "@nestjs/platform-express", "@nestjs/config", "@nestjs/swagger", reflect-metadata, rxjs, class-validator, class-transformer]`; `dev: ["@nestjs/cli", "@nestjs/schematics", "@nestjs/testing", typescript, tslib, "@types/node", "@types/express", vitest, "@vitest/coverage-v8", vite-tsconfig-paths, supertest, "@types/supertest", oxlint, prettier]`.
- **New allowlist names:** the eight `@nestjs/*` names, `reflect-metadata`, `rxjs`, `class-validator`, `class-transformer`, `tslib`, `@types/express`, `vite-tsconfig-paths`, `supertest`, `@types/supertest`, `oxlint`.
- **Tools:** bun (or npm, see gotchas), node, git. Tags: `[typescript, api, nestjs, node, bun, scripts]`.
- **Lint/format/typecheck/test:** oxlint with the starter's rules plus `no-floating-promises` as an error, Prettier check, `tsc --noEmit -p tsconfig.json`, Vitest (`*.spec.ts`) and a second Vitest config for `*.e2e-spec.ts`.
- **Proving slice:** `src/main.ts` (bootstrap, global `ValidationPipe` with whitelist and forbidNonWhitelisted, global exception filter, `enableShutdownHooks`, JSON `ConsoleLogger`, Swagger at `/docs` and `/openapi.json`), `src/config/` (`ConfigModule` with a validate function failing at boot), `src/common/errors.ts` (domain errors) and `src/common/http-exception.filter.ts` (one envelope with request id), `src/common/request-id.middleware.ts`, `src/health/` (module, controller), `src/notes/` (module, controller, service, DTOs with class-validator decorators). Payload: `POST /v1/notes` with an unknown field returns the 400 envelope, a valid one 201; `GET /v1/notes/:id` for a missing id maps `NotFoundError` to 404 through the filter. Tests: service and filter units with `Test.createTestingModule`, Supertest e2e booting the real `AppModule`.
- **Verify:** install; lint; typecheck; test; `test-e2e`; build (`nest build`); serve `node dist/main.js` probing `/healthz` (env `PORT_API: "3000"`); readme-filled.
- **Agent-ops:** rule on module boundaries (a feature module exports only its service; no cross-feature imports of controllers; new feature through `nest g resource` read from `--help`, then trimmed to conventions); rule forbidding throwing raw `HttpException` from services (throw domain errors, map in the filter); guard denying `ts-node`, `jest` installs and `bun test`; generated-files guard on `dist/`.
- **Fragments:** required `claude-harness`; default `git-hooks`, `ci-github`, `rest-api`; optional `rr`, `ce-plugin`, `docker-deploy` (widen). Database (TypeORM, Prisma or Drizzle) is a later fragment.
- **Gotchas:** decorators need `experimentalDecorators` and `emitDecoratorMetadata`; Vitest's transformer must emit metadata or DI silently injects `undefined`. The starter relies on Vite 8's transformer; if a test shows undefined providers, add `unplugin-swc` and record why. ESM needs `.js` extensions in relative imports under `nodenext`. Nest's CLI assumes npm-style `node_modules`; prototype with Bun before choosing it as the default package manager. Model memory writes CommonJS Nest 10/11 with Jest; Setup must say to follow the installed starter.

## 6. `typescript-library` (P1): TypeScript npm library

- **Name:** TypeScript npm library
- **Description:** A TypeScript package for npm, built to ESM with declarations by tsdown, checked by publint and Are the Types Wrong, tested with Vitest, and proven by installing the packed tarball into a clean consumer project.
- **Why distinct:** A product kind no stack covers; every existing stack builds an app. Library mistakes (wrong `exports`, missing types, a dependency in the wrong field) only show up after publish, which is exactly what a verify loop catches.
- **Popularity:** `tsup` 13.0M/wk and its successor `tsdown` 6.3M/wk; `publint` 2.2M/wk; `@arethetypeswrong/cli` 1.6M/wk; `@changesets/cli` 8.1M/wk.
- **Deps:** `dev: [typescript, tsdown, publint, "@arethetypeswrong/cli", "@biomejs/biome", vitest, "@vitest/coverage-v8", "@types/node"]`; no runtime deps. `release: ["@changesets/cli"]` only if the release decision is yes.
- **New allowlist names:** `tsdown`, `publint`, `@arethetypeswrong/cli` (`@changesets/cli` if used).
- **Tools:** bun, node, git. Tags: `[typescript, library, npm, node, bun, scripts]`.
- **Proving slice:** `src/index.ts` (the only public entry; explicit named exports), `src/slugify.ts` or similar pure function with an options object and a typed error class, `src/internal/` not exported, `package.json.tmpl` with `type`, `exports` (types and import conditions), `files`, `sideEffects: false` and no dependency blocks, `tsdown.config.ts`, `tests/` unit tests, `tests/consumer/` a fixture project with a `.ts` and `.mjs` file importing the package by name. Payload: the packed tarball installs into the fixture and its typecheck and run both pass.
- **Verify:** install; lint; typecheck; test (coverage floor); build; `package-check` (`publint` and `attw --pack --profile esm-only`); `consumer` (pack, install into a temp copy of the fixture, `tsc` and `node` it); readme-filled.
- **Agent-ops:** rule that every export change updates the README API section and a changeset; guard on `dist/`; rule that `@types/*` needed by public types go in `dependencies`, not dev; hook denying `npm publish` (publishing is the person's step).
- **Fragments:** required `claude-harness`; default `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`. A release fragment (changesets plus a publish workflow with npm provenance) is a natural follow-up; publishing needs credentials, so it must never be in verify.
- **Gotchas:** tsdown is pre-1.0; its config keys move, read installed docs. `attw` reports CJS problems for ESM-only packages unless run with the ESM-only profile. Testing against `src/` proves nothing about the published shape; the consumer step is the point. TypeScript 7's emit and tsdown's declaration generation (isolated declarations) need explicit return types on exports.

## 7. `angular` (P2): Angular app

- **Name:** Angular app
- **Description:** An Angular single-page app with standalone components, signals, zoneless change detection, a routed feature with a typed HTTP service and a reactive form, angular-eslint, the CLI's Vitest runner and a Playwright test of the production build.
- **Why distinct:** Angular is 16% of SO 2026 respondents, ahead of Express and far ahead of Svelte, and has no stack. It's its own CLI, compiler, DI and testing world; nothing about React stacks transfers.
- **Popularity:** SO 2026 16.0%; `@angular/core` 8.3M/wk, `@angular/cli` 7.7M/wk; 101.1k stars.
- **Correction to prior research:** Angular 21 made Vitest the default runner and zoneless the default for `ng new` ([Ninja Squad, Angular 21](https://blog.ninja-squad.com/2025/11/20/what-is-new-angular-21.0), [Angular Architects](https://www.angulararchitects.io/blog/whats-new-in-angular-21-signal-forms-zone-less-vitest-angular-aria-cli-with-mcp-server/)); current is 22.2. No Karma, no `zone.js`, no `fakeAsync`.
- **Deps:** `app: ["@angular/common", "@angular/compiler", "@angular/core", "@angular/forms", "@angular/platform-browser", "@angular/router", rxjs, tslib, zod]`; `dev: ["@angular/cli", "@angular/build", "@angular/compiler-cli", typescript, vitest, jsdom, angular-eslint, eslint, typescript-eslint, prettier, "@playwright/test"]`.
- **New allowlist names:** the nine `@angular/*` names, `rxjs`, `tslib`, `angular-eslint`.
- **Tools:** bun, node, git. Tags: `[typescript, angular, web, spa, scripts, bun, node]`.
- **Setup note:** the workspace files (`angular.json`, tsconfigs) are the part most tied to the CLI release. Ship them, written against a current release, and tell the agent to run `ng update`-style migrations only through the installed CLI, never to regenerate the workspace over shipped files.
- **Proving slice:** `src/main.ts` (`bootstrapApplication` with `provideRouter`, `provideHttpClient(withFetch(), withInterceptors(...))`), `src/app/app.config.ts`, `src/app/core/api.service.ts` (typed HttpClient calls, zod-decoded), `src/app/core/error.interceptor.ts` (maps HTTP errors to one `ApiError`), `src/app/features/notes/` (list with `resource`/signals, a reactive form with validators showing field errors), `src/environments/`, `proxy.conf.json` for a dev API and a mock JSON in `public/`. Tests: service with `provideHttpClientTesting`, component with `TestBed`, interceptor; Playwright against the built `dist/` served by `ng serve --configuration production` or a static server.
- **Verify:** install; lint (`ng lint`); typecheck (`ng build` does strict template checks; add `tsc -p tsconfig.spec.json --noEmit` for specs); test (`ng test --watch=false`); build; e2e; serve `ng serve --port ${PORT_WEB}` probing `/` (env `PORT_WEB: "4200"`); readme-filled.
- **Agent-ops:** rules: standalone only, no NgModules; signals and `inject()` over constructor injection; `OnPush`/zoneless-safe code; new code through `ng generate` with flags read from its help. Guard denying `zone.js` installs and `karma`/`jasmine`, and foreground `ng serve`.
- **Fragments:** required `claude-harness`; default `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`, `posthog` (after a branch). SSR (`@angular/ssr`) is a decision, default off.
- **Gotchas:** model memory writes NgModules, `*ngIf` and zone-based tests; the brief must name control flow blocks and signals. `ng` commands prompt for analytics on first run; set `NG_CLI_ANALYTICS=false` in scripts. Angular pins a narrow TypeScript range; install the TypeScript the installed `@angular/compiler-cli` accepts, not the newest.

## 8. `electron-react` (P2): Electron desktop app with React

- **Name:** Electron desktop app with React
- **Description:** An Electron desktop app built with Electron Forge and Vite, with a React renderer, a sandboxed preload exposing a typed IPC API, context isolation, Vitest tests of main and renderer code, and a Playwright test that launches the app.
- **Why distinct:** `tauri-react` is Rust plus a system webview; Electron is all TypeScript on Node and Chromium, the choice when the team has no Rust or needs Node modules in the main process. People ask for "an Electron app" by name.
- **Popularity:** `electron` 11.7M/wk, 123.7k stars (most-starred project in this report); `electron-vite` 2.1M/wk, `@electron-forge/cli` 1.3M/wk.
- **Deps:** `app: [react, react-dom, zod]`; `dev: [electron, "@electron-forge/cli", "@electron-forge/plugin-vite", "@electron-forge/plugin-fuses", "@electron/fuses", "@electron-forge/maker-zip", vite, "@vitejs/plugin-react", typescript, "@types/node", "@types/react", "@types/react-dom", "@biomejs/biome", vitest, "@vitest/coverage-v8", happy-dom, "@testing-library/react", "@testing-library/jest-dom", "@playwright/test"]`.
- **New allowlist names:** `electron`, the four `@electron-forge/*` names, `@electron/fuses`.
- **Tools:** node, npm (see gotchas), git. Tags: `[typescript, react, desktop, electron, scripts, node]`.
- **Proving slice:** `src/main/index.ts` (window creation with `contextIsolation`, `sandbox`, no `nodeIntegration`; one `ipcMain.handle` channel), `src/main/settings.ts` (reads and writes a JSON settings file under `app.getPath('userData')`, zod-validated), `src/preload/index.ts` (`contextBridge.exposeInMainWorld` with a typed `api` object, channels from one shared list), `src/shared/ipc.ts` (channel names and payload schemas), `src/renderer/` (React app reading and saving a setting), `forge.config.ts`, three Vite configs. Payload: the renderer saves a setting through IPC, main validates and writes it, and reload shows it. Tests: settings module unit tests against a temp dir, IPC handler tests calling the handler function directly, renderer component tests with a fake `window.api`, Playwright `_electron.launch` against the Vite build checking the window title and the save round trip.
- **Verify:** install; lint; typecheck; test; `package` (`electron-forge package`); e2e; readme-filled. No serve step.
- **Agent-ops:** boundary plugin: `electron` and `node:*` only in `src/main/` and `src/preload/`, never in `src/renderer/`; rule that every IPC channel is in `src/shared/ipc.ts` with a schema validated in main; guard denying `nodeIntegration: true` and `contextIsolation: false` edits, and foreground `electron-forge start`.
- **Fragments:** required `claude-harness`; default `git-hooks`, `ci-github` (needs a branch to run e2e under `xvfb-run` on Linux); optional `rr`, `ce-plugin`. Signing and notarization need paid accounts and stay out of the base.
- **Gotchas:** Forge's Vite plugin is labeled experimental and minor releases may break it ([Forge docs](https://www.electronforge.io/templates/vite-+-typescript)); pin nothing, but say so in the brief. Playwright drives Electron through the inspector, which the fuses plugin disables in packaged builds; run e2e against the unpackaged build or enable that fuse only for tests. Electron's postinstall downloads the binary; Bun skips untrusted lifecycle scripts, and Forge's packager expects npm's `node_modules`, so default to npm and record it. The alternative toolchain (`electron-vite` plus `electron-builder`) is more downloaded; choose once after a prototype.

## 9. `wxt-extension` (P2): Browser extension with WXT and React

- **Name:** Browser extension with WXT and React
- **Description:** A Chrome and Firefox browser extension (Manifest V3) built with WXT and React, with a popup, a background service worker, a content script, typed messaging and storage, Vitest tests on WXT's fake browser, and a Playwright test that loads the built extension in Chromium.
- **Why distinct:** A product kind with no stack; extensions have their own runtime split (service worker, content script, popup) and their own failure modes. WXT is now the default framework for new extensions.
- **Popularity:** `wxt` 1.1M/wk against `plasmo` 577K and `@crxjs/vite-plugin` 632K; `@types/chrome` 6.1M/wk shows the size of the extension ecosystem; wxt 10.7k stars.
- **Id note:** `browser-extension` names the product but not the technology; anatomy prefers framework plus kind. The search card must carry "chrome extension", "firefox add-on", "manifest v3".
- **Deps:** `app: [react, react-dom, zod]`; `dev: [wxt, "@wxt-dev/module-react", typescript, "@types/react", "@types/react-dom", "@biomejs/biome", vitest, "@vitest/coverage-v8", happy-dom, "@testing-library/react", "@testing-library/jest-dom", "@playwright/test"]` (from the [official React template](https://github.com/wxt-dev/wxt/tree/main/templates/react)).
- **New allowlist names:** `wxt`, `@wxt-dev/module-react`.
- **Tools:** bun, node, git. Tags: `[typescript, react, extension, browser, scripts, bun, node]`.
- **Proving slice:** `wxt.config.ts` (manifest permissions: `storage`, one host permission), `entrypoints/background.ts` (message handler), `entrypoints/content.ts` (on a matched page, counts something and reports it), `entrypoints/popup/` (React popup showing the stored count and a toggle), `utils/messages.ts` (typed message schema), `utils/storage.ts` (`storage.defineItem` with a version and fallback). Tests: unit tests with `WxtVitest()` and `fakeBrowser.reset()` ([WXT unit testing](https://wxt.dev/guide/essentials/unit-testing)); popup component test; Playwright `launchPersistentContext` with `--load-extension=.output/chrome-mv3` opening the popup URL and a fixture page served locally.
- **Verify:** install (runs `wxt prepare`); lint; typecheck (`tsc --noEmit`); test; build (`wxt build`, plus `wxt build -b firefox` if Firefox is a decision); e2e; `zip` (proves the store artifact); readme-filled. No serve step.
- **Agent-ops:** rule on context boundaries (no DOM in background, no `chrome.*` privileged APIs in content scripts, everything crosses through typed messages); guard on `.output/` and `.wxt/`; guard denying foreground `wxt` (it opens a browser) and the `chrome` global (use WXT's `browser`); rule that a new permission needs a README justification, since store review asks.
- **Fragments:** required `claude-harness`; default `git-hooks`, `ci-github` (needs Chromium installed for e2e); optional `rr`, `ce-plugin`. Store publishing needs developer accounts and stays out.
- **Gotchas:** WXT is pre-1.0; config keys and import paths change, read installed docs. Mocks must target real module paths, not `#imports` (WXT docs). Playwright's extension loading needs a persistent context and Chromium (not branded Chrome), and headless support depends on the channel; read Playwright's current Chrome extensions page. `wxt` dev auto-opens a browser; verify must never call it.

---

## Ranking rationale

1. **`react-vite`**: largest demand, zero new allowlist names, smallest stack; fills the biggest hole (client-only React).
2. **`hono-api`**: gives TypeScript a non-Effect API, admits `rest-api`, `docker-deploy` and later `drizzle-postgres`; reuses names `mobile-expo` already allowlisted.
3. **`typescript-mcp`**: the most on-target product for stacks' own users; small, no account, and its mistakes are exactly what a brief and a guard hook prevent.
4. **`nuxt`**: covers Vue (17.2%); already planned for Batch 2.
5. **`nestjs-api`**: 5.8% and the enterprise API default; larger to write and the Nest 12 toolchain shift needs a prototype.
6. **`typescript-library`**: distinct and cheap; ranked below the apps only because its audience is narrower.
7. **`angular`**: big usage but a heavy, release-sensitive workspace; worth it, after the cheaper P1s.
8. **`electron-react`**: popular, but the Forge Vite plugin is experimental and the package-manager question needs a prototype; partial overlap with `tauri-react`.
9. **`wxt-extension`**: distinct and wanted, smaller audience, pre-1.0 framework.

Suggested batching (fits the plan's "a batch is what can be benched in one cycle"): `react-vite`, `hono-api`, `typescript-mcp` first; `nuxt`, `nestjs-api`, `typescript-library` second; the P2 three after. Total new allowlist names: about 50, most from Nest and Angular.

## Rejected or deferred

| Candidate | Why not now |
| --- | --- |
| `tanstack-start` | 9.9M/wk and real interest (top State of JS write-in), but 1.0 stable was declared in October 2026 per [Appwrite](https://appwrite.io/blog/post/tanstack-start-stable-appwrite-sites) (the [official post](https://tanstack.com/blog/announcing-tanstack-start-v1) I could verify is the September 2025 RC). Overlaps `nextjs`, `react-router` and `cloudflare-react-router`. Revisit next cycle; first in line if a tenth stack is wanted. |
| `express-api` | Most-used Node API framework (15.6%, 196.6M/wk), but as a recipe it's a variant of `hono-api`: same layout, same verify, different router. Add only if users ask for Express by name; the prior research outline stands. |
| `fastify-api` | 3.5% and 21M/wk; same variant problem as Express, with less demand. |
| Vue SPA (`vue-vite`) | `nuxt` with SSR off covers it; two Vue stacks before one is proven is premature. |
| Remix | Merged into React Router v7; `react-router` covers it. |
| SolidStart | `@solidjs/start` 163K/wk, SO 1.5%; too small for a bundled entry. |
| Qwik | `@builder.io/qwik` 63K/wk, v2 still RC (`@qwik.dev/core` 2.0.0-rc). |
| Turborepo monorepo | A repository layout, not a product; belongs as a fragment or the `monorepo` tag on existing stacks. |
| Discord or Slack bot | `discord.js` 1.7M/wk, `@slack/bolt` 3.9M/wk, but proving the wiring needs a bot token and a workspace; without credentials verify can only test mocks, which breaks "a green verify proves it works". |
| VS Code extension | Credible (`@types/vscode` 2.5M/wk), but `@vscode/test-cli` (still 0.0.x) downloads VS Code and opens a window on macOS, which is fragile under an agent and in CI. Strong P3; prototype the headless story first. |
| Elysia | Bun-only, 1.9M/wk; the registry runs servers on Node by policy. |
| Plasmo, CRXJS | WXT has overtaken both in downloads and maintenance. |
| Starlight docs site | An `astro-blog` sibling; prior research's call (fragment after an Astro refactor) still holds. |
| Analog (Angular meta-framework) | Too small; `angular` comes first. |

## What to prototype before authoring

- Nest 12 under Vitest: does the default transformer emit decorator metadata, or is `unplugin-swc` needed? Does `nest build` work with Bun's `node_modules`?
- Electron Forge 8 with Bun versus npm, and Playwright against the packaged versus unpackaged build.
- `@nuxt/test-utils` config shape for Vitest 5 projects.
- Angular 22 with `bun install`, and `ng test` (Vitest) headless output parsing for verify.
- MCP Inspector CLI flags for the smoke step.
- Playwright headless extension loading on macOS for WXT.

## Sources

- Stack Overflow Developer Survey 2026, web frameworks: https://survey.stackoverflow.co/2026/technology/data/web-framework
- State of JavaScript 2025, back-end frameworks: https://2025.stateofjs.com/en-US/libraries/back-end-frameworks/
- State of JavaScript 2025, meta-frameworks: https://2025.stateofjs.com/en-US/libraries/meta-frameworks/
- npm downloads API (week 2026-10-23 to 2026-10-29): https://api.npmjs.org/downloads/point/last-week/<package>
- GitHub stars via `gh api repos/<owner>/<repo>` on 2026-10-31
- NestJS starter package.json: https://github.com/nestjs/typescript-starter/blob/master/package.json ; Nest 12 release: https://github.com/nestjs/nest/releases/tag/v12.0.0 ; InfoQ on Nest 12 ESM: https://infoq.com/news/2026/04/nestjs-12-roadmap-esm
- Angular 21 changes: https://blog.ninja-squad.com/2025/11/20/what-is-new-angular-21.0 , https://www.angulararchitects.io/blog/whats-new-in-angular-21-signal-forms-zone-less-vitest-angular-aria-cli-with-mcp-server/
- Nuxt v4 starter: https://github.com/nuxt/starter/blob/v4/package.json
- MCP TypeScript SDK README: https://github.com/modelcontextprotocol/typescript-sdk
- WXT unit testing: https://wxt.dev/guide/essentials/unit-testing ; WXT React template: https://github.com/wxt-dev/wxt/tree/main/templates/react
- Electron Forge Vite + TypeScript template: https://www.electronforge.io/templates/vite-+-typescript
- TanStack Start: https://tanstack.com/blog/announcing-tanstack-start-v1 , https://appwrite.io/blog/post/tanstack-start-stable-appwrite-sites
- Prior research: `plans/research/registry-expansion-stacks-2026-10-29.md`, `plans/registry-expansion.md`
