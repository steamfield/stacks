---
schema_version: 1
id: typescript-cli
kind: stack
name: TypeScript CLI with Effect
description: A Bun-compiled TypeScript CLI with Effect commands and services, strict stdout/JSON contracts, lazy config, structured logs, Vitest, and compiled-binary tests.
tags: [typescript, cli, effect, bun, scripts, node]
deps:
  app: [effect, "@effect/platform-bun"]
  dev: ["@effect/platform-node", typescript, "@biomejs/biome", vitest, "@vitest/coverage-v8", "@types/bun", "@types/node"]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version and engines.node; Node runs Vitest and Bun runs the binary."
  - "Binary name: project slug (default), with project-owned environment variables prefixed by its uppercase form."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github, effect]
  optional: [rr, ce-plugin, bun-release, openrouter-ai, openrouter-chat-cli]
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run test }
  - { name: config-logging, layer: test, run: bun run test:unit tests/config-logging.test.ts }
  - { name: binary, layer: test, run: bun run e2e }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  dev: Run the CLI from source with checkout-local logs and data
  build: Compile the host binary
  typecheck: Run tsc without emitting
  lint: Run Biome checks
  format: Apply Biome formatting and safe fixes
  test: Run the unit suite
  test:unit: Run Vitest on Node
  test:watch: Watch unit tests
  coverage: Run unit tests with coverage
  e2e: Build and exercise the compiled binary using Bun
  check: Run lint, typecheck, tests, and compiled-binary checks
  clean: Remove generated build, test, and log output
  prepare: Install project hooks outside CI
---

## What stacks wrote

A Bun-compiled CLI with one `doctor` command: `src/bin.ts` supplies the platform, `main.ts` owns the output/error boundary, and `config.ts`, `logging.ts`, `services/` and `schemas/` carry the shared contracts. The `greeting` setting proves file/env/default precedence through human and JSON results. Source tests, config/logging regressions, compiled-binary tests, tool configs and reference docs ship with it; read the code before extending it.

## Setup

1. Add every declared app and dev dependency with `bun add` and `bun add -d`, resolving current compatible releases together. Check Effect's current exports and peer ranges; its CLI module is part of `effect`, never the separate legacy CLI package. Select current Node LTS and use its major for `@types/node`.
2. Run `bun run check`. Where the installed releases reject a shipped API or config key, update the shipped code or config to that release while preserving every check and lint rule. No generator is needed.
3. Record Node LTS in `.node-version` and `engines.node`, and installed Bun in `packageManager`. Record necessary compatibility workarounds and their removal conditions under Build workarounds in AGENTS.md.
4. Fill README's markers with the actual commands, config defaults and architecture. Fill AGENTS.md and the selected harness docs before adding features. Follow the selected fragments, then run `stacks verify` until green.

Read `docs/guidance/typescript-cli/index.md` before changing the corresponding code. The config/logging acceptance matrix in `docs/acceptance/typescript-cli.md` is implemented by `tests/config-logging.test.ts` and runs separately in verify.

## Layout and conventions

- New commands follow `commands/doctor.ts`: thin Effect CLI handlers calling programs in `core/`, with schemas in `schemas/` and results through Output. Add them to `cli.ts`.
- Services are namespaced Context.Service classes with static layers. Yield dependencies in constructors; call lazy config only inside the methods that need it. State belongs to one invocation. `runtime.ts` composes AppLayer; only `bin.ts` supplies BunServices, Host and process writers, while tests supply NodeServices.
- `config.ts` layers environment over a closed optional config file. New settings get schema validation, a precedence test, and entries in `.env.example` and README. Paths and logging stay usable when application config is broken; doctor reports the problem.
- Extend `errors.ts` with a tagged class and an exhaustive error-table row. Preserve stable exit codes and safe messages; defects remain generic failures. Add upstream/retry policies only with an upstream integration.
- Output buffers stdout until success. Results, help and version belong there; failures leave it empty and render once on stderr. `--json` returns one JSON value, with a final stderr error envelope on failure. JSON logs on stderr precede that envelope. EPIPE exits quietly.
- Use Effect logging with scalar annotations. `logging.ts` owns UTC JSON records, reserved names, secret-key redaction, and the best-effort file sink. Never log argument values, payloads, credentials or raw third-party errors.
- Keep core code platform-free. Both the shipped Grit plugin and Claude's guards enforce Bun, environment, schema and stdout boundaries. Keep those rules when adapting tool configs.

## Testing and commands

`src/*.test.ts` tests pure contracts; `tests/cli.test.ts` drives the real parser and invocation boundary with temporary files and real Node services. `tests/config-logging.test.ts` asserts emitted and suppressed records, precedence, sink failure and isolation. `e2e/binary.test.ts` starts the compiled artifact with a clean environment and proves file-only logging, env overrides, safe errors and disabled dotenv autoload. A new command extends the argv-level and binary contracts. No mocks of project services.

The shipped package scripts are the command contract: `dev`, `build`, `lint`, `format`, `typecheck`, `test`, `test:unit`, `test:watch`, `coverage`, `e2e`, `check`, `clean`, `prepare`. Vitest runs on Node; Bun runs only scoped compiled-binary tests. `scripts/dev.ts` keeps logs under `logs/` and data under `.dev/data`; it preserves terminal behavior, arguments and status.

<!-- stacks:when with=git-hooks -->
If `scripts/prepare.ts`, run by the `prepare` script after every `bun install`, already runs `lefthook install`, don't add another install step. pre-push runs `bun run typecheck` alongside `bun run test`, in parallel.
<!-- stacks:end -->

<!-- stacks:when with=ci-github -->
CI reads Bun from packageManager and Node from .node-version, installs frozen dependencies, then runs lint, typecheck, coverage and binary e2e. Upload logs and coverage on failure; keep optional app/release checks separate.
<!-- stacks:end -->

## Gotchas

Never force Vitest onto Bun or run unscoped `bun test`. Bun source commands can autoload .env; both runners load the shipped isolation helper before application code, and binary tests construct env from scratch. The compiled build explicitly disables dotenv and bunfig autoload.

Check installed Effect APIs, TypeScript options and Bun compile flags before adapting them. The entry uses the promise runner and maps interrupted exits to 130, avoiding runtime teardown type assertions. Dispose scopes on every outcome and never start another runtime inside Effect code. The Effect service model stays mandatory even without its testing fragment.
