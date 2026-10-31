---
schema_version: 1
id: typescript-library
kind: stack
name: TypeScript npm library
description: A TypeScript package for npm, built to ESM with bundled type declarations by tsdown, checked by publint and Are the Types Wrong, tested with Vitest, and proven by installing the packed tarball into a clean consumer project.
tags: [typescript, library, npm, node, bun, scripts]
deps:
  dev: [typescript, tsdown, publint, "@arethetypeswrong/cli", "@biomejs/biome", vitest, "@vitest/coverage-v8", "@types/node"]
tools: [bun, node, git]
decisions:
  - "Package name: the project slug (default), or a scoped name such as @scope/name when the person owns that npm scope. A rename also changes the imports in tests/consumer/."
  - "Module format: ESM only (default). Add a CommonJS build only when a named consumer can't load ESM; then tsdown emits both formats, exports gains require conditions, and lint:package drops attw's esm-only profile."
  - "Runtime: platform neutral (default), so the package runs in Node, Bun, Deno and browsers. A Node-only package sets tsdown's platform to node and drops the runtime-import rule from biome-plugins/boundaries.grit."
  - "Publishing: the package keeps \"private\": true (default) until the person decides to publish. Then they remove it, add license, repository and author, and publish themselves, from their machine or CI with npm provenance."
  - "Node version: current LTS (default), recorded in .node-version. Node runs Vitest and the consumer check; Bun installs, runs scripts and packs."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run coverage }
  - { name: build, layer: build, run: bun run build }
  - { name: package-lint, layer: lint, run: bun run lint:package }
  - { name: consumer, layer: test, run: bun run test:consumer }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  build: Bundle src/index.ts into dist/ with declarations (tsdown)
  typecheck: Run tsc over the library, tests and tooling
  lint: Run Biome checks, including the boundary plugin
  "lint:package": Pack the package and check it with publint and Are the Types Wrong
  format: Apply Biome formatting and safe fixes
  test: Run Vitest once
  "test:watch": Watch Vitest tests
  "test:consumer": Pack, install the tarball into a temporary copy of tests/consumer, typecheck and run it on Node
  coverage: Run Vitest with coverage thresholds
  check: Run lint, typecheck, coverage, the package checks and the consumer check
  clean: Remove build, coverage and tarball output
  prepack: Build before any pack, so a tarball never holds a stale dist/
  prepare: Install git hooks outside CI
---

# TypeScript npm library

## What stacks wrote

A publishable TypeScript package with one payload, `slugify` (and `safeSlugify`, which returns a result instead of throwing). `src/index.ts` is the only entry point and names every export; `src/errors.ts` holds `LibraryError`, its codes and `isLibraryError`; `src/options.ts` the options interface, frozen defaults and runtime checks; `src/internal/` private helpers. `package.json` declares an ESM-only `exports` map, `files`, `sideEffects: false` and no dependencies, and stays `"private"`. `tsdown.config.ts` builds `dist/` with bundled declarations. Tests run on Vitest: unit tests beside the code, `tests/public-api.test.ts` pinning the export list, `tests/boundaries.test.ts` probing the Biome plugin, and `scripts/consumer.ts`, which installs the packed tarball into a copy of `tests/consumer/` and typechecks and runs it. The configs, package scripts and `docs/guidance/typescript-library/` ship too. Read the code before extending it.

Link `docs/guidance/typescript-library/index.md` from AGENTS.md.

## Layout

- `src/<feature>.ts` for each public module, with `src/<feature>.test.ts` beside it; `src/internal/` for helpers `src/index.ts` never re-exports.
- `tests/consumer/`: a stand-alone project importing the package by name (`index.ts` with types, `index.mjs` without). It is excluded from the root tsconfig and from Vitest; `test:consumer` runs it.
- `biome-plugins/boundaries.grit`: the boundary rules, probed by `tests/boundaries.test.ts`.

## Setup

1. Add every declared dependency at its current release with `bun add -d`; the package has no runtime dependencies. Match `@types/node` to the chosen Node major.
2. Write the Node LTS to `.node-version` and the Bun version to `packageManager`. Add a `version` field: a `0.x` pre-release while the API settles. Packing needs it, so `lint:package` and `test:consumer` fail until it is there.
3. Fill `description` in `package.json`, and rename the package if the person chose a scoped name (update `tests/consumer/` imports with it).
4. Run `bun run lint`, `bun run typecheck`, `bun run coverage`, `bun run build`, `bun run lint:package` and `bun run test:consumer`. Where an installed release rejects shipped code or config (a moved tsdown option, a renamed attw flag), update it from that release's docs or declarations, keeping every check, lint rule and assertion.
5. Fill the README's `stacks:fill` markers and AGENTS.md (commands, a single-file test example, the public API rule, the guidance link), then run `stacks verify` until green.

## Conventions

The shipped code keeps these; new code does too. `docs/guidance/typescript-library/library.md` has the detail.

- The public API is the named exports of `src/index.ts`: no `export default`, no `export *`, nothing from `src/internal/`. A change to it updates README.md's API section, `tests/public-api.test.ts` and `tests/consumer/` together, and names its release kind (patch, minor, major) in the summary.
- Every export has an explicit type; `isolatedDeclarations` fails tsc without one, and tsdown's declaration build depends on it.
- Throw only `LibraryError` with a code; `field` names the argument or option, never its value. A new code adds a row to the README's error table.
- Options are an interface of optional `readonly` fields, checked at runtime with frozen defaults; an unknown key is an `invalid_option` error.
- `src/` imports no `node:*` or `bun`, reads no `process` and never logs. The Grit plugin fails lint on a break.
- A dependency the build imports goes in `dependencies` (or `peerDependencies`), and so does a `@types/*` package a public type refers to. Adding one is the person's decision.
- Publishing, `npm version`, tags and dist-tags are the person's steps; the guard hook denies them.

## Testing

Unit tests sit beside the code as `test.each` tables of input and exact output, and of input and the `{ code, field }` it raises. `tests/public-api.test.ts` pins the runtime export list. `tests/boundaries.test.ts` writes fixture files and checks each Grit rule fires once with its message. `test:consumer` is the only test of what users install: it catches a wrong `exports` map, a file missing from `files`, declarations that don't match the build, and a dev dependency the build needs. A new export adds rows to all of them. Details in `docs/guidance/typescript-library/testing.md`.

<!-- stacks:when with=ci-github -->
CI sets up Bun from `packageManager` and Node from `.node-version`, installs frozen dependencies, then runs lint, typecheck, coverage, `lint:package` and `test:consumer`. Nothing is published and no credentials are needed; a release workflow is a later decision.
<!-- stacks:end -->

## Commands

`package.json` wires every declared command; mirror them in AGENTS.md with a scoped example such as `bun run test src/slugify.test.ts`. `bun pm pack --dry-run` lists what would ship.

<!-- stacks:when with=git-hooks -->
`scripts/prepare.ts` already runs `lefthook install` when `lefthook.yml` exists outside CI, so don't add another installer.
<!-- stacks:end -->

## Gotchas

- tsdown is pre-1.0 and its options move between releases; read the installed `tsdown` declarations before changing `tsdown.config.ts`. With `isolatedDeclarations` on, its declarations come from oxc and need no TypeScript compiler API, which TypeScript's native compiler doesn't ship.
- With `"type": "module"` and ESM-only output, tsdown writes `dist/index.js` and `dist/index.d.ts`; `exports` must name those files. publint fails a path that doesn't exist.
- `attw` reports CommonJS resolution problems for an ESM-only package unless it runs with `--profile esm-only`. It packs with `npm pack`, so Node's `npm` must be on PATH.
- Packing needs `version`. Without one, `bun pm pack`, publint and attw all fail before checking anything.
- Tests that import `src/` pass while the package is broken; only `test:consumer` sees the tarball.
- The tests and scripts run on Node: never `bun test` or `--bun`. The guard hook denies them.
- `instanceof LibraryError` fails across two installed copies of the package; `isLibraryError` doesn't.
