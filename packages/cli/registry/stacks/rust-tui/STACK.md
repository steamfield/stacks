---
schema_version: 1
id: rust-tui
kind: stack
name: Rust terminal UI (Ratatui)
description: A full-screen Rust terminal app on Ratatui and crossterm, with app state and key handling kept apart from drawing, keybindings in one table that feeds the help overlay, frames rendered into Ratatui's test backend and compared to insta snapshots, a text and JSON fallback when there's no terminal, and terminal restore on panic.
tags: [rust, tui, make]
deps:
  tui: [ratatui, clap, serde, serde_json, thiserror, tracing, tracing-subscriber]
  test: [insta, assert_cmd, tempfile]
tools: [cargo, rustup, make, git]
decisions:
  - "Binary name: the project slug (default; the package name in Cargo.toml). Renaming the package renames the binary and its environment prefix."
  - "Proving payload: the task list, from the built-in sample or a JSON file (default), or the project's first real data loaded the same way, keeping the list and detail screens and their snapshots."
  - "Without a terminal: print the list as text, or JSON with --json (default). If the product has nothing useful to print, exit 2 with a message saying to run it in a terminal; keep the binary test for it."
  - "Event loop: blocking crossterm reads on one thread (default), or a tick or async event stream (crossterm's event-stream feature with tokio) once the app has background work or animation."
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
  test: Unit, frame snapshot, event loop and binary tests (none needs a terminal)
  snapshots: Rewrite the frame snapshots after a deliberate view change; read the diff
  build: Release binary in target/release/
  smoke: Run the release binary's --help and --version, and its text and JSON fallback with no terminal
  audit: Advisories, licenses and sources with cargo-deny (needs network)
  ci: "Everything CI runs (fmt-check, clippy, test, smoke, audit)"
  clean: Remove build output
---

# Rust terminal UI (Ratatui)

A full-screen terminal app: Ratatui draws, crossterm reads keys, and the state that decides what to draw is plain Rust that tests drive without a terminal. The `Makefile` is the entry point for every task.

## What stacks wrote

A working slice that passes every check once its crates are added. `Cargo.toml` is one package at the root inside a workspace, with the lint policy in `[workspace.lints]` and no dependencies yet; `clippy.toml`, `rust-toolchain.toml` and `deny.toml` sit beside it. `src/main.rs` captures the process (arguments, environment, whether stdin and stdout are terminals) and calls `run::run`, which parses flags (`cli.rs`), loads `Config` (`config.rs`), opens the log file (`logging.rs`), loads the tasks (`tasks.rs`), then either starts the UI or prints through `output.rs`, and reports any `AppError` (`error.rs`) once. The UI is four modules: `app.rs` (the `App` state and `update(Action)`), `keys.rs` (every binding in one table), `ui.rs` (`draw(frame, &App)` and its `Theme`) and `tui.rs` (terminal setup, restore and the event loop). The payload is a task list with filter-as-you-type, a detail screen and a help overlay. Unit tests sit in each module; frame snapshots live in `src/snapshots/`; `tests/binary.rs` runs the built binary with no terminal. `docs/` has ARCHITECTURE, configuration and `guidance/rust.md`. Read the code before extending it.

## Setup

No generator.

1. Add the crates with their features, so each resolves to its current release:
   - `cargo add ratatui`
   - `cargo add clap serde --features clap/derive,serde/derive`
   - `cargo add serde_json thiserror tracing`
   - `cargo add tracing-subscriber --features env-filter,json`
   - `cargo add --dev insta assert_cmd tempfile`

   Use crossterm through `ratatui::crossterm`, never as its own dependency: two crossterm versions in one build compile, but their key events are different types. Set `package.version` in `Cargo.toml` per the version decision.
2. `make install`, then `make fmt-check clippy check test smoke`. Ratatui still makes breaking changes between releases: where the installed release rejects shipped code (a renamed widget method, a changed `Backend` bound) or a newer clippy flags it, fix the code. Keep every lint in `[workspace.lints]`; a lint that is wrong for one item gets `#[expect(<lint>, reason = "...")]` on that item. Run `make fmt` after editing; there is no `rustfmt.toml`.
3. If only the frame snapshots fail and the diff is a rendering change in the new Ratatui release (a border symbol, padding), run `make snapshots`, read every changed `.snap` file, and keep the change only when the text a user reads is the same. A missing line or wrong text is a bug to fix. Never delete a snapshot case.
4. Record the toolchain: set `channel` in `rust-toolchain.toml` to the installed stable release (`rustc --version`), keeping the components.
5. Run `make audit` once. It installs cargo-deny when missing (from source, a few minutes, unless cargo-binstall is on PATH) and fetches the advisory database. A license failure means reading that license before adding it to `deny.toml`'s `allow` list; an advisory means `cargo update -p <crate>`. Record the result in AGENTS.md.
6. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/rust.md` from AGENTS.md, then run `stacks verify` until it passes.

## Conventions

`docs/guidance/rust.md` holds the Rust rules (lints, errors, output, testing); the shipped code follows each one. For the UI:

- **Two front ends, one decision.** `run::invoke` starts the UI only when neither `--no-tui` nor `--json` is set and stdin and stdout are both terminals. Everything the UI shows can also print through `output.rs` as text and JSON.
- **State, keys, drawing.** Every change to what's on screen is an `Action` handled in `App::update`. `ui::draw` only reads `&App`; it does no I/O and changes nothing. Data loads before the UI starts (or, once there is background work, on another thread that sends results back as events), never inside `draw` or `update`.
- **Keys.** Every key is a row in `keys::BINDINGS` with its modes, label and help text; the footer and help overlay read the table. While filtering, characters go to the filter and only ctrl+c quits.
- **Styles** come from `Theme` in `ui.rs`; no colors inline.
- **Terminal.** Only `tui::run` touches the real terminal: `ratatui::try_init` (raw mode, alternate screen, a panic hook that restores both), the loop, then `try_restore` on every path.
- **Logging**: `tracing` macros to `--log-file` (JSON lines) or nowhere. Never `println!`/`eprintln!` (the lints deny both): the screen belongs to the UI.
- **Errors**: one `AppError` with an UPPER_SNAKE code, a suggestion and an exit status (usage 2, configuration 3, everything else 1). `main` returns `ExitCode`; nothing calls `process::exit`.
- **Config**: flags over `<PREFIX>_*` environment variables over defaults, in `config.rs`. A new setting gets a flag, its variable, validation, a test and a row in `docs/configuration.md` and `.env.example`.

## Testing

`app.rs` tests are the state machine: build an `App`, send actions, assert on mode, selection and filter. `keys.rs` tests map key events to actions. `ui.rs` draws each screen into Ratatui's `TestBackend` at a fixed size and compares it with `src/snapshots/<name>.snap` (list, filtered, empty, detail, help, narrow); a new screen or state adds one. `tui.rs` runs the real event loop headless over scripted key events. `tests/binary.rs` runs the built binary with stdin from `/dev/null` and a timeout, covering text, JSON, flags, environment, the log file and each exit status. A snapshot test that fails writes a `.snap.new` beside the snapshot; `make snapshots` accepts every change at once, so read the diff before committing. Iterate with `cargo test <name>`.

## Commands

The shipped Makefile (`make help`) has install, fmt, fmt-check, clippy, lint, check, test, snapshots, build, smoke, audit, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md. No target starts the UI. Checks run with `--locked`, so `Cargo.lock` must match `Cargo.toml`; commit it.
<!-- stacks:when with=agent-ops -->

**Agent ops.** The stack's Claude settings allow its non-destructive make targets and cargo checks, and `.claude/hooks/guard-tui.sh` denies hand edits to `src/snapshots/`, `Cargo.lock` and `target/`, and running anything under `script`, `unbuffer`, `tmux` or `screen`; `tests/claude_hooks.rs` tests it under `make test`. List the hook in `.claude/README.md`. The `add-screen` skill walks through a new screen.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->

**CI.** One `ubuntu-latest` job: `make install`, then `make ci` (fmt-check, clippy, test, smoke, audit), with cargo-deny already installed so `make audit` skips compiling it. CI has no terminal, which is what the tests expect. insta never writes snapshots when `CI` is set, so a stale one fails. No coverage target (it needs cargo-llvm-cov); record that under Deferred.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make install` runs `lefthook install` outside CI once `lefthook.yml` exists, so write that file first. pre-commit runs `cargo fmt --all` and restages the staged `.rs` files; pre-push runs `make lint test`. Clippy checks the whole crate, so it stays out of pre-commit.
<!-- stacks:end -->

## Gotchas

- crossterm opens `/dev/tty` when stdin isn't a terminal, so a piped run would still take over the terminal and hang an agent's shell. The terminal check in `run::invoke` stays before `tui::run`.
- Never run the UI under `script`, `unbuffer`, `tmux` or `screen` to see it; the session waits for keys. Use the tests, `--no-tui` or `--json`, or ask the user to run it.
- Most examples online use older Ratatui (`Frame<B>`, `tui-rs`, `terminal::enable_raw_mode` by hand). The shipped `try_init`/`try_restore` pair sets up and restores raw mode, the alternate screen and the panic hook together.
- Snapshots hold the frame's text, not its colors, and depend on the size the test sets. Change the size and every snapshot changes.
- On Windows crossterm reports key releases too; `keys::action` acts on presses only, so keys don't fire twice.
- Clippy's `allow-unwrap-in-tests` covers `#[test]` functions and `#[cfg(test)]` modules, not helpers in `tests/*.rs`.
- `std::env::set_var` is `unsafe` in edition 2024 and `unsafe_code` is forbidden. Tests build an `Env`; the binary tests set variables on the child process.
- The agent-ops format hook passes rustfmt the edition from `[workspace.package]`, so keep the edition there rather than in a `rustfmt.toml`.
