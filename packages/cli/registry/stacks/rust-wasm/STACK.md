---
schema_version: 1
id: rust-wasm
kind: stack
name: Rust WebAssembly package for JavaScript
description: A Rust library compiled to WebAssembly with wasm-bindgen and wasm-pack into an npm package with generated TypeScript types. Errors reach JavaScript as exceptions with stable codes; the logic is tested natively, the exports as wasm in Node with wasm-bindgen-test, and the packed tarball from a TypeScript consumer project.
tags: [rust, wasm, library, make, bun, node]
deps:
  library: [wasm-bindgen, js-sys, serde, serde-wasm-bindgen, thiserror]
  test: [wasm-bindgen-test, serde_json]
  consumer: [typescript, "@types/node"]
tools: [cargo, rustup, wasm-pack, bun, node, make, git]
decisions:
  - "npm package name: the project slug, which is also the crate name (default), or a scoped @scope/name: add `--scope <scope>` to the wasm-pack line of `make build` and update the imports in consumer/test/."
  - "Output format: wasm-pack's bundler target (default), ES modules importing the .wasm for bundlers and current Node. `web` (browsers without a bundler; callers run `init()` first) or `nodejs` (CommonJS, Node only) change how every user loads the package and the consumer tests with it."
  - "License: MIT OR Apache-2.0 (default), or the user's choice in Cargo.toml's `license`, the README and deny.toml's allow list."
  - "Package version: none in Cargo.toml (default; wasm-pack writes a zero placeholder) until the first release, then package.version, which wasm-pack copies to package.json."
  - "Panic messages: none (default); clippy denies panics and one aborts as `RuntimeError: unreachable`. Add console_error_panic_hook behind a feature only if a dependency can panic and the message matters."
  - "Node version: current LTS (default), recorded in .node-version. Node runs the wasm tests and the consumer; Bun installs and packs."
env: {}
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: clippy, layer: lint, run: make clippy }
  - { name: test, layer: test, run: make test }
  - { name: test-wasm, layer: test, run: make test-wasm }
  - { name: build, layer: build, run: make build }
  - { name: typecheck-js, layer: typecheck, run: make typecheck-js }
  - { name: test-js, layer: test, run: make test-js }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Install the toolchain and wasm32 target, wasm-pack when missing, the crates and consumer/'s packages
  fmt: Format the Rust code
  fmt-check: Fail if rustfmt would change any file
  clippy: clippy for the native and wasm32 targets, warnings denied
  lint: fmt-check and clippy
  test: Native unit tests of the Rust logic
  test-wasm: The exports compiled to wasm32 and run in Node (wasm-bindgen-test)
  build: Compile to wasm and generate the npm package in pkg/ (wasm-pack, release, wasm-opt)
  pack: Pack pkg/ into the tarball npm would upload, under target/npm/ (uploads nothing)
  typecheck-js: Typecheck consumer/ against the packed package's generated .d.ts
  test-js: Run consumer/'s tests on Node against the packed package
  audit: Advisories, licenses and sources with cargo-deny (needs network)
  ci: "Everything CI runs (lint, test, test-wasm, typecheck-js, test-js, audit)"
  clean: Remove build output and pkg/
---

# Rust WebAssembly package for JavaScript

An npm package whose code is Rust: the hard part is the boundary, so every value that crosses it is typed in TypeScript, every failure becomes a JavaScript `Error` with a stable code, and the package is tested the way users install it. The `Makefile` is the entry point for every task.

## What stacks wrote

A working slice that passes every check once its crates and packages are added. `Cargo.toml` is one package at the root inside a workspace, built as `cdylib` and `rlib`, with the lint policy in `[workspace.lints]`, a size-tuned release profile and no dependencies yet; `rust-toolchain.toml` adds the `wasm32-unknown-unknown` target, beside `clippy.toml` and `deny.toml`. `src/lib.rs` is the whole JavaScript API: `slugify` and `slugInfo` (an options object in, a string or a plain `SlugInfo` object out), the `Slugger` class (state across calls, freed with `free()` or `using`), and a `typescript_custom_section` declaring `SlugOptions`, `SlugInfo`, `SlugError` and its codes. The logic is plain Rust with native unit tests: `slug.rs`, `options.rs` (defaults and checks) and `error.rs` (one thiserror enum, each variant with a stable code). `js.rs` is the boundary: it decodes options with serde-wasm-bindgen, rejects unknown keys, encodes results as plain objects and turns errors into thrown `SlugError`s. `src/web_tests.rs` runs the exports as wasm in Node. `consumer/` is a separate TypeScript project whose `test/package.test.ts` imports the package by name after `make test-js` packs `pkg/` and unpacks the tarball into its `node_modules/`, typechecks it against the generated `.d.ts` and runs it on Node's test runner. `docs/` has `guidance/rust-wasm.md` (the rules every agent follows) and `js-api.md` (exports, error codes, semver). Slugs are the payload that proves the wiring. Read the code before extending it.

## Setup

No generator.

1. Add the crates with their features, so each resolves to its current release:
   - `cargo add wasm-bindgen js-sys serde-wasm-bindgen thiserror`
   - `cargo add serde --features derive`
   - `cargo add --dev wasm-bindgen-test serde_json` (serde_json is for `tests/claude_hooks.rs`, the Claude guard hook's test; leave it out when that file isn't there)
2. Write the current Node LTS to `.node-version`. In `consumer/`, run `bun add -d typescript @types/node`, matching `@types/node` to that Node major, and set `packageManager` in `consumer/package.json` to the installed Bun (`bun --version`).
3. Fill `Cargo.toml`'s `description` (`make pack` refuses the `stacks:fill` placeholder), the `license` decision, and `repository` once the user names one. wasm-pack copies them into `pkg/package.json`.
4. Record the toolchain: set `channel` in `rust-toolchain.toml` to the installed stable release (`rustc --version`), keeping the components and the wasm32 target.
5. `make install`, then `make fmt-check clippy test test-wasm build typecheck-js test-js`. The first `build` and `test-wasm` download the wasm-bindgen CLI that matches `Cargo.lock`, and wasm-opt, into wasm-pack's cache. Where an installed release rejects shipped code (a moved wasm-bindgen attribute, a changed serde-wasm-bindgen error) or a newer clippy flags it, fix the code. Keep every lint; a lint wrong for one item gets `#[expect(<lint>, reason = "...")]` there.
6. Run `make audit` once. It installs cargo-deny when missing and fetches the advisory database. A license failure means reading that license before adding it to `deny.toml`; an advisory means `cargo update -p <crate>`. Record the result in AGENTS.md.
7. Fill the README's `stacks:fill` markers (`readme-filled` checks); it becomes the npm page. Link `docs/guidance/rust-wasm.md` and `docs/js-api.md` from AGENTS.md, then run `stacks verify` until it passes.

## Conventions

`docs/guidance/rust-wasm.md` holds the rules and `docs/js-api.md` the export list and semver policy; the shipped code follows both. For this package:

- **Exports** live in `src/lib.rs` only. Logic is `pub(crate)` plain Rust that never names a `wasm-bindgen` type. The `add-export` skill walks through a new export.
- **Types**: options and object results are `extern "C"` types named with `typescript_type`, declared once in `TYPES` and kept in step with the Rust struct and `Options::KEYS`. Doc comments on exports become the `.d.ts` comments.
- **Errors**: exports return `Result<T, JsValue>`; `?` turns `Error` into a `SlugError` with `code` and `field`. Codes are API. Nothing panics across the boundary.
- **wasm32 limits**: no `Instant`, `SystemTime::now()`, threads, files, network, environment or printing in library code. Take what the platform knows (a timestamp, say) as an argument from JavaScript.
- **Every export change** reruns `make test-wasm test-js`, so `consumer/` typechecks against the new `.d.ts`.
- **Publishing**: a person runs `wasm-pack publish`; agents stop at `make pack`. The guard hook denies publishing.

## Testing

Unit tests sit in each logic module's `#[cfg(test)] mod tests` and run natively (`make test`): every rule and error code. `src/web_tests.rs` compiles to wasm32 and runs in Node through wasm-bindgen-test (`make test-wasm`): JavaScript objects in, thrown `SlugError`s with codes and fields out, class state. `consumer/test/package.test.ts` is the only test of what users install: it imports by package name, so a missing file, a wrong `package.json` or a `.d.ts` that doesn't match the code fails there. A new export adds a case to all three.

## Commands

The shipped Makefile (`make help`) has install, fmt, fmt-check, clippy, lint, test, test-wasm, build, pack, typecheck-js, test-js, audit, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md with the single-test command (`cargo test <name>`); the wasm suite runs whole with `make test-wasm`, because wasm-pack passes extra arguments to its build step as well, where a test name fails. Checks run with `--locked`; commit `Cargo.lock` and `consumer/bun.lock`.
<!-- stacks:when with=ci-github -->

**CI.** One `ubuntu-latest` job: Node from `.node-version`, Bun from `consumer/package.json`'s `packageManager`, wasm-pack and cargo-deny from a prebuilt-binary installer, then `make install` and `make ci`. Cache wasm-pack's download cache (`~/.cache/.wasm-pack` on Linux) with the Cargo cache. No publish job: releases stay a person's step. There is no coverage target (Rust coverage needs cargo-llvm-cov, which the stack doesn't ship); record that under Deferred.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make install` runs `lefthook install` outside CI once `lefthook.yml` exists, so write that file first. pre-commit runs `cargo fmt --all` and restages the staged `.rs` files; pre-push runs `make lint test`. The wasm and consumer tests build the package, so they stay out of pre-commit.
<!-- stacks:end -->

## Gotchas

- serde-wasm-bindgen reads only the fields a struct names and ignores other keys, even with `#[serde(deny_unknown_fields)]`. `src/js.rs` checks keys against `Options::KEYS` first; keep that list in step.
- Node prints `ExperimentalWarning: Importing WebAssembly module instances` when it loads the bundler-target package. The import works; the warning is Node's.
- Bun can't load the bundler-target package (`wasm.__wbindgen_start is not a function`), so `bun test` fails; the guard hook denies it. Bun only installs and packs here.
- `bun add` of a `file:../pkg` dependency links every file in `pkg/`, ignoring `files` in its `package.json`. `make test-js` unpacks the packed tarball instead, so the consumer sees only what ships.
- clippy's test allowance for `unwrap` sees a plain `#[cfg(test)]` but not `#[cfg(all(test, ...))]`; that's why `src/lib.rs` gates `web_tests` with two attributes.
- Code behind `cfg(target_arch = "wasm32")` compiles only in clippy's second pass and in `make test-wasm`; a native-only check misses it.
- `wasm-pack test` runs only `#[wasm_bindgen_test]` functions; plain `#[test]`s run natively.
- Never install wasm-bindgen-cli yourself: its version must equal the `wasm-bindgen` crate in `Cargo.lock`, and wasm-pack already fetches that one. The guard hook denies `cargo install wasm-bindgen-cli`.
- The first `make build` and `make test-wasm` need network to download the CLI and wasm-opt (no credentials). `make audit` needs it for the advisory database.
- `make pack` refuses to run until Cargo.toml's `description` is filled, so `typecheck-js` and `test-js` fail on a fresh scaffold until step 3.
- `to_lowercase` and `is_alphanumeric` pull in Unicode tables; most of the release `.wasm`'s size is them.
