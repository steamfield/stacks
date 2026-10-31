# Rust

How Rust code in this project is written. The shipped code follows every rule here; keep to them when extending it.

## Crate layout

- One package at the repository root, inside a workspace (`[package]` and `[workspace]` in the same `Cargo.toml`). A second crate goes under `crates/<name>/` with `edition.workspace = true` and `[lints] workspace = true`, and joins `members`.
- Dependencies are added with `cargo add <crate> --features <list>`, never by editing version strings by hand. `Cargo.lock` is committed and only cargo writes it; checks run with `--locked`.
- `rust-toolchain.toml` selects the toolchain. Record the installed stable release there (`channel = "<version>"`) so CI and every machine build with the same compiler.

## Lints

`[workspace.lints]` in `Cargo.toml` is the lint policy: clippy's default set denied, `pedantic` warned (and denied by `-D warnings`), plus `unwrap_used`, `expect_used`, `panic`, `todo`, `dbg_macro`, `print_stdout` and `print_stderr` denied. `clippy.toml` allows unwrap, expect and panic inside tests only.

- Fix a lint rather than silencing it. When a lint is wrong for one item, use `#[expect(clippy::<lint>, reason = "why")]` on that item: `allow_attributes` denies `#[allow]`, and an `expect` fails once it stops being needed.
- `unsafe` is forbidden. Lifting that is a decision for the user, not a fix.
- Keep the policy when adapting it to a newer clippy; a renamed lint gets its new name.

## Errors

- One `thiserror` enum (`src/error.rs`) holds every failure the tool reports. Each variant has a stable `code()`, a `suggestion()` that tells the user what to do, and an `exit_code()`, all in that file. Add a variant rather than a string error; never reuse or rename a code, since scripts branch on it.
- Functions return `Result<_, AppError>` and propagate with `?`. Wrap an underlying error as the variant's `#[source]` so the message names what failed (the path, the key) and the cause stays attached.
- No `unwrap`, `expect` or `panic!` outside tests. `std::process::exit` is never called; `main` returns `ExitCode`.

## Output and logs

- stdout carries results only, written once per command through `Output::result` (`src/output.rs`). Under `--json` that is one JSON document; errors are `{"error":{"code","message","suggestion"}}` on stderr.
- Diagnostics use `tracing` macros (`debug!`, `warn!`) with fields (`debug!(path = %p.display(), "reading config")`), never `println!` or `eprintln!` (the lints deny both). Logs go to stderr; `RUST_LOG` overrides the level and an invalid value is a setting error.

## State and testing

- `main.rs` is the only place that reads the process: arguments, environment, the working directory and whether stderr is a terminal. Everything below takes those as values (`config::Env`), so tests pass their own.
- Unit tests sit in `#[cfg(test)] mod tests` beside the code, use `tempfile` for files, and build an `Env` instead of setting process variables (tests run in parallel threads).
- `tests/cli.rs` runs the built binary with a cleared environment. Each new command or failure mode gets a case there checking the exit status, stdout and stderr.
- Iterate with `cargo test <name>`; run `make lint test` before finishing.
