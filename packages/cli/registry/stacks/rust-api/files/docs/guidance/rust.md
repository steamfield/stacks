# Rust

How Rust code in this project is written. The shipped code follows every rule here; keep to them when extending it.

## Crate layout

- One package at the repository root, inside a workspace (`[package]` and `[workspace]` in the same `Cargo.toml`). Every module lives in the library (`src/lib.rs`, crate name `api`); `src/main.rs` only reads the process and calls `api::run`. A second crate goes under `crates/<name>/` with `edition.workspace = true` and `[lints] workspace = true`, and joins `members`.
- Dependencies are added with `cargo add <crate> --features <list>`, never by editing version strings by hand. `Cargo.lock` is committed and only cargo writes it; checks run with `--locked`.
- `rust-toolchain.toml` selects the toolchain. Record the installed stable release there (`channel = "<version>"`) so CI and every machine build with the same compiler.

## Lints

`[workspace.lints]` in `Cargo.toml` is the lint policy: clippy's default set denied, `pedantic` warned (and denied by `-D warnings`) except the two library-documentation lints, plus `unwrap_used`, `expect_used`, `panic`, `todo`, `dbg_macro`, `print_stdout` and `print_stderr` denied. `clippy.toml` allows unwrap, expect and panic inside `#[test]` functions and `#[cfg(test)]` modules only.

- Fix a lint rather than silencing it. When a lint is wrong for one item, use `#[expect(clippy::<lint>, reason = "why")]` on that item, as `app::panicked` does: `allow_attributes` denies `#[allow]`, and an `expect` fails once it stops being needed.
- `unsafe` is forbidden. Lifting that is a decision for the user, not a fix.
- Keep the policy when adapting it to a newer clippy; a renamed lint gets its new name.

## Errors

- A request fails with an `ApiError` variant (`src/error.rs`). `ApiError::row` is the one table from variant to status, tag, fixed message and retryability. Add a variant and a row rather than building a response by hand; never rename a tag, since clients branch on it.
- Domain modules have their own `thiserror` enums (`NoteError`) and know nothing about HTTP; a `From` impl in `error.rs` maps each into `ApiError`, so handlers propagate with `?`.
- Detail goes in the variant (`BadInput(String)`) and into the log, never into the response body.
- Process failures are `StartError` variants with a code and exit status. No `unwrap`, `expect` or `panic!` outside tests; `std::process::exit` is never called.

## Handlers and async

- Handlers return `Result<_, ApiError>`. Extract with `crate::extract::{Json, Path, Query}` so rejections become envelopes; the body extractor (`Json`) is the last argument.
- Never block an async task: no `std::fs`, `std::thread::sleep`, blocking HTTP clients or synchronous database drivers in a handler or store. Use tokio's APIs, or move the work to `tokio::task::spawn_blocking`. Clippy can't catch this, so review for it.
- Hold a `std::sync::Mutex` only for in-memory work with no `.await` inside, as `MemoryStore` does; across an `.await` use `tokio::sync::Mutex`.
- Middleware belongs in `app::layer`, not on individual routes.

## Logs

- `tracing` macros with fields (`tracing::info!(addr = %local, "listening")`), never `println!` or `eprintln!` (the lints deny both). Logs are JSON on stderr; `RUST_LOG` filters them.
- Never log request bodies, query values, headers carrying credentials, or anything a client sent beyond the request id.

## State and testing

- `main.rs` is the only place that reads the process. Everything below takes `config::Env` values, so tests build their own with `Env::from([("PORT", "0")])` instead of setting process variables (`set_var` is `unsafe` in edition 2024).
- Unit tests sit in `#[cfg(test)] mod tests` beside the code. Async tests use `#[tokio::test]`.
- `tests/http.rs` drives `app::router` with `tower::ServiceExt::oneshot`. Each new route gets a success case and one case per failure there, asserting status, the envelope's `tag` and headers. Helpers in `tests/*.rs` return `Result` and tests use `?`, because clippy's unwrap allowance doesn't reach helper functions there.
- `tests/binary.rs` runs the built binary: keep its signal, healthcheck and startup-failure cases.
- Iterate with `cargo test <name>`; run `make lint test` before finishing.
