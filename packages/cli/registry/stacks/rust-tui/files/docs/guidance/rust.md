# Rust

How Rust code in this project is written. The shipped code follows every rule here; keep to them when extending it.

## Crate layout

- One package at the repository root, inside a workspace (`[package]` and `[workspace]` in the same `Cargo.toml`). A second crate goes under `crates/<name>/` with `edition.workspace = true` and `[lints] workspace = true`, and joins `members`.
- Dependencies are added with `cargo add <crate> --features <list>`, never by editing version strings by hand. `Cargo.lock` is committed and only cargo writes it; checks run with `--locked`.
- crossterm is used through `ratatui::crossterm`, not as a separate dependency, so the key events the loop reads are the type Ratatui was built against.
- `rust-toolchain.toml` selects the toolchain. Record the installed stable release there (`channel = "<version>"`) so CI and every machine build with the same compiler.

## Lints

`[workspace.lints]` in `Cargo.toml` is the lint policy: clippy's default set denied, `pedantic` warned (and denied by `-D warnings`), plus `unwrap_used`, `expect_used`, `panic`, `todo`, `dbg_macro`, `print_stdout` and `print_stderr` denied. `clippy.toml` allows unwrap, expect and panic inside tests only.

- Fix a lint rather than silencing it. When a lint is wrong for one item, use `#[expect(clippy::<lint>, reason = "why")]` on that item: `allow_attributes` denies `#[allow]`, and an `expect` fails once it stops being needed.
- `unsafe` is forbidden. Lifting that is a decision for the user, not a fix.
- Keep the policy when adapting it to a newer clippy; a renamed lint gets its new name.

## Errors

- One `thiserror` enum (`src/error.rs`) holds every failure. Each variant has a stable `code()`, a `suggestion()` that tells the user what to do, and an `exit_code()`, all in that file. Add a variant rather than a string error; never reuse or rename a code.
- Functions return `Result<_, AppError>` and propagate with `?`. Wrap an underlying error as the variant's `#[source]` so the message names what failed and the cause stays attached.
- No `unwrap`, `expect` or `panic!` outside tests. `std::process::exit` is never called; `main` returns `ExitCode`.

## The terminal UI

- `App::update(Action)` is the only code that changes UI state. A new behavior is a new `Action` variant handled there, with a unit test that sends it.
- `ui::draw` reads `&App` and renders; no I/O, no state changes, no clock. Colors and modifiers come from `Theme`.
- Every key is a row in `keys::BINDINGS`. A key with no row does nothing, and a row is what puts it in the footer and help overlay.
- Only `tui::run` touches the real terminal. Slow work (files, network) happens before the UI starts or on another thread that sends results into the loop as events; never block inside `draw` or `update`.
- Every new screen or visible state gets a frame snapshot in `ui.rs`'s tests at a fixed size. Accept snapshot changes with `make snapshots` only after reading the diff; never edit a `.snap` file by hand.

## Output and logs

- The UI owns stdout and stderr while it runs. Printed output (`--no-tui`, `--json`, no terminal) goes through `Output` in `src/output.rs`, written once: a text table or one JSON document. Errors are `error[CODE]: message` plus a suggestion, or `{"error":{"code","message","suggestion"}}` under `--json`, on stderr.
- Diagnostics use `tracing` macros with fields (`info!(tasks = n, "start")`), never `println!` or `eprintln!` (the lints deny both). Logs go to `--log-file` as JSON lines, or nowhere.

## State and testing

- `main.rs` is the only place that reads the process: arguments, environment, the working directory and whether stdin and stdout are terminals. Everything below takes those as values (`config::Env`), so tests pass their own.
- Unit tests sit in `#[cfg(test)] mod tests` beside the code, use `tempfile` for files, and build an `Env` instead of setting process variables (tests run in parallel threads).
- `tests/binary.rs` runs the built binary with no terminal and a timeout. Each new flag, output mode or failure gets a case there checking the exit status, stdout and stderr.
- Never run the UI under a fake terminal (`script`, `unbuffer`, `tmux`, `screen`) to check it; the session waits for keys. The snapshots and the headless event loop test are the proof.
- Iterate with `cargo test <name>`; run `make lint test` before finishing.
