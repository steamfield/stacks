---
schema_version: 1
id: nestjs-api
kind: stack
name: NestJS API on Node
description: A TypeScript JSON API on NestJS served by Node, with feature modules, class-validator DTOs behind a global validation pipe, one exception filter rendering every error as the same envelope, request ids and JSON logs, Swagger docs, and Vitest unit specs plus Supertest contract tests on the real app module.
tags: [typescript, api, nestjs, node, bun, scripts]
deps:
  app: ["@nestjs/common", "@nestjs/core", "@nestjs/platform-express", "@nestjs/config", "@nestjs/swagger", reflect-metadata, rxjs, class-validator, class-transformer]
  dev: ["@nestjs/cli", "@nestjs/schematics", "@nestjs/testing", typescript, "@types/node", "@types/express", vitest, "@vitest/coverage-v8", supertest, "@types/supertest", oxlint, oxlint-tsgolint, prettier]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version. Node runs the server and Vitest; Bun installs and runs scripts; nest build compiles with tsc."
  - "HTTP platform: Express through @nestjs/platform-express (default), or Fastify through @nestjs/platform-fastify on request, which changes configureApp, the request-context middleware and the body limit."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github, rest-api]
  optional: [rr, ce-plugin]
env:
  PORT_API: "3000"
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run test }
  - { name: e2e, layer: test, run: bun run test:e2e }
  - { name: build, layer: build, run: bun run build }
  - name: api
    phase: serve
    layer: serve
    run: "bun run start"
    expect: { http: "http://localhost:${PORT_API}/healthz", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  dev: Run nest start --watch, rebuilding and restarting on change
  build: Compile src/ into dist/ with nest build
  start: Run the built server on Node
  typecheck: Run tsc over the app, tests and tooling
  lint: Run oxlint with type-aware rules, then the Prettier check
  format: Apply Prettier formatting
  test: Run the unit specs and harness hook tests once
  test:e2e: Run the Supertest contract tests against the real app module
  test:watch: Watch the unit specs
  coverage: Run both test projects with coverage thresholds
  check: Run lint, typecheck, coverage and the build
  clean: Remove build and coverage output
  prepare: Install git hooks outside CI
---

# NestJS API on Node

## What stacks wrote

A NestJS API with one payload, an in-memory notes feature module (list, get, create under `/v1`) beside a health module. `src/main.ts` builds the app, switches to the JSON logger at the configured level and listens; `src/app.setup.ts::configureApp` applies what modules can't (the request-context middleware, the JSON body limit, URI versioning, shutdown hooks, Swagger at `/docs` and `/openapi.json`); `src/app.module.ts` imports the validated `ConfigModule` and the feature modules and registers the global `ValidationPipe` and `ErrorEnvelopeFilter`. `src/config/env.ts` validates the environment with class-validator, `src/common/errors.ts` holds the one status table and the envelope, `src/common/logging.ts` Nest's JSON `ConsoleLogger`, and `src/common/request-context.ts` request ids and one log record per request. Unit specs sit beside the code; `tests/e2e/http-contract.e2e-spec.ts` drives the real `AppModule` through Supertest. The configs, package scripts and `docs/guidance/nestjs-api/` ship too. Read the code before extending it.

Link `docs/guidance/nestjs-api/index.md` from AGENTS.md.

## Look up the installed release first

Model memory writes CommonJS Nest with Jest, `ts-node` and `nest new`. This project is ESM (relative imports end in `.js`), tests on Vitest, and compiles with `nest build`. Read the installed declarations (`node_modules/@nestjs/*/**/*.d.ts`) and `bunx nest <command> --help` before changing a Nest call or flag.

## Layout

- `src/<feature>/`: `<feature>.module.ts`, `.controller.ts`, `.service.ts`, `.service.spec.ts` and `dto/`. `src/common/`: errors, the filter, the envelope's OpenAPI classes, logging and request context. `src/config/`: the environment schema.
- `tests/e2e/`: contract specs; `tests/helpers/app.ts`: `testApp()`, the real app with captured log records.
- `nest-cli.json` builds with tsc from `tsconfig.build.json` (`src/` without specs) into `dist/`; `tsconfig.json` checks `src/` and `tests/`, `tsconfig.tools.json` the configs, scripts and harness hooks.

## Setup

1. Add `@nestjs/cli` first with `bun add -d`, then read the `typescript` range in `node_modules/@nestjs/cli/package.json` and add the newest TypeScript release inside it (`bun add -d typescript@<major>`). The Nest CLI drives the compiler through TypeScript's JavaScript API, which the newest major may not ship: `nest build` and `nest g` stop with an error naming the supported major. Then add every other declared app and dev dependency at its current release with `bun add` and `bun add -d`, matching `@types/node` to the chosen Node major.
2. Write the Node LTS to `.node-version` and the Bun version to `packageManager`.
3. Run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:e2e` and `bun run build`. Where an installed release rejects shipped code or config (a renamed option, a moved export), update it from that release's declarations, keeping every check, lint rule and assertion.
4. Fill the README's `stacks:fill` markers (record the toolchain versions and the TypeScript constraint) and AGENTS.md (commands, a single-file test example, the module rules, the guidance link), then run `stacks verify` until green.

## Conventions

The shipped code keeps these; new code does too. `docs/guidance/nestjs-api/api.md` has the detail.

- One feature module per resource. It exports only the services other modules need; other features import the module, never its controller or a second copy of its service.
- Controllers read validated DTOs and call one service method. Services hold the rules and storage, know nothing of HTTP, and throw `AppError` subclasses (`NotFoundError`, `BadRequestError`), never `HttpException`.
- Errors: `ErrorEnvelopeFilter` renders `{ "error": { "code", "message", "requestId", "issues"? } }` with the status from `errorTable`. A new failure adds a row there, a subclass and a contract test. Unexpected errors log their class and stack, never their message.
- DTOs are classes with class-validator decorators and `@ApiProperty`; the global pipe whitelists and forbids unknown fields and query keys. Ids go through `ParseUUIDPipe`.
- Injected classes and DTOs are value imports, never `import type`: decorator metadata carries them.
- Routes live under `/v1` through URI versioning; `/healthz`, `/docs` and `/openapi.json` stay outside it. A create returns 201 with `Location`; a list takes `limit` and `cursor` and returns `nextCursor`.
- Settings come from `ConfigService<Env, true>`; a new one gets a field in `src/config/env.ts`, a default, an `.env.example` line and a spec row. Global pipes, guards, interceptors and filters are `APP_*` providers in `AppModule`.
- Log through `new Logger(<Class>.name)` with flat fields, never bodies, headers, query strings or tokens.

## Testing

Vitest has two projects: `unit` (`src/**/*.spec.ts` and the harness hook tests) and `e2e` (`tests/e2e/**/*.e2e-spec.ts`); verify runs each as its own step. Unit specs build services through `Test.createTestingModule`. Contract specs call `testApp()` and assert statuses, bodies, headers, request records and `/openapi.json`; a new endpoint adds its success, every error status it returns, its validation edges and its path there. Override a provider through `testApp({ notes })` only for failures the real one can't produce. Details in `docs/guidance/nestjs-api/testing.md`.

<!-- stacks:when with=ci-github -->
CI sets up Bun from `packageManager` and Node from `.node-version`, installs frozen dependencies, then runs lint, typecheck, coverage and the build. No credentials are needed.
<!-- stacks:end -->

## Commands

`package.json` wires every declared command; mirror them in AGENTS.md with a scoped example such as `bun run test src/notes/notes.service.spec.ts`. `dev` stays in the foreground: run it in the background, or use `bun run build && bun run start` on a free `PORT_API`, then stop it. `start` serves the last build. Generate with `bunx nest g module|controller|service <name> --no-spec`, module first, then `bun run format`; the `add-resource` skill walks the whole flow.

<!-- stacks:when with=git-hooks -->
`scripts/prepare.ts` already runs `lefthook install` when `lefthook.yml` exists outside CI, so don't add another installer. Format staged TypeScript with Prettier and lint it with oxlint.
<!-- stacks:end -->

## Gotchas

- `import type` of an injected class or a DTO compiles, then Nest injects `undefined` or skips validation, silently. oxlint's consistent-type-imports rule would demand exactly that, so it stays off.
- Node can't run `src/*.ts` directly (decorators aren't erasable syntax), and `bun src/main.ts` runs the server on a runtime the project doesn't serve on. The guard hook denies both, plus `bun test`, `--bun`, Jest and ts-node installs, `nest new`, and a `typescript` add without a version.
- `nest g` writes unformatted code, registers in the nearest module (generate the module first), and without `--no-spec` writes a spec that uses Jest globals, which typecheck rejects.
- The app is created with `bodyParser: false` so `configureApp` sets the limit; a test app created without it parses bodies with Nest's default limit first.
- The request record is written when the response finishes, sometimes after Supertest resolves; tests wait with `vi.waitFor`.
- `ConfigModule.forRoot` validates while the app is created. `abortOnError: false` lets `main.ts` exit 2 with the variable names; Nest also prints that error once through its startup logger.
- Drop the TypeScript constraint once the Nest CLI's declared range includes the newest major.
