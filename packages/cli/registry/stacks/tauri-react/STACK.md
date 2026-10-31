---
schema_version: 1
id: tauri-react
kind: stack
name: Tauri desktop app with React
description: A Tauri desktop app with Rust logic in a crate workspace behind a thin shell, and a React/Vite frontend that calls it through tauri-specta typed IPC or a mock transport in the browser and tests. Biome, Vitest, Playwright, clippy and a check on crate dependency direction cover both halves.
tags: [rust, typescript, react, desktop, tauri, make, bun, node]
deps:
  app: [react, react-dom, react-router, "@tauri-apps/api", "@tanstack/react-query", zustand, tailwindcss, "@tailwindcss/vite"]
  dev: ["@tauri-apps/cli", vite, "@vitejs/plugin-react", typescript, "@biomejs/biome", vitest, "@vitest/coverage-v8", happy-dom, "@testing-library/react", "@testing-library/jest-dom", "@types/node", "@types/react", "@types/react-dom", "@playwright/test"]
  rust: [tauri, tauri-build, tauri-specta, specta, specta-typescript, serde, serde_json, thiserror, anyhow, tracing, tracing-subscriber, tokio]
  rust-dev: [tempfile]
tools: [bun, node, cargo, rustup, make, git, jq]
decisions:
  - "Bundle identifier: com.<package scope>.<project slug> (default). It names the app's data directories, so changing it after release orphans user data."
  - "Target platforms: the developer's OS for bundles, with every library crate compiling on macOS, Linux, and Windows (default)."
  - "Node version: current LTS (default), recorded in .node-version and engines.node."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github]
  optional: [rr, ce-plugin]
env:
  PORT_WEB: "1420"
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: typecheck, layer: typecheck, run: make typecheck }
  - { name: check-targets, layer: typecheck, run: make check-targets }
  - { name: test, layer: test, run: make test }
  - { name: bindings, layer: check, run: make bindings-check }
  - { name: architecture, layer: lint, run: make architecture-check }
  - { name: e2e, layer: test, run: make e2e }
  - { name: build, layer: build, run: make build, tags: [prod] }
  - name: web
    phase: serve
    layer: serve
    run: make dev-web
    expect: { http: "http://localhost:${PORT_WEB}/", within: 90s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Install JS dependencies, the selected Rust toolchain and crates, and Playwright's Chromium
  dev: Run the full app (tauri dev; Vite on PORT_WEB plus the Rust shell)
  dev-web: Run the frontend alone in a browser on the mock transport
  build: Build the production app bundle
  bindings: Regenerate src/core/generated/ from the Rust commands and types
  bindings-check: Fail if the committed bindings differ from a fresh export
  lint: lint-web and lint-rust
  lint-web: Biome
  lint-rust: cargo fmt --check and clippy with warnings denied
  format: Biome format and safe fixes, cargo fmt
  typecheck: typecheck-web and typecheck-rust
  typecheck-web: tsc over every TypeScript project
  typecheck-rust: cargo check over the workspace
  check-targets: cargo check the library crates for Linux, macOS and Windows
  test: test-web and test-rust
  test-web: Vitest
  test-rust: cargo test over the workspace
  coverage: Vitest with coverage
  e2e: Playwright against the Vite dev server on the mock transport
  architecture-check: Check Cargo dependency edges against the crate policy
  check: Lint, typecheck, tests, bindings drift, crate policy, and e2e
  clean: Remove build, test, and coverage output
---

## What stacks wrote

A desktop shell with a Rust core crate, the typed `app_info` command and a live tick channel, generated TypeScript bindings, native and browser transports, and one React Router window using React Query and zustand. Tests cover domain errors, channel timing and disconnects, rendered results and failures, subscription cleanup, independent rendering, and browser behavior. The workspace, Tauri capabilities and CSP, Vite/Tailwind, Biome, TypeScript, Vitest, Playwright, crate policy and Makefile are written too. Read the code before extending it.

## Setup

1. Add the declared JS app and dev deps with `bun add` and `bun add -d`. Match `@types/node` to the installed Node LTS major. Add Rust deps with `cargo add --manifest-path`: core's manifest gets `serde` (derive), `specta` (derive) and `thiserror`, plus dev `serde_json`; shell's gets `tauri` (specta), `tauri-specta` (typescript), `specta` (derive, function), `specta-typescript`, `serde` (derive), `serde_json`, `thiserror`, `anyhow`, `tracing`, `tracing-subscriber` (env-filter, json), and `tokio` (time, sync, macros, rt), plus build `tauri-build` and dev `tokio` (test-util) and `tempfile`. Resolve the Specta family together from the current tauri-specta release's dependency requirements; bare stable adds select an incompatible API while these are prereleases. Use the same Specta in both crates, and the exporter version that tauri-specta uses. Choose an initial app version and set `package.version` in `src-tauri/Cargo.toml`: unlike Cargo, the Tauri CLI requires this field explicitly. Registry manifests intentionally carry no package version.
2. Read the current `create-tauri-app` help, then run the official generator non-interactively in a temporary directory with the React TypeScript template and Bun. Copy **only** its `src-tauri/icons/` into this project's `src-tauri/icons/`; discard the generated project. Keep these placeholders in the app's repository until real icons exist, recorded under Deferred. Icons cannot ship as registry files, and `generate_context!` reads them even for clippy and tests.
3. Review the bundle identifier in `src-tauri/tauri.conf.json` against the decision. Run `make install`, `make bindings-check`, then `make check` and `make build`. If installed releases reject shipped code, generated bindings or config, update them for those releases without dropping a rule or weakening a test, then run `make format`. A bindings drift caused by the exporter changing is resolved with `make bindings`, followed by typecheck and tests. Never overwrite the shipped source with generator output.
4. Record the installed Rust toolchain in `rust-toolchain.toml` (keep components and all three targets), Node LTS in `.node-version` and `engines.node`, and Bun in `packageManager`. Fill README's markers, AGENTS.md and `docs/harness.md`; link `docs/guidance/tauri-react/index.md` from AGENTS.md. Run `stacks verify` and `stacks verify --all` so the sandbox's skipped production bundle is proven too.

## Layout and conventions

Read `docs/guidance/tauri-react/index.md` and its frontend, IPC and Rust pages. The code is the reference; preserve these boundaries when extending it:

- `crates/core/` owns domain logic. Directory names are fixed; the manifest names the crate with the project slug. `src-tauri/` owns only desktop concerns. Register every command once in `specta_builder()`; the app and export example use that builder. Errors remain tagged, typed results; unexpected IPC rejection stays a visible failure. Rust emits structured tracing records to stderr; `RUST_LOG` is validated at startup, defaulting to info.
- `src/core/` has no React. Only `transport/**` and `app-transport.ts` import Tauri or call generated bindings. Generated types are fine elsewhere. Biome and the Claude write guard enforce the boundary; keep both when adapting tool configs. Bindings are generated, normalized and committed, excluded from formatting and coverage.
- Components get their transport and per-provider zustand store from `Providers`. Queries use centralized keys. Select narrow store slices and keep independent subscribers outside updating parents. Native streams belong to the window; the shell cancels them on page replacement, window destruction or a replacement subscription. React subscriptions detach listeners, and the UI resubscribes with a visible reconnecting state when a stream ends. Add native unsubscribe for other early-stop behavior.
- React Router uses memory routes selected by the window label. `VITE_TRANSPORT` accepts mock or native; outside Tauri the browser uses fixtures. Query parameters choose window, scenario and ticks off for stable screenshots. A mock change accompanies every Rust fact change.
- Keep the strict TypeScript options, explicit types and separate browser, test and tool projects. Vite and Vitest derive aliases from the shared paths config. Keep Biome's recommended, a11y, hook, unused-code, import-boundary and Tailwind sorting rules. Its Playwright domain applies to e2e, not Vitest's different suite API. Use semantic colors and named exports in kebab-case files.
- Crate dependencies flow shell to core. `scripts/architecture/crate-edges.json` lists every member and permitted normal/dev path edge. New members and edges need a deliberate ownership decision; `make architecture-check` checks them. Keep the workspace's denied panics/unwraps outside tests and stable rustfmt settings. Gate platform code by OS at module level; isolate unsafe APIs with SAFETY comments.

## Testing

Unit tests live next to source; Rust integration tests in `crates/core/tests/`. The shell's paused-time tests prove skipped ticks, receiver disconnects, replacement subscriptions and window cancellation through a sink. Frontend tests render the real route with a mock transport, push frames explicitly, check missing data, typed errors, rejected commands, reconnection and cleanup, and count sibling renders. The transport is the mock seam; never mock internal modules or Tauri packages. Playwright sees app info and a changing tick through the same browser transport. Extend these layers with each new boundary behavior.

Playwright cannot drive WKWebView on macOS. Run `make dev` manually to check the packaged webview; record it under Pending user actions if a display isn't available.

## Commands

`make help` lists the targets. The Makefile splits frontend and Rust checks for CI, compares fresh bindings without requiring a first commit, and checks all three library targets. Keep its public names. Package scripts run Vite, Vitest and Playwright on Node; Bun installs dependencies and runs scripts.

<!-- stacks:when with=ci-github -->
CI has frontend on Ubuntu and Rust on the bundle platform (macOS by default), plus aggregate ci-ok. Frontend runs install, lint-web, typecheck-web, coverage and e2e; Rust runs install, lint-rust, test-rust, check-targets, bindings-check, architecture-check and build. Cache Cargo, read the recorded toolchains, and upload Playwright reports on failure. Linux shell builds need WebKitGTK system packages.
<!-- stacks:end -->

<!-- stacks:when with=git-hooks -->
pre-commit formats staged frontend code and Rust; pre-push runs lint and test. Bindings and Playwright stay in CI and the task's final check. Install lefthook from the install target only outside CI and when its config exists.
<!-- stacks:end -->

## Gotchas

- Shell compilation embeds dist even for tests; the Makefile's stub-dist creates the directory. Icons are a separate compile-time prerequisite supplied in Setup.
- On headless macOS, set CI=true and leave TAURI_BUNDLER_DMG_IGNORE_CI unset when building or verifying. The bundler still creates the app and disk image but skips Finder automation for the installer's visual layout.
- Tauri's devUrl fixes the default PORT_WEB. Change both together for native development. Vite uses strictPort and ignores Rust trees; Playwright chooses its own free port and never reuses a server.
- The Specta family currently uses release candidates. Read current dependency requirements rather than guessing compatible versions, record the resolution under Build workarounds and remove the workaround when stable releases align. A bindings diff without a Rust change means the generator moved. Channel registration needs tauri's specta feature. Use u32 where it fits; exporting a wider integer as a number requires documenting its safe integer bound.
- The tick timestamp is milliseconds since subscription, bounded in Rust, rather than an unsafe integer UNIX timestamp. A subscription ends at that bound or on send failure; missed intervals skip catch-up bursts.
- Keep Node for frontend tooling, including Vitest; never substitute bun test or --bun. New TypeScript majors default types to none, so each project lists them.
- Library crates must check on Linux, macOS and Windows. A dependency compiling C needs each target's C toolchain, or an explicit same-OS CI check recorded in AGENTS.md. Linux shell builds need WebKitGTK; the library does not.
