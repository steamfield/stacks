---
schema_version: 1
id: rust-library
kind: stack
name: Rust library crate
description: A Rust library crate for crates.io with a small documented public API, a thiserror error enum, an optional serde feature, doctests on every public item, proptest property tests, rustdoc with warnings denied, and a cargo package check that compiles exactly what would be published.
tags: [rust, library, make]
deps:
  library: [thiserror, serde]
  test: [proptest, serde_json]
tools: [cargo, rustup, make, git]
decisions:
  - "Crate name: the project slug (default; package.name in Cargo.toml). Rust code imports it as the slug with `-` turned to `_`, which replaces the shipped `crate_name` placeholder at Setup."
  - "License: MIT OR Apache-2.0, the pair most crates use (default), or the user's choice in Cargo.toml's `license`, the README and deny.toml's allow list."
  - "Package version: the one `cargo new --lib` writes (default), set as package.version in Cargo.toml before the first `make package`."
  - "serde support: an optional `serde` feature (default), or none: remove serde, serde_json, the cfg_attr on Slug and the feature's tests."
  - "Minimum supported Rust version: none declared (default). Declare rust-version only with a CI job that builds on that toolchain."
  - "Semver checks: deferred until a first release exists (default); then cargo-semver-checks against the last published version runs in CI before each release."
  - "Tests: cargo test (default), or cargo-nextest, which skips doctests, so a project on nextest also runs cargo test --doc."
env: {}
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: clippy, layer: lint, run: make clippy }
  - { name: check, layer: typecheck, run: make check }
  - { name: test, layer: test, run: make test }
  - { name: doc, layer: docs, run: make doc }
  - { name: package, layer: build, run: make package }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Install the toolchain rust-toolchain.toml selects and fetch crates
  fmt: Format the code
  fmt-check: Fail if rustfmt would change any file
  clippy: clippy on every target, with and without features, warnings denied
  lint: fmt-check and clippy
  check: Type-check every target with no features and with all of them
  test: Unit, integration and doc tests, with no features and with all of them
  doc: Build the API docs with every rustdoc warning denied
  package: Build and compile the .crate exactly as it would publish (uploads nothing)
  audit: Advisories, licenses and sources with cargo-deny (needs network)
  ci: "Everything CI runs (fmt-check, clippy, test, doc, package, audit)"
  clean: Remove build output
---

# Rust library crate

A crate whose product is its public API: every public item documented with a running example, one error enum callers can match, features that only add, and a packaging check that compiles the `.crate` that would be uploaded. The `Makefile` is the entry point for every task.

## What stacks wrote

A working slice that passes every check once its crates are added. `Cargo.toml` is one package at the root inside a workspace, with the lint policy in `[workspace.lints]` (`missing_docs` denied), an `include` list naming what goes into the `.crate`, and no dependencies yet; `clippy.toml`, `rust-toolchain.toml` and `deny.toml` sit beside it. `src/lib.rs` takes the README as the crate's front-page docs and re-exports the whole API: `Slug` (`slug.rs`), a validated identifier with its parsing and conversion traits and an optional serde form; `Rules` (`rules.rs`), the validation settings with a checked constructor; and `Error` (`error.rs`), the one `#[non_exhaustive]` thiserror enum every fallible function returns. Every public item has a doc example that runs as a doctest. Unit tests sit in each module; `tests/api.rs` uses only the crate root, as a dependent would, and `tests/properties.rs` holds proptest round trips. `docs/` has `public-api.md` (exports, features, semver rules), `releasing.md` (the first-publish checklist) and `guidance/rust.md`, the Rust rules every agent follows. Slug parsing is the payload that proves the wiring. Read the code before extending it.

## Setup

No generator.

1. Name the crate. Rust imports the package as the project slug with `-` turned to `_` (`my-crate` is `my_crate`). Replace the placeholder `crate_name` with that name in every file `grep -rl crate_name src tests docs README.md` lists, then run `make fmt`, since the new name can change import order.
2. Add the crates with their features, so each resolves to its current release:
   - `cargo add thiserror`
   - `cargo add serde --optional --features derive` (creates the `serde` feature)
   - `cargo add --dev proptest serde_json`
3. Fill `Cargo.toml`'s package metadata: `version` per the decision, `description` (replacing the `stacks:fill` placeholder that `make package` refuses), the `license` decision, and `repository` once the user names one. Until `repository` is set, `cargo package` warns; leave it unset rather than invent a URL.
4. `make install`, then `make fmt-check clippy check test doc package`. Where an installed release rejects shipped code (a changed thiserror attribute, a renamed proptest API) or a newer clippy flags it, fix the code. Keep every lint in `[workspace.lints]`; a lint that is wrong for one item gets `#[expect(<lint>, reason = "...")]` on that item. There is no `rustfmt.toml`.
5. Record the toolchain: set `channel` in `rust-toolchain.toml` to the installed stable release (`rustc --version`), keeping the components.
6. Run `make audit` once. It installs cargo-deny when missing (from source, a few minutes, unless cargo-binstall is on PATH) and fetches the advisory database. A license failure means reading that license before adding it to `deny.toml`'s `allow` list; an advisory means `cargo update -p <crate>`. Record the result in AGENTS.md.
7. Fill the README's `stacks:fill` markers (`readme-filled` checks); the README is also the docs.rs front page, so keep its example compiling. Link `docs/guidance/rust.md`, `docs/public-api.md` and `docs/releasing.md` from AGENTS.md, then run `stacks verify` until it passes.

## Conventions

`docs/guidance/rust.md` holds the Rust rules (layout, lints, docs, errors, testing) and `docs/public-api.md` the export list and semver policy; the shipped code follows both. For this crate:

- **Public API**: everything public is re-exported from `src/lib.rs`; modules stay private (`unreachable_pub` enforces it). A new export gets a doc example, `tests/api.rs` cases and a row in `docs/public-api.md`; name its semver effect before writing it. The `add-public-item` skill walks through it.
- **Errors**: one `Error` enum, `#[non_exhaustive]`, documented variants with fields a caller can match on. No `anyhow`, string errors, `unwrap`, `panic!` or printing in library code.
- **Features**: additive only, each behind `#[cfg(feature = "...")]` with its tests gated the same way. `make check` and `make test` run with none and with all.
- **Packaging**: `include` in `Cargo.toml` is the published file list; a file the library reads at compile time joins it. `make package` prints the list and compiles the extracted `.crate`.
- **Publishing**: a person runs `cargo publish`; agents stop at `make package` and the checklist in `docs/releasing.md`.

## Testing

Unit tests sit in each module's `#[cfg(test)] mod tests`: every validation rule and its error, the error messages, the conversions. Doctests on every public item and the README show and check real use. `tests/api.rs` exercises each export through the crate root, with the serde round trip behind the feature; `tests/properties.rs` checks round trips and length limits on generated input. A new item gets a doctest, an `api.rs` case and, for a parser or conversion, a property.

## Commands

The shipped Makefile (`make help`) has install, fmt, fmt-check, clippy, lint, check, test, doc, package, audit, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md with single-test commands (`cargo test --all-features --test api <name>`, `cargo test --doc`). Checks run with `--locked`; commit `Cargo.lock`, as current Cargo guidance says for libraries too.
<!-- stacks:when with=ci-github -->

**CI.** One `ubuntu-latest` job: `make install`, then `make ci` (fmt-check, clippy, test, doc, package, audit), with cargo-deny already installed so `make audit` skips compiling it. No publish job: releases stay a person's step (`docs/releasing.md`). There is no coverage target (Rust coverage needs cargo-llvm-cov, which the stack doesn't ship); record that under Deferred.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make install` runs `lefthook install` outside CI once `lefthook.yml` exists, so write that file first. pre-commit runs `cargo fmt --all` and restages the staged `.rs` files; pre-push runs `make lint test`. Clippy and doctests check the whole crate, so they stay out of pre-commit.
<!-- stacks:end -->

## Gotchas

- `cargo test --all-targets` skips doctests, and so does cargo-nextest. Use plain `cargo test` (the Claude guard hook denies `--all-targets` on `cargo test`).
- `cargo add serde --optional` without `--features derive` compiles with the feature off and fails with it on; `make check` catches it on the all-features pass.
- `cargo package` warns "ignoring test ... not included in the published package" for each file under `tests/`: that is the `include` list working. It warns about a missing `repository` until one is set.
- `cargo package` checks only what ships, with default features: an `include_str!` target or module left out of `include` fails there and nowhere else. The step also needs the crates.io index, which `make install` fetches.
- Changing `package.version` changes `Cargo.lock`, so `--locked` checks fail until `make install` or a plain `cargo check` updates it.
- Clippy's `allow-unwrap-in-tests` covers `#[test]` functions and `#[cfg(test)]` modules, not helpers in `tests/*.rs`. Helpers return `Result`.
- `std::env::set_var` is `unsafe` in edition 2024 and `unsafe_code` is forbidden; the library reads no environment.
- The agent-ops format hook passes rustfmt the edition from `[workspace.package]`, so keep the edition there rather than in a `rustfmt.toml`.
