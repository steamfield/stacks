---
schema_version: 1
id: phaser-game
kind: stack
name: Phaser browser game
description: A browser game built with Phaser and Vite and served as static files, with tick-based logic kept apart from the engine, IndexedDB saves, touch controls, Vitest, and Playwright scenarios that play the built game headlessly on desktop, phone and WebKit.
tags: [typescript, web, static, scripts, bun, node, game, phaser]
deps:
  app: [phaser, zod, idb-keyval]
  dev: [vite, typescript, "@types/node", "@biomejs/biome", vitest, fake-indexeddb, "@playwright/test"]
tools: [bun, node, git]
decisions:
  - "Node version: current LTS (default), recorded in .node-version. Node runs Vite, Vitest, Playwright and `bun run see`; Bun installs and runs scripts."
  - "Phaser pin: the exact installed version in package.json (default), because engine releases rename and remove APIs. Upgrade on purpose, one release at a time, with the e2e run green."
  - "Orientation: landscape (default) in src/game.ts, which also sets how the phone test projects hold the device; portrait or any when the person asks."
  - "Resolution: 320x180 pixel art scaled by whole numbers (default); a smooth-scaled base resolution when the art isn't pixel art."
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
  typecheck: Run tsc over the app, then over logic alone with no DOM types
  lint: Run Biome checks, including the boundary rules
  format: Apply Biome formatting and safe fixes
  test: Run the Vitest unit and runtime projects once
  test:watch: Watch Vitest tests
  e2e: Build, then run the Playwright scenarios, smoke and see tests against vite preview
  see: Play the last build headlessly to exact ticks and write frames, state and events to .runs/
  check: Run lint, typecheck, tests and e2e
  audit: Check dependencies for published advisories (bun audit; needs the network)
  clean: Remove build, test and see output
  prepare: Install git hooks and the Playwright browsers outside CI
---

# Phaser browser game

## What stacks wrote

A playable one-level platformer (Coin Run, described in `DESIGN.md`) that exercises every layer: a title menu, tile physics, coins that autosave, a goal flag, keyboard and touch input, and a debug overlay. Replace the gameplay and keep the structure. `src/game.ts` names the game; `src/main.ts` boots it. The shell, save store, input and logging live in `src/kit/`, the Playwright driver and scenario kit in `tests/support/`. Read the code before extending it.

Link `docs/guidance/phaser-game/index.md` from AGENTS.md.

## Layout

- `src/logic/`: the game's rules as plain data and functions (level, world, events, save schema, `hashWorld`). No Phaser, no DOM, no clock.
- `src/kit/core/`: the fixed timestep, seeded rng, event log, hash and logger that logic may use. `src/kit/`: the shell (`bootGame`, `window.__game`), save store, input and error reporting.
- `src/engine/`: `runtime.ts` owns scene flow, ticks and save writes without importing Phaser; `game.ts` holds the Phaser scenes, which only draw runtime state.
- `scenarios/`: one file per behavior, each a start state, an input script and expectations.
- `tests/`: Vitest save and boundary tests, Playwright specs, and `support/` (driver, scenario kit, fixtures).
- `scripts/see.ts`: the headless capture tool. `biome-plugins/no-nondeterminism.grit`: the clock and random ban for logic.

## Setup

1. Add every declared app and dev dependency at its current release with `bun add` and `bun add -d`. Pin Phaser to the exact installed version (no `^`). Match `@types/node` to the chosen Node major. No generator is needed; keep the shipped source, tests and configs.
2. Check the installed Phaser major, read the docs or agent skills that ship in `node_modules/phaser/` if there are any, and look up APIs in that version's docs (Context7 works). Where an installed release rejects shipped code or config, update it from that release's docs or declarations, keeping every check, lint rule and assertion.
3. Run `bun run lint`, `bun run typecheck`, `bun run test` and `bun run e2e`. `prepare` installs Chromium and WebKit after `bun install` outside CI.
4. Record the Node LTS in `.node-version`, Bun in `packageManager`, and the installed versions of Phaser, Vite, Vitest, Playwright and TypeScript in the README.
5. Fill the README's `stacks:fill` markers and AGENTS.md (commands, a single-file test example, a `bun run see` example, the boundaries, the guidance link), then run `stacks verify` until green. If a default port is busy, set free `PORT_WEB` and `PORT_E2E` values in verify's environment.

## Conventions

The shipped code keeps these; new code does too. `docs/guidance/phaser-game/architecture.md` has the detail.

- Logic changes only inside `Runtime.tick()`, one fixed 1/60 s tick at a time. Logic never reads `Math.random`, `Date.now`, `performance.now` or `new Date`; it takes the seeded rng from `createRng` and the `dt` it is given. Biome fails lint on a break, and `tests/boundaries.test.ts` proves each rule fires.
- `src/logic/` and `src/kit/core/` import nothing from Phaser, the engine, the shell or storage. `tsconfig.logic.json` typechecks them with no DOM types, so a stray `window` fails typecheck.
- Phaser scenes read runtime state and draw it. They never move the player, collect a coin or write a save.
- Saves go through `src/kit/save.ts` only: versioned, validated with zod, migrated, backed up, and quarantined when unreadable. A save format change bumps `SAVE_VERSION`, adds a migration and commits `tests/fixtures/save-v<N>.json`.
- Only `src/kit/shell.ts` touches `console`; everything else logs through `createLogger`.
- Every action has a keyboard binding and a touch control in `src/engine/input.ts`. Tests inject actions, never key events.
- The game is served at `/` and built assets go under `_v/`.

## Testing

Vitest's `unit` project runs logic, kit and `tests/*.test.ts`; `runtime` drives the real `Runtime` tick by tick over fake IndexedDB. Both run on Node.

`bun run e2e` builds, serves `dist/` with `vite preview` on `PORT_E2E`, and plays it in three Playwright projects. Desktop Chromium runs every scenario, the smoke tests and the `see` test; a phone (Chromium) and WebKit run the smoke tests. In test mode the harness owns time: the game renders but advances only when `window.__game.advance(ticks)` is called, so a scenario reaches the same state on every machine. The smoke test pins one `worldHash` after a fixed input, and all three projects must reach it. Any console error, failed request or game error fails the test. Details in `docs/guidance/phaser-game/testing.md`.

`bun run see --scenario <name>` (or `--input "jump right*30" --at 0,30,end`) plays the last build to exact ticks and prints a summary whose first line is the run folder under `.runs/`, holding `frame-<tick>.png`, `state.json`, `events.jsonl` and `console.log`. Run `bun run build` first; it refuses a build older than `src/`.

<!-- stacks:when with=ci-github -->
CI sets up Bun from `packageManager` and Node from `.node-version`, installs frozen dependencies, runs lint, typecheck and test, installs Chromium and WebKit with their system dependencies (`bunx playwright install --with-deps chromium webkit`), then runs e2e, and `bun run audit` as its own step (it needs the network). Headless Chromium on CI has no GPU; the shipped `CHROMIUM_ARGS` turn on SwiftShader so the renderer stays WebGL, and the smoke test fails if it falls back to canvas. Upload Playwright reports and test results on failure. No credentials are needed.
<!-- stacks:end -->

## Commands

`package.json` wires every declared command; mirror them in AGENTS.md with a scoped example such as `bun run test src/logic/world.test.ts`. `preview` and `see` serve the last build, so run `build` first. `audit` needs the network, so `check` leaves it out.

<!-- stacks:when with=git-hooks -->
`scripts/prepare.ts` already runs `lefthook install` when `lefthook.yml` exists outside CI, so don't add another installer. pre-commit runs Biome with fixes on staged files; pre-push runs typecheck and tests.
<!-- stacks:end -->

## Gotchas

- Run Vite, Vitest, Playwright and `see` on Node without `--bun`; use `bun run test` for Vitest. `see` runs `scripts/see.ts` with Node's type stripping, so relative imports keep their `.ts` extension.
- Phaser's major releases change scene, loader and renderer APIs. Code from older tutorials often targets an earlier major; check against the installed version's docs.
- Without `--enable-unsafe-swiftshader`, headless Chromium on a machine with no GPU falls back to canvas and the renderer assertion fails. Launch any new browser with `CHROMIUM_ARGS`.
- The worldHash in `tests/smoke.spec.ts` changes with any change to the level or physics. Update it only for a deliberate change, and only after every browser project agrees on the new value.
- A static host must serve `index.html` without long caching; the hashed files under `_v/` can be cached forever.
- Audio and storage persistence unlock only after the player's first tap or key press; `onFirstGesture` in `src/main.ts` asks for persistence then.
