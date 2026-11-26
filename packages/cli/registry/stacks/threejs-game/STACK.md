---
schema_version: 1
id: threejs-game
kind: stack
name: three.js 3D browser game
description: A 3D browser game on three.js with Rapier physics loaded after the first frame, built with Vite and served as static files. Game rules run as pure TypeScript on a fixed 60 Hz tick, saves are versioned in IndexedDB, input covers keyboard and touch, and Vitest, Playwright scenarios on desktop and phone Chromium and a headless capture script check it.
tags: [typescript, web, static, scripts, bun, node, game, three]
deps:
  app: [three, "@dimforge/rapier3d-compat", idb-keyval, zod]
  dev: [vite, typescript, "@types/node", "@types/three", "@biomejs/biome", vitest, fake-indexeddb, "@playwright/test"]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version. Node runs Vite, Vitest, Playwright and scripts/see.ts (with its built-in TypeScript stripping); Bun installs and runs scripts."
  - "Engine versions: exact pins in package.json for three, @types/three (the release matching three) and @dimforge/rapier3d-compat (default), since most three.js releases rename or remove APIs; caret ranges only if the person wants upgrades to arrive with every install."
  - "Orientation: landscape (default), portrait or any, set in src/game.ts. The phone Playwright project and see --mobile hold the phone that way."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [claude-harness-docs, git-hooks, ci-github, code-docs]
  optional: [rr, ce-plugin]
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
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  dev: Run the Vite development server
  build: Build the game into dist/
  preview: Serve dist/ locally
  typecheck: Run tsc over the game, tests and configs, then over the logic with no DOM types
  lint: Run Biome checks, including the logic boundary rules
  format: Apply Biome formatting and safe fixes
  test: Run Vitest once (the logic and unit projects)
  test:watch: Watch Vitest tests
  e2e: Build, then run the Playwright scenarios, smoke tests and the see check against vite preview
  see: Play the built game headlessly to exact ticks and write frames, state and events to a run folder
  check: Run lint, typecheck, tests and e2e
  audit: Check dependencies for published advisories (bun audit; needs the network)
  clean: Remove build, test and see output
  prepare: Install git hooks and the Playwright browser outside CI
---

# three.js 3D browser game

## What stacks wrote

A small 3D game that runs: walk a field, collect six orbs and shove crates. `src/main.ts` opens the save store and boots the game through `src/kit/shell.ts`, which owns the `window.__game` hook tests drive. `src/logic/` holds the rules as pure TypeScript with Vitest tests; `src/engine/` renders them with three.js and loads Rapier after the first frame; `src/kit/` holds the fixed timestep, seeded rng, event log, logger, keyboard and touch input, and versioned IndexedDB saves. Scenarios in `scenarios/`, Playwright smoke tests, `scripts/see.ts`, the configs, a Biome Grit rule, `DESIGN.md` and `docs/guidance/threejs-game/` ship too. Read the code before extending it.

Link `docs/guidance/threejs-game/index.md` and `DESIGN.md` from AGENTS.md.

## Layout

- `src/game.ts`: the game's `id` (it names the save database), `title` and `orientation`.
- `src/logic/`: `world.ts` (`createWorld`, `stepWorld`, `summarize`), `events.ts`, `save.ts` (`SAVE_VERSION`, schema, migrations), `hash.ts`. May import only `src/kit/core/` and `zod`.
- `src/kit/core/`: DOM-free helpers (`FixedStep`, `createRng`, `EventLog`, `hashState`, `createLogger`). `src/kit/`: `shell.ts`, `input.ts`, `save.ts`, `report-error.ts`.
- `src/engine/`: `game.ts` (`startThree`), `runtime.ts` (engine-free, tested), `world-view.ts`, `physics.ts`, `camera-rig.ts`, `input.ts` (the action map), `capture-stages.ts`.
- `scenarios/`: `kit.ts` and one file per scenario. `tests/`: `smoke.spec.ts`, `scenarios.spec.ts`, `see.spec.ts`, `save.test.ts` with `fixtures/save-v1.json`, `boundaries.test.ts`, and `support/` (the page driver, scenario kit, Playwright fixture, Chromium flags).
- `scripts/see.ts`: the headless capture loop. `biome-plugins/no-nondeterminism.grit`: the logic clock and randomness rule.

## Setup

1. Add every declared app and dev dependency at its current release with `bun add` and `bun add -d`, checking peer ranges. Pin `three`, `@types/three` and `@dimforge/rapier3d-compat` exactly (`bun add --exact`), with `@types/three` at the release matching `three`. Match `@types/node` to the chosen Node major. No generator is needed; keep the shipped source, tests and configs.
2. Run `bun run lint`, `bun run typecheck`, `bun run test` and `bun run e2e`. Where an installed release rejects shipped code or config (a renamed three.js or Rapier API, a moved Vite or Playwright option), update it from that release's docs or declarations, keeping every check, lint rule and assertion. If the logic changed and `WALK_HASH` in `tests/smoke.spec.ts` moves, update it from the failure. `prepare` installs Chromium after `bun install` outside CI.
3. Record the Node LTS in `.node-version`, Bun in `packageManager`, and the installed versions of three.js, Rapier, Vite and TypeScript in the README.
4. Fill the README's `stacks:fill` markers and AGENTS.md (commands, a single-file test example, a `bun run see` example, the layer rules, the guidance links), then run `stacks verify` until green. If the default port is busy, set a free `PORT_WEB` in verify's environment; Playwright picks its own free port unless `PORT_E2E` is set.

## Conventions

The shipped code keeps these; new code does too. `docs/guidance/threejs-game/architecture.md` and `engine.md` have the detail.

- Game rules live in `src/logic/`, which imports only `src/kit/core/` and `zod` and never reads a clock or `Math.random`. Biome's import rules and the Grit plugin fail lint on a break, `tsconfig.logic.json` compiles it without DOM types, and `tests/boundaries.test.ts` proves each rule fires.
- Logic changes only inside the fixed-step tick. In test mode the engine's own loop doesn't run; the harness calls `__game.advance(n)`, and `idle()` stays false while physics or a save is in flight.
- Rapier steps once per tick with `TICK_DT`. `worldHash()` covers logic state only, never physics, so every browser computes the same hash.
- Render with `WebGLRenderer`; no `three/webgpu`, `three/tsl` or node materials. Check three.js and Rapier names against the installed release in `node_modules` or through Context7 before using them.
- Only `src/kit/shell.ts` writes to the console (game code uses `createLogger`), and only `src/kit/save.ts` touches browser storage. Lint enforces both.
- A save shape change bumps `SAVE_VERSION`, adds a migration and commits `tests/fixtures/save-v<old>.json`.
- Effects fire from logic events and keep their own state; everything observable is an event in `src/logic/events.ts`.

## Testing

Vitest's `logic` project runs `src/logic/` and `src/kit/core/` tests; `unit` runs the kit, `Runtime`, saves (on `fake-indexeddb`), the test support code and the lint boundary probes, all on Node. Scenarios are a start state, an input script in logic ticks and expectations on `summary`, `state` and `events`, never pixels; `tests/scenarios.spec.ts` runs each one.

`bun run e2e` builds, serves `dist/` with `vite preview` on a free port, and runs Playwright on desktop Chromium and a phone held in the game's orientation. The phone project runs only the smoke tests. Smoke asserts the `webgl2` renderer, physics loading, a save surviving a reload, the pinned `WALK_HASH` and the touch controls; `see.spec.ts` runs `bun run see` once and checks its run folder. Details in `docs/guidance/threejs-game/testing.md`.

<!-- stacks:when with=ci-github -->
CI sets up Bun from `packageManager` and Node from `.node-version`, installs frozen dependencies, runs lint, typecheck and tests, installs Chromium with its system dependencies (`bunx playwright install --with-deps chromium`, since `prepare` skips the download under `CI`), then runs `bun run e2e`, and `bun run audit` as its own step (it needs the network). Hosted runners have no GPU: `tests/support/chromium-args.ts` already passes the SwiftShader flags that give headless Chromium software WebGL, so don't drop them from `playwright.config.ts`. Upload `test-results/` on failure. No credentials are needed.
<!-- stacks:end -->

## Commands

`package.json` wires every declared command; mirror them in AGENTS.md with scoped examples such as `bun run test src/logic/world.test.ts` and `bun run see --scenario collect-first-orb --at 0,end`. `preview` and `see` serve the last build, so run `build` first. `audit` needs the network, so `check` leaves it out.

<!-- stacks:when with=git-hooks -->
`scripts/prepare.ts` already runs `lefthook install` when `lefthook.yml` exists outside CI, so don't add another installer. pre-commit runs Biome with fixes on staged files; pre-push runs typecheck and tests, leaving e2e to CI.
<!-- stacks:end -->

## Gotchas

- Run Vite, Vitest and Playwright on Node without `--bun`; use `bun run test` for Vitest and `bun run see` for the capture script.
- Headless Chromium no longer falls back to software WebGL on its own. Without `--enable-unsafe-swiftshader` and `--ignore-gpu-blocklist` the renderer check fails on machines and runners without a usable GPU.
- `id` in `src/game.ts` names the IndexedDB database (`<id>-saves`). Changing it after release orphans every player's saves.
- `WALK_HASH` in `tests/smoke.spec.ts` changes whenever the rules do. A changed hash that you didn't intend is a determinism bug; one you did intend gets updated in the same commit.
- Rapier's compat build inlines its WASM, so its chunk is large; `vite.config.ts` raises the chunk warning size and the game imports it lazily. Keep it out of `src/main.ts`'s static imports.
- Tests that open a save store import `fake-indexeddb/auto` first, or `src/kit/save.ts` falls back to memory and the test proves nothing about IndexedDB.
- Biome's logic rules match `**/src/logic/**`, so `tests/boundaries.test.ts` can probe them in temporary folders. Keep the globs in that form when moving files.
