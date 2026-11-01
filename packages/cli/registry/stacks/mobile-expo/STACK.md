---
schema_version: 1
id: mobile-expo
kind: stack
name: Expo app + Hono API
description: Bun-workspace monorepo with an Expo Router app (NativeWind, TanStack Query), a Bun + Hono API (zod-openapi, Drizzle on Postgres), and a shared zod schemas package; the app reaches the API through a typed Hono client behind a hooks layer.
tags: [typescript, react, react-native, mobile, api, fullstack, monorepo, scripts, bun, node]
deps:
  api: [hono, "@hono/zod-openapi", "@scalar/hono-api-reference", drizzle-orm, zod]
  api-dev: [drizzle-kit, pg, "@types/bun", typescript]
  schemas: [zod]
  mobile: [expo, expo-router, expo-constants, expo-linking, expo-status-bar, react, react-dom, react-native, react-native-web, react-native-safe-area-context, react-native-screens, react-native-reanimated, react-native-worklets, nativewind, react-native-css, "@tanstack/react-query", hono, zod]
  mobile-dev: [jest, jest-expo, "@testing-library/react-native", "@types/jest", "@types/react", tailwindcss, "@tailwindcss/postcss", postcss, typescript]
  root-dev: ["@biomejs/biome", typescript]
tools: [bun, node, docker, git]
decisions:
  - "Node version for Expo's CLI and jest: current LTS (default), recorded in .node-version."
  - "Postgres image: the official image, current major, alpine variant (default)."
  - "Commit the generated native ios/ and android/ directories: no (default); prebuild regenerates them."
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github, clerk]
  optional: [ce-plugin, rr]
env:
  PORT_API: "3000"
  PORT_DB: "5432"
verify:
  - { name: install, phase: setup, layer: install, run: bun run setup }
  - { name: db-up, phase: setup, layer: install, run: bun run db:up }
  - { name: db-migrate, phase: setup, layer: install, run: bun run db:migrate }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run test }
  - { name: harness-contract, layer: test, run: bun run test:api test/harness-contract.test.ts }
  - { name: auth-provider, layer: test, run: bun run test:mobile --runInBand test/auth-provider.test.tsx }
  - { name: ci-contract, layer: test, run: bun run test:ci }
  - { name: db-check, layer: check, run: bun run db:check }
  - { name: bundle, layer: build, run: bun run bundle }
  - { name: expo-deps, layer: check, run: bun run expo:check }
  - name: api
    phase: serve
    layer: serve
    run: bun run dev:api
    expect: { http: "http://localhost:${PORT_API}/health/ready", within: 60s }
  - { name: db-down, phase: teardown, layer: install, run: bun run db:down }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  setup: Install dependencies, create .env from .env.example, link apps/mobile/.env (idempotent)
  prepare: Install git hooks outside CI (runs after every bun install)
  dev: The whole dev stack (scripts/dev.sh), logged to .logs/dev.log
  dev:api: API with watch on PORT_API
  dev:mobile: Metro
  dev:logs: Follow .logs/dev.log with terminal escape codes stripped
  sim:shot: Screenshot the booted iOS simulator and print its background colours
  lint: biome check .
  format: biome check --write .
  typecheck: tsc --noEmit in every workspace (Expo route types first)
  test: Every workspace's tests (the API suite needs Postgres up)
  test:api: The API suite (bun test)
  test:mobile: The mobile suite (jest)
  test:ci: Test path-filtered workflow contracts locally
  bundle: Expo export for iOS and Android into an ignored directory
  expo:check: Expo's own dependency check against the installed SDK, in apps/mobile
  db:up: Start Postgres and wait until healthy
  db:down: Stop Postgres, keeping data
  db:generate: Generate a migration from the Drizzle schema
  db:migrate: Apply migrations
  db:check: Fail if the migration folder disagrees with the schema
  check: lint, typecheck, test, db:check, bundle, expo:check
---

# Expo app + Hono API

## What stacks wrote

A Bun workspace with an Expo Router screen calling the Hono health route through TanStack Query and a typed client, shared zod schemas, a database-backed `GET /items?limit=1`, readiness, JSON errors and request logs, Drizzle's schema and initial migration, API and mobile tests, configs, dev scripts and reference docs. Clerk, CI and agent instructions belong to their fragments. Read the code before extending it.

## Layout

`apps/api/src/routes/` holds literal OpenAPI routes; `services/` owns queries; `db/` owns connections and tables. `packages/schemas/src/` is the shared wire contract. `apps/mobile/src/app/` holds screens; `lib/queries/` owns data access. Workspace packages use the project slug followed by `-api`, `-mobile` and `-schemas`, so an unset package scope still produces valid names. They export raw TypeScript.

## Setup

1. Add the declared deps in their workspaces and root-dev at the root. Add the schemas workspace to API and mobile, and the API workspace to mobile, using `workspace:*`. Install Expo first, then let `expo install` choose SDK-compatible mobile packages, including jest, jest-expo, React types and TypeScript. For NativeWind's CSS-first release line, read its current installation guide and install the matching NativeWind/CSS-engine pair from its prerelease channel when necessary. Keep Tailwind and its PostCSS plugin aligned. If the engine requires a compatible transitive compiler override, use the release's documented supported compiler and record its removal condition under Build workarounds.
2. Run `bun run setup`. Fill `POSTGRES_IMAGE` in `.env` with the current official Postgres alpine image. Confirm the image's documented volume layout matches `compose.yaml`. Move `PORT_DB` and `DATABASE_URL` together when that port is busy. Set `EXPO_PUBLIC_API_URL` when the API moves off its default port. Start Docker, then `bun run db:up` and `bun run db:migrate`. The migration is already shipped; generate a new one only after changing the schema.
3. Run the checks. Update shipped code/config rejected by the installed releases without dropping a rule, test or check. Use the installed Expo CLI's headless route-type generation command before mobile's tsc if the CLI changes it. Native directories remain generated and ignored; run the installed CLI's prebuild command only for a native simulator/device build, preserving the shipped app.
4. Apply each selected fragment. Extend `Providers` and `test/render.tsx` together so the root layout and tests mount the same providers. Clerk owns auth modules, sign-in, API verification and `test/auth-provider.test.tsx`; its offline matrix uses real hooks/hc and SDK-boundary stubs. When Clerk is excluded, add that test for the anonymous seam: request succeeds without Authorization and no Clerk import. CI owns the workflow; `tests/ci-contract.test.ts` parses it with Bun's YAML parser. Keep the API/mobile/bundle filters and command checks green. If CI is excluded, the test requires an absent workflow.
5. Record Node in `.node-version` and the installed Bun version as `packageManager` in root `package.json` (CI reads them). Fill README and AGENTS.md with the real commands, scoped test instructions and pending account/device/hosted-CI work. Run `stacks verify` until green.

## Conventions

Read `docs/api.md`, `docs/mobile.md` and `docs/testing.md` for the boundaries the slice enforces.

- Keep schemas in the shared package, named with zod's own `.meta({ id })`; mobile never loads zod-openapi's runtime augmentation.
- Keep `client.ts` types-only and middleware in `app.ts`. Routes reach Drizzle through services; only `db/index.ts` imports Bun's SQL client. The transitive import-graph tests cover these boundaries.
- Preserve `{ message: string }` for all errors, including zod failures, 404, readiness 503 and unexpected 500. Log unexpected failures once, with request correlation and no headers, tokens or payloads.
- Connections are lazy and keyed by URL. `createApp(url)` binds each test's database to its own app, even when another file changes process env. Validate boot config before listening.
- Screens import query hooks, never the client. Hooks own keys, stale times, response validation and error mapping. Keep one production QueryClient with one query retry, no mutation retry and no focus refetch.
- API URL uses the explicit public env value or Metro's hostname on the default API port. A release must reject missing/placeholder URLs. Styling uses semantic NativeWind tokens in `src/global.css`; third-party components register in `components/styled.ts`.

## Testing

API tests use real Postgres and `setupApiTest(label)`: one migrated template per process under an advisory lock, a clone per file, dynamic app import after env setup, exact ownership cleanup. `harness-contract` checks migration reuse and failed-fixture cleanup and starts two actual API test files in parallel. Add route cases to these harnesses instead of mocking services.

Mobile tests render the real providers, query hook and hc client, with a fresh QueryClient and no retries or GC timer. Only fetch, native bindings and the fragment's external Clerk SDK may be stubbed. Await Testing Library's render, events and unmount. Bundle checks both native targets; neither Jest nor Metro certifies native layout or an account login. `docs/acceptance/mobile-expo.md` names the extra fragment acceptance cases.

## Commands

The root scripts are shipped and delegate to workspace scripts. `setup` installs dependencies, copies missing env and links mobile's env. `dev` runs the preserved owner-scoped supervisor, with output in `.logs/dev.log`; `dev:logs` and `sim:shot` aid simulator debugging. API/mobile scripts keep `dev` and `ios` names for the supervisor. Typechecking includes scripts and every workspace.

`db:up` waits for Postgres; `db:down` stops it without deleting data. `db:check` validates migration metadata and generates against a temporary copy to detect uncommitted schema changes. `test` runs API, mobile and CI contracts; `check` adds lint, typecheck, migration checks, bundle and Expo dependency checks. Keep the names in Commands and AGENTS.md.
<!-- stacks:when with=git-hooks -->

If `scripts/prepare.ts` already runs `lefthook install`, don't add another install step. Pre-push starts Postgres before tests; document that it leaves Postgres running.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->

CI jobs cover lint, typecheck, mobile, API and bundle. Use `test:api`/`test:mobile` (no coverage command is declared). API runs migrations and `db:check` against a Postgres service; mobile and bundle set up Node from `.node-version`. The bundle job also runs `expo:check`. Use `changes` outputs named `api`, `mobile`, `bundle`, from a paths-filter step named `filter`. Every filter covers shared config, lockfile and workflow paths; mobile and bundle also cover API/schema changes. Always-running `ci-ok` rejects failed/cancelled jobs and accepts intentional skips.
<!-- stacks:end -->

## Gotchas

- Expo and jest-expo run on Node. Never run mobile tests with `bun test`. Keep jest-expo's own transform allowlist when extending it for workspace and NativeWind source.
- Expo reads env from `apps/mobile`; public values are inlined. Keep the root-env symlink, put environment-specific release values in EAS profiles, and clear Metro after changes.
- bun:test shares modules across files. Read env per call and bind a database per app. Close template connections before cloning; never delete databases inferred from a prefix.
- `.openapi()` on a shared zod schema can typecheck and crash in mobile. Use `.meta()`.
- NativeWind's CSS engine and its compiler must agree. Follow its installation guide's compiler compatibility instructions when export reports a deserialization error; remove an override once a current compiler works.
- A blank screen may be an unstyled third-party component or a loading gate. Read dev logs and the simulator debugging guide. Jest computes no native layout.
- Expo config plugins can add signing entitlements that break simulator builds. Gate them to EAS builds and record any workaround.
