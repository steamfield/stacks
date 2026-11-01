---
schema_version: 1
id: rust-api
kind: stack
name: Rust HTTP API (Axum)
description: A Rust JSON API on Axum and Tokio with one error envelope from a thiserror status table, extractor rejections mapped into it, tower-http request ids, access logs, timeouts and panic recovery, JSON tracing logs, graceful shutdown on SIGINT and SIGTERM, and tests against the real router in process and the built binary.
tags: [rust, api, make]
deps:
  api: [axum, tokio, tower, tower-http, serde, serde_json, thiserror, tracing, tracing-subscriber]
tools: [cargo, rustup, make, git]
decisions:
  - "Listen address: HOST 127.0.0.1 and PORT 8080 (default); a container sets HOST=0.0.0.0."
  - "Proving resource: notes (title, body) held in memory (default), or the project's first real resource with the same routes and tests."
  - "Persistence: none (default). A database store implements NoteStore and replaces MemoryStore in server::run."
  - "Library crate name: api (default), fixed so main.rs and tests/ import it without the project slug; rename it in Cargo.toml's [lib] and every `use api::` line. The binary keeps the package name."
  - "OpenAPI document: none (default), or utoipa with a committed spec and a verify step that fails when it drifts."
  - "Tests: cargo test (default), or cargo-nextest, which skips doctests, so a project on nextest also runs cargo test --doc."
env:
  PORT: "8080"
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github, rest-api]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: clippy, layer: lint, run: make clippy }
  - { name: check, layer: typecheck, run: make check }
  - { name: test, layer: test, run: make test }
  - { name: build, layer: build, run: make build }
  - name: api
    phase: serve
    layer: serve
    run: make serve
    expect: { http: "http://127.0.0.1:${PORT}/healthz", within: 60s }
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
  test: Unit, router and binary tests (tests/binary.rs starts the server and signals it)
  build: Release binary in target/release/
  serve: Build, then run the release server in the foreground until SIGINT or SIGTERM
  audit: Advisories, licenses and sources with cargo-deny (needs network)
  ci: "Everything CI runs (fmt-check, clippy, test, build, audit)"
  clean: Remove build output
---

# Rust HTTP API (Axum)

A JSON service on Axum and Tokio: one error table from variant to status, one envelope for every failure (axum's own rejections included), request ids and access logs from tower-http, a request timeout and panic recovery, JSON logs on stderr, and a clean stop on SIGINT or SIGTERM. The `Makefile` is the entry point for every task.

## What stacks wrote

A working slice that passes every check once its crates are added. `Cargo.toml` is one package at the root inside a workspace, with the lint policy in `[workspace.lints]`, a library named `api` and no dependencies yet; `clippy.toml`, `rust-toolchain.toml` and `deny.toml` sit beside it. `src/main.rs` reads the process and calls `api::run` (`src/lib.rs`), which serves or answers `--healthcheck` (`probe.rs`). Serving loads `Config` from the environment (`config.rs`), starts JSON logging (`logging.rs`) and runs `server::run`: bind, log `listening`, serve `app::router`, drain on a signal, log `stopped`. `app.rs` layers the middleware over the route table (`routes.rs`, `routes/health.rs`, `routes/notes.rs`); `error.rs` holds `ApiError` with its status table and `StartError` with its exit statuses; `extract.rs` wraps axum's extractors so rejections become envelopes. The in-memory notes resource (`notes.rs`, create, read and cursor-paged list) is the payload. Unit tests sit in each module; `tests/http.rs` drives the real router in process and `tests/binary.rs` runs the built server and signals it. `docs/` has ARCHITECTURE, configuration, `http-api.md` (the HTTP contract) and `guidance/rust.md`, the Rust rules every agent follows. Read the code before extending it.

## Setup

No generator.

1. Add the crates with their features, so each resolves to its current release:
   - `cargo add axum --features macros`
   - `cargo add tokio --features macros,rt-multi-thread,net,signal,time`
   - `cargo add tower --features timeout,util`
   - `cargo add tower-http --features trace,request-id,catch-panic,set-header`
   - `cargo add serde --features derive`
   - `cargo add serde_json thiserror tracing`
   - `cargo add tracing-subscriber --features env-filter,json`
2. `make install`, then `make fmt-check clippy check test build`. Where an installed release rejects shipped code (a renamed tower-http constructor, a changed rejection type) or a newer clippy flags it, fix the code. Keep every lint in `[workspace.lints]`; a lint that is wrong for one item gets `#[expect(<lint>, reason = "...")]` on that item, as `app::panicked` does. Run `make fmt` after editing; there is no `rustfmt.toml`.
3. Record the toolchain: set `channel` in `rust-toolchain.toml` to the installed stable release (`rustc --version`), keeping the components.
4. Run `make audit` once. It installs cargo-deny when missing (from source, a few minutes, unless cargo-binstall is on PATH) and fetches the advisory database. A license failure means reading that license before adding it to `deny.toml`'s `allow` list; an advisory means `cargo update -p <crate>`. Record the result in AGENTS.md.
5. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/rust.md` and `docs/http-api.md` from AGENTS.md, then run `stacks verify` until it passes. The `api` step runs `make serve` and probes `/healthz` on `PORT`.

## Conventions

`docs/guidance/rust.md` holds the Rust rules (lints, errors, handlers and async, logs, testing) and `docs/http-api.md` the HTTP contract; the shipped code follows both. For this service:

- **Routes**: the table in `src/routes.rs`, one handler module per resource under `src/routes/`, resources under `/v1/<plural-noun>`. Handlers return `Result<_, ApiError>` and extract with `crate::extract`, never axum's `Json`, `Query` or `Path`. The `add-route` skill walks through a new route or resource.
- **Errors**: a new failure is an `ApiError` variant and an arm in `ApiError::row` (status, tag, fixed message, retryable), plus a row in `docs/http-api.md`. Domain errors map in through `From`. Details are logged, never sent.
- **Domain**: resources (`notes.rs`) know nothing about HTTP and sit behind a store trait; handlers are generic over it.
- **Middleware**: only in `app::layer`, which keeps the 404 and 405 envelopes, the timeout, the body limit and `Cache-Control: no-store`.
- **Config**: env only, read through `config::Env` in `Config::load`. A new setting gets a default, validation, a unit test, a line in `.env.example` and a row in `docs/configuration.md`.
- **Process**: only `main.rs` reads the process; exit statuses live in `StartError::exit_code` (1 runtime, 2 arguments, 3 settings).

## Testing

Unit tests sit in each module's `#[cfg(test)] mod tests`: config parsing and validation with built `Env` values, the error table and envelope, store validation and paging, the panic and timeout envelopes through `app::layer`, a bind failure, and the healthcheck target. `tests/http.rs` sends requests through `app::router` with `tower::ServiceExt::oneshot` and asserts status, the envelope's `tag` and headers for every route, bad bodies (400, 413, 415), bad queries, misses and wrong methods (405 with `Allow`). `tests/binary.rs` starts the built binary on `PORT=0`, reads the port from its `listening` record, runs `--healthcheck`, and checks a clean exit on SIGTERM and SIGINT plus exit statuses for a bad setting and bad arguments. A new route gets its cases in `tests/http.rs`.

## Commands

The shipped Makefile (`make help`) has install, fmt, fmt-check, clippy, lint, check, test, build, serve, audit, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md with a single-test command such as `cargo test --test http bad_queries`. Run `make serve` in the background when needed and stop only the pid you started. Checks run with `--locked`; commit `Cargo.lock`.
<!-- stacks:when with=ci-github -->

**CI.** One `ubuntu-latest` job: `make install`, then `make ci` (fmt-check, clippy, test, build, audit), with cargo-deny already installed so `make audit` skips compiling it. The stack has no coverage target (Rust coverage needs cargo-llvm-cov, which it doesn't ship), so CI runs plain tests; record that under Deferred.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make install` runs `lefthook install` outside CI once `lefthook.yml` exists, so write that file first. pre-commit runs `cargo fmt --all` and restages the staged `.rs` files; pre-push runs `make lint test`. Clippy checks the whole crate, so it stays out of pre-commit.
<!-- stacks:end -->
<!-- stacks:when with=rest-api -->

**API conventions.** The notes resource follows the REST rule. Record in AGENTS.md: the `/v1` prefix, the `{"error":{"tag","message","retryable"}}` envelope, cursor pagination (`limit` default 20, max 100, `nextCursor`), and 405 with `Allow` for a wrong method, with notes as the example.
<!-- stacks:end -->

## Gotchas

- `cargo add` without the listed features compiles some crates but not the shipped code: `#[derive(FromRequest)]` needs axum's `macros`, `#[tokio::test]` and `select!` need tokio's `macros`, `.timeout()` needs tower's `timeout`, each tower-http layer needs its own feature.
- Never hold `io::stderr().lock()` across serving. The main thread would keep the lock and every worker's log write would wait forever: the server accepts connections, answers nothing and ignores signals.
- tower-http's `TimeoutLayer` answers with an empty body. The shipped stack uses tower's timeout behind `HandleErrorLayer`, so a slow handler gets the `Unavailable` envelope.
- axum answers its own rejections (bad JSON, wrong content type, bad query) in plain text, and 422 for a wrong field type. `extract.rs` and the `From` impls in `error.rs` route them through the table as 400, 413 or 415.
- Clippy's `allow-unwrap-in-tests` covers `#[test]` functions and `#[cfg(test)]` modules, not helpers in `tests/*.rs`. Helpers return `Result` and tests use `?`.
- `std::env::set_var` is `unsafe` in edition 2024 and `unsafe_code` is forbidden. Tests build an `Env`; `tests/binary.rs` sets variables on the child process.
- `cargo test` builds a debug binary for `tests/binary.rs`; `make serve` runs `make build`'s release binary, so the serve probe never races a compile.
- Bind to `127.0.0.1` locally; `0.0.0.0` on macOS triggers a firewall prompt. A container sets `HOST=0.0.0.0`.
- cargo-deny reports the service's own crate as unlicensed; `deny.toml` ignores unpublished crates (`publish = false`).
- The agent-ops format hook passes rustfmt the edition from `[workspace.package]`, so keep the edition there rather than in a `rustfmt.toml`.
