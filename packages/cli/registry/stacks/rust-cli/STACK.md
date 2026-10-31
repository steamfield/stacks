---
schema_version: 1
id: rust-cli
kind: stack
name: Rust CLI
description: A Rust command-line tool with clap commands, layered TOML config (file, env, flags), thiserror errors mapped to exit codes with fix suggestions, human and JSON output, tracing logs to stderr, strict clippy lints, and assert_cmd tests against the built binary.
tags: [rust, cli, make]
deps:
  cli: [clap, serde, serde_json, toml, thiserror, tracing, tracing-subscriber]
  test: [assert_cmd, tempfile]
tools: [cargo, rustup, make, git]
decisions:
  - "Binary name: the project slug (default; the package name in Cargo.toml). Renaming the package renames the binary, its config paths and its environment prefix."
  - "Config: TOML at $XDG_CONFIG_HOME/<binary>/config.toml (or ~/.config/...) plus an optional ./<binary>.toml (default), or environment and flags only."
  - "Package version: the one `cargo new` writes (default), set as package.version in Cargo.toml."
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
  - { name: build, layer: build, run: make build }
  - { name: smoke, layer: test, run: make smoke }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Install the toolchain rust-toolchain.toml selects and fetch crates
  fmt: Format the code
  fmt-check: Fail if rustfmt would change any file
  clippy: clippy on every target with warnings denied
  lint: fmt-check and clippy
  check: Type-check every target
  test: Unit and integration tests (the integration tests run the binary)
  build: Release binary in target/release/
  smoke: Run the release binary's --help, --version and config show --json
  audit: Advisories, licenses and sources with cargo-deny (needs network)
  ci: "Everything CI runs (fmt-check, clippy, test, smoke, audit)"
  clean: Remove build output
---

# Rust CLI

A single-binary command-line tool: clap commands, typed config layered from defaults, TOML files, environment and flags, one error enum with codes, suggestions and exit statuses, and the `Makefile` as the entry point for every task.

## What stacks wrote

A working slice that passes every check once its crates are added. `Cargo.toml` is one package at the root inside a workspace, with the lint policy in `[workspace.lints]` and no dependencies yet; `clippy.toml`, `rust-toolchain.toml` and `deny.toml` sit beside it. `src/main.rs` captures the process and calls `app::run`, which parses (`cli.rs`), loads `Config` (`config.rs`), starts tracing (`logging.rs`), dispatches to `commands/config.rs` (`config show`), and reports any `AppError` (`error.rs`) once through `output.rs`. Unit tests sit in each module; `tests/cli.rs` runs the built binary. The `greeting` setting is the hello-world payload. `docs/` has ARCHITECTURE (modules and the exit-status table), configuration, and `guidance/rust.md`, the Rust rules every agent follows. Read the code before extending it; it is the reference for every convention below.

## Setup

No generator.

1. Add the crates with their features, so each resolves to its current release:
   - `cargo add clap --features derive`
   - `cargo add serde --features derive`
   - `cargo add serde_json toml thiserror tracing`
   - `cargo add tracing-subscriber --features env-filter,json`
   - `cargo add --dev assert_cmd tempfile`

   Set `package.version` in `Cargo.toml` per the version decision; the shipped manifest has none, so `--version` prints Cargo's all-zero placeholder until it's set.
2. `make install`, then `make fmt-check clippy check test smoke`. Where an installed release rejects shipped code (a renamed clap attribute, a changed `toml` error API) or a newer clippy flags it, fix the code. Keep every lint in `[workspace.lints]`; a lint that is wrong for one item gets `#[expect(<lint>, reason = "...")]` on that item, as `src/cli.rs` does. Run `make fmt` after editing; the shipped code uses rustfmt's defaults and there is no `rustfmt.toml`.
3. Record the toolchain: set `channel` in `rust-toolchain.toml` to the installed stable release (`rustc --version`), keeping the components. CI and every machine then build with the same compiler.
4. Run `make audit` once. It installs cargo-deny when missing (from source, a few minutes, unless cargo-binstall is on PATH) and fetches the advisory database. A failure on a crate's license means reading that license before adding it to `deny.toml`'s `allow` list; an advisory means updating the crate (`cargo update -p <crate>`). Record the result in AGENTS.md.
5. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/rust.md` from AGENTS.md, then run `stacks verify` until it passes.

## Conventions

`docs/guidance/rust.md` holds the Rust rules (lints, errors, output, testing); the shipped code follows each one. For this tool:

- **Commands**: one module per command under `src/commands/`, a `Command` variant in `src/cli.rs` and one arm in `app::invoke`'s `match`. The handler takes `&Config`, the `Output` and the stdout writer and returns `Result<(), AppError>`. The `add-command` skill walks through it.
- **I/O**: stdout carries the result only, written once through `Output::result`; `--json` makes it one JSON document. Errors go to stderr once, from `app::run`: `error[CODE]: message` and a suggestion line, or `{"error":{"code","message","suggestion"}}` under `--json`.
- **Exit status**: 0 success, 1 runtime failure, 2 invalid invocation, 3 invalid configuration, all in `AppError::exit_code`. A new failure is a new variant with its code, suggestion and status, and a row in `docs/ARCHITECTURE.md`. Never rename a code.
- **Config**: commands receive the typed `Config`. A new setting gets a default, the file and env layers, a `validate` rule if it can be wrong, a precedence test and a row in `docs/configuration.md`. Unknown keys in a config file are an error.
- **Process state**: only `main.rs` reads arguments, environment, the working directory or the terminal; everything else takes `config::Env`. `--help` and `--version` never read config files.
- **Logging**: `tracing` macros with fields; never `println!`/`eprintln!` (denied by the lints). `RUST_LOG` overrides the level and is validated.

## Testing

Unit tests sit in each module's `#[cfg(test)] mod tests`: config precedence and validation with `tempfile` directories and a built `Env`, the error table, both output modes, `app::run` with in-memory buffers, and `Cli::command().debug_assert()`. `tests/cli.rs` runs the built binary with a cleared environment and asserts exit status, stdout and stderr in human and JSON mode. A new command gets unit tests for both output modes and an integration case per outcome. `make test` runs both layers; `make smoke` runs the release binary that `make build` produced.

## Commands

The shipped Makefile (`make help`) has install, fmt, fmt-check, clippy, lint, check, test, build, smoke, audit, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md. Checks run with `--locked`, so `Cargo.lock` must match `Cargo.toml`; commit it.
<!-- stacks:when with=ci-github -->

**CI.** One `ubuntu-latest` job: `make install`, then `make ci` (fmt-check, clippy, test, smoke, audit), with cargo-deny already installed so `make audit` skips compiling it. The stack has no coverage target (Rust coverage needs cargo-llvm-cov, which it doesn't ship), so CI runs plain tests; record that under Deferred.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** pre-commit runs `cargo fmt --all` and restages the staged `.rs` files; pre-push runs `make lint test`. Clippy checks the whole crate, so it stays out of pre-commit.
<!-- stacks:end -->

## Gotchas

- `cargo add` without the listed features compiles the crate but not the shipped code: `#[derive(Parser)]` needs clap's `derive`, `EnvFilter` needs `env-filter`, JSON logs need `json`.
- Clippy's `allow-unwrap-in-tests` covers `#[test]` functions and `#[cfg(test)]` modules, not helper functions in `tests/*.rs`. A helper returns `io::Result` or the `unwrap` moves into the test.
- `std::env::set_var` is `unsafe` in edition 2024 and `unsafe_code` is forbidden. Tests build an `Env` value; integration tests set variables on the child process.
- cargo-deny reports the tool's own crate as unlicensed; `deny.toml` ignores unpublished crates (`publish = false`). Set `license` in `Cargo.toml` before removing `publish = false`.
- `cargo test` builds a debug binary for `tests/cli.rs`; `make smoke` needs `make build`'s release binary. Set `CARGO_TARGET_DIR` to share `target/` across worktrees; the Makefile follows it.
- The agent-ops format hook passes rustfmt the edition from `[workspace.package]`, so keep the edition there rather than in a `rustfmt.toml`.
