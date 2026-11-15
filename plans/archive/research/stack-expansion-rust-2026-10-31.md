# Rust stacks for the bundled registry

Research date 2026-10-31. Proposals only; nothing here has been built or benched. Every recommendation below is a recipe hypothesis to be proven by a fresh `stacks new` plus green `stacks verify` on macOS (Apple Silicon) with no credentials.

## Summary and ranked order

| Rank | Proposed id | Name | Priority | One-line case |
| --- | --- | --- | --- | --- |
| 1 | `rust-cli` | Rust CLI | P1 | clap is the most downloaded app framework in Rust; the go-cli of Rust, cheapest to prove |
| 2 | `rust-api` | Rust HTTP API (Axum) | P1 | Backend is the #1 Rust domain; axum is the only Rust web framework with real Stack Overflow share |
| 3 | `rust-library` | Rust library crate | P1 | Every crates.io publish is one; docs, doctests, features and packaging are what agents skip |
| 4 | `rust-tui` | Ratatui terminal app | P2 | Fast-growing, clearly distinct product (event loop, rendering, snapshot tests) |
| 5 | `rust-python` | Python extension in Rust (PyO3) | P2 | Huge real-world pattern (pydantic-core, polars); two-language build agents routinely get wrong |
| 6 | `rust-wasm` | Rust WebAssembly package for JS | P2 | 23% of Rust users target wasm in the browser; proves the JS-consumer boundary |
| 7 | `leptos` | Leptos full-stack web app | P2 | The one full-stack Rust web recipe; heaviest to verify, so last of the web set |
| 8 | `rust-grpc` | Rust gRPC service (tonic) | P2 | Distinct contract-first product; needs an HTTP health route to fit verify's HTTP probe |

P1 is three stacks that share almost everything (one Cargo workspace layout, one lint table, one Makefile shape), so the Rust conventions get proven once on the cheap stacks before the multi-toolchain ones (PyO3, wasm, Leptos) build on them.

Before any of these ship, three fragment gaps need closing (details in "Fragment work"): `agent-ops` hooks have no `*.rs` branch, `ci-github` has no `tag=rust` branch, and `docker-deploy` has no Rust image branch. Each new crate also needs a card in `packages/cli/registry/deps/crates.json` and a line in `registry/allowlist.json` (today 13 crates, all from tauri-react).

## Evidence

Numbers pulled 2026-10-31. crates.io "recent" is the trailing 90 days. Downloads include transitive pulls, so they overstate direct choice for building-block crates (tonic, tower, wasm-bindgen); stars and the surveys are the better signal for "would a developer ask for it by name".

| Crate | Total downloads | Recent (90 d) | GitHub repo | Stars |
| --- | ---: | ---: | --- | ---: |
| clap | 1.29 B | 274.9 M | clap-rs/clap | 16.8 k |
| tokio | 1.13 B | 286.0 M | | |
| axum | 557.8 M | 149.1 M | tokio-rs/axum | 27.7 k |
| actix-web | 88.5 M | 12.9 M | actix/actix-web | 24.9 k |
| tonic | 451.9 M | 106.4 M | grpc/grpc-rust (moved from hyperium/tonic) | 12.5 k |
| wasm-bindgen | 623.9 M | 164.7 M | wasm-bindgen/wasm-bindgen | 9.2 k |
| wasm-pack | 6.7 M | 1.1 M | wasm-bindgen/wasm-pack | 7.3 k |
| pyo3 | 290.9 M | 70.8 M | PyO3/pyo3 | 16.3 k |
| maturin (crate; mostly installed from PyPI) | 1.2 M | 0.13 M | PyO3/maturin | 5.9 k |
| ratatui | 66.1 M | 24.7 M | ratatui/ratatui | 23.1 k |
| sqlx | 178.2 M | 53.0 M | transact-rs/sqlx | 17.6 k |
| leptos | 5.7 M | 1.58 M | leptos-rs/leptos | 21.5 k |
| dioxus | 3.5 M | 1.31 M | DioxusLabs/dioxus | 39.6 k |
| bevy | 8.5 M | 1.92 M | bevyengine/bevy | 49.4 k |
| worker (Cloudflare) | 5.8 M | 2.13 M | cloudflare/workers-rs | 3.8 k |
| egui / iced | 29.3 M / 3.2 M | 8.5 M / 0.7 M | emilk/egui, iced-rs/iced | 31.9 k / 31.9 k |
| napi (Node addons) | 62.1 M | 16.3 M | napi-rs/napi-rs | 8.0 k |
| rocket / poem / loco-rs | 14.6 M / 6.2 M / 0.7 M | 2.3 M / 0.9 M / 0.14 M | | |
| embassy-executor | 3.6 M | 1.0 M | | |
| assert_cmd | 95.2 M | 20.9 M | | |
| cargo-nextest / cargo-deny / cargo-audit / cargo-llvm-cov | 13.6 M / 7.0 M / 14.2 M / 8.8 M | 1.8 M / 2.2 M / 4.2 M / 1.9 M | nextest-rs/nextest 3.4 k, EmbarkStudios/cargo-deny 2.5 k | |
| cargo-dist | 0.19 M (mostly installed from GitHub releases) | 19 k | axodotdev/cargo-dist | 2.1 k |

Sources: crates.io API (`https://crates.io/api/v1/crates/<name>`, e.g. [axum](https://crates.io/crates/axum), [clap](https://crates.io/crates/clap), [ratatui](https://crates.io/crates/ratatui), [pyo3](https://crates.io/crates/pyo3), [leptos](https://crates.io/crates/leptos), [dioxus](https://crates.io/crates/dioxus), [tonic](https://crates.io/crates/tonic), [bevy](https://crates.io/crates/bevy), [worker](https://crates.io/crates/worker)); GitHub API for stars and last push (all repos above pushed within the last month, none archived).

Surveys:

- **2025 State of Rust Survey** (Rust Survey Team, 7,156 responses, published 2026-03-02): [results post](https://blog.rust-lang.org/2026/03/02/2025-State-Of-Rust-Survey-results). The domain charts are images only; coverage reports server/backend as the top organizational domain at 51.7%, cloud 25.3%, distributed systems about 22% ([The New Stack](https://thenewstack.io/rust-enterprise-developers/)). Slow compiles and storage use remain top problems per the post; secondary coverage puts high disk usage at 22.24% and debugging at 19.90% as "big problems" ([InfoWorld](https://www.infoworld.com/article/4139528/rust-developers-have-three-big-worries-survey.html), [i-programmer](https://www.i-programmer.info/news/98-languages/18704-the-state-of-rust-survey-2025.html)). I could not get a 2025 CLI-domain percentage from text.
- **2024 State of Rust Survey**: 23% of respondents target WebAssembly in the browser and 7% other wasm uses; server backends, networking and cloud are named as the most popular domains ([results](https://blog.rust-lang.org/2025/02/13/2024-State-Of-Rust-Survey-results/)).
- **Stack Overflow 2026, web frameworks** (10,281 respondents): Axum 3.6%, Leptos 0.2%; no other Rust framework listed ([data](https://survey.stackoverflow.co/2026/technology/data/web-framework)).
- **JetBrains Developer Ecosystem 2025**: web backends are the third most popular Rust use case ([RustRover axum post](https://blog.jetbrains.com/rust/2026/07/23/axum-support-in-rustrover/)); the main report page returned 403 so I have no percentages from it.
- **lib.rs HTTP server category**: axum ranks first, actix-web second ([lib.rs](https://lib.rs/web-programming/http-server)).
- **Ecosystem moves worth knowing**: the rustwasm org was sunset in 2025; wasm-bindgen moved to its own org ([Inside Rust](https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org)); wasm-pack now lives at `wasm-bindgen/wasm-pack` and is active again (last push 2026-10-30), but its maintenance had a gap. tonic's repo is now `grpc/grpc-rust`, and its codegen was split into `tonic-prost` / `tonic-prost-build` ([repo](https://github.com/hyperium/tonic)).

## Conventions every Rust stack shares

Write these once (in rust-cli first) and reuse; they are what the tauri-react Rust half already does, generalized.

- **Cargo workspace at the root** even for one crate (`[workspace] resolver = "3"`, `[workspace.package] edition = "2024"`, `[workspace.lints]`), so a second crate never forces a restructure. The shipped `Cargo.toml` files carry `[package]` name/edition/lints and **no `[dependencies]` blocks and no `rust-version`**; Setup lists the `cargo add` lines with features (tauri-react's pattern).
- **Workspace lints** in Cargo.toml, not `#![deny]` attributes: `[workspace.lints.rust] unsafe_code = "forbid"` (`deny` plus clippy `undocumented_unsafe_blocks` in rust-python and rust-wasm, where FFI may need it), `unused_must_use = "deny"`; `[workspace.lints.clippy] all = { level = "deny", priority = -1 }`, `pedantic = { level = "warn", priority = -1 }`, `unwrap_used`, `expect_used`, `panic`, `todo`, `dbg_macro`, `print_stdout` (apps; `print_stderr` too), `allow_attributes_without_reason = "deny"`. `clippy.toml` allows unwrap/expect/panic in tests (tauri-react ships this). Clippy runs with `--all-targets --all-features -- -D warnings`.
- **Errors**: `thiserror` enums in library code with one function mapping each variant to an exit code (CLI/TUI) or HTTP/gRPC status (API/gRPC); `anyhow` (or `color-eyre` in the TUI) only at the binary edge. The rule is written in the stack's rules file and followed by shipped code.
- **Logging**: `tracing` + `tracing-subscriber` (env-filter, json) to stderr; `RUST_LOG` validated at startup (tauri-react's convention).
- **Config**: a typed `Config` struct with defaults and a `validate()` that returns a typed error; env names prefixed with `{{env_prefix}}`.
- **Format**: `rustfmt.toml` with `edition` set to match Cargo.toml (standalone `rustfmt` on one file, as hooks call it, does not read Cargo.toml's edition), `max_width = 100`; `cargo fmt --all --check`.
- **Tests**: `cargo test` by default (no extra install, runs doctests). cargo-nextest as a decision, not a default: it doesn't run doctests, so a project on nextest needs a separate `cargo test --doc`.
- **Supply chain**: `cargo deny check` (advisories, licenses, bans, sources) with a shipped `deny.toml` holding a license allowlist and no versions. It needs network for the advisory DB but no credentials. `cargo-audit` is the lighter alternative; pick one, and deny covers more.
- **Toolchain**: `rust-toolchain.toml` with `channel = "stable"`, components `rustfmt`, `clippy`, plus targets where needed (wasm32 for wasm/leptos). Setup records the installed toolchain in the project afterwards, as tauri-react does.
- **Task runner**: `make` (tag `make`), matching go-cli/go-api/tauri-react. `just` is popular in Rust but the anatomy requires exactly one of `make`/`scripts`, and ci-github/docker-deploy branch on those.
- **Tool installs**: `make install` runs `rustup toolchain install --no-self-update`, `cargo fetch`, and installs missing cargo subcommands with `cargo binstall` when present, else `cargo install --locked` (slow: cargo-deny compiles for 1 to 2 minutes; cargo-leptos several).

## Proposed stacks

### 1. `rust-cli` (P1): Rust CLI

- **Description (draft):** A Rust command-line tool with clap commands, layered config (file, env, flags), thiserror errors mapped to exit codes, human and JSON output, tracing logs to stderr, and assert_cmd tests against the built binary.
- **Why distinct:** The Rust counterpart of `go-cli` and `typescript-cli`; a single static binary is the most common reason people pick Rust for a tool.
- **Evidence:** clap 275 M recent downloads (second only to serde/thiserror-class crates among app-facing ones), anyhow 269 M, assert_cmd 21 M recent. CLI is consistently named as a core Rust use; tools like ripgrep, fd, uv and ruff set the expectation.
- **Tags:** `rust, cli, make`
- **Crates:**
  - runtime: `clap` (derive, env, wrap_help), `serde` (derive), `serde_json`, `toml`, `thiserror`, `anyhow`, `tracing`, `tracing-subscriber` (env-filter, fmt), `etcetera` or `directories` for the config path (decision)
  - dev: `assert_cmd`, `predicates`, `assert_fs` (or `tempfile`), `insta` for help/JSON output snapshots
- **Tools:** cargo, rustup, make, git; `cargo-deny` installed by `make install`.
- **Proving slice:** `src/main.rs` (thin: parse, init logs, run, map error to `ExitCode`), `src/cli.rs` (root with `--config --json -v/-q --no-color --version`, and a `config show` subcommand), `src/config.rs` (defaults < file < env < flags, `validate`), `src/error.rs` (enum with code, message, suggestion; one `exit_code()`), `src/output.rs` (human vs `--json`; JSON errors as `{"error":{"code","message","suggestion"}}` on stderr), `src/logging.rs`. Payload: the `greeting` setting, exactly as go-cli, so the precedence table test has rows. `tests/cli.rs` runs the built binary: help, version, unknown subcommand exits 2, `config show --json` with env and file overrides, invalid config exit code. `clap::Command::debug_assert` test. `docs/` configuration page.
- **Verify:** install (setup), fmt-check (lint), clippy (lint), check (`cargo check --all-targets`, typecheck), test (`cargo test --workspace`), build (`cargo build --release --locked`), smoke (run `target/release/<bin> --help`, `--version`, `--json config show`), deny (check), readme-filled.
- **Agent-ops:** rules file for `**/*.rs`: stdout is for results only (`print_stdout` lint enforces; output goes through `output.rs`), errors return typed variants with a suggestion, never `process::exit` outside `main`, never `#[allow]` (use `#[expect(lint, reason = "...")]`). A short `rust-errors` skill: when to add a variant vs use anyhow context, and the exit-code table.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`, future `cargo-dist`.
- **Gotchas:** clap's `env` feature reads env for flags, but the file layer is the project's own merge; test the precedence explicitly. `--version` must honor `--json` (clap's built-in doesn't), so ship a custom flag like go-cli. `cargo test` doesn't build `--release`; the smoke uses the release build from the build step. `insta` snapshots need `cargo insta` only for review; tests run without it, and `INSTA_UPDATE=no` in CI so a missing snapshot fails.

### 2. `rust-api` (P1): Rust HTTP API (Axum)

- **Id note:** `rust-api` parallels `go-api`, `python-api`, `typescript-api`; the name and description carry "Axum" for search. If the maintainers want room for a second Rust API recipe on another framework, use `axum-api` instead (the 2026-10-29 research used that). I'd take `rust-api`: an Actix recipe would be a variant, not a product.
- **Description (draft):** A Rust JSON API on Axum and Tokio with tower-http request ids, timeouts and tracing, one error envelope from a thiserror enum, graceful shutdown on SIGINT and SIGTERM, and tests in process and against the built binary.
- **Why distinct:** The only server stack in Rust; API-only, no frontend.
- **Evidence:** Server/backend is the top Rust domain (51.7% of organizations, 2025 survey via The New Stack). Axum is the only Rust framework with measurable Stack Overflow 2026 share (3.6%), 149 M recent downloads vs actix-web's 12.9 M, first on lib.rs.
- **Tags:** `rust, api, make`
- **Crates:**
  - runtime: `axum`, `tokio` (macros, rt-multi-thread, net, signal), `tower-http` (trace, request-id, timeout, limit, cors only if asked), `tower`, `serde` (derive), `serde_json`, `thiserror`, `tracing`, `tracing-subscriber` (env-filter, json)
  - dev: `tower` (util, for `oneshot`), `http-body-util`, `reqwest` (json; integration against the binary), `tokio` (test-util)
- **Tools:** cargo, rustup, make, git, curl (none beyond the base set).
- **Proving slice:** `src/main.rs` (config, logging, bind, serve with `with_graceful_shutdown`), `src/app.rs` (router factory taking `AppState`, the one place middleware is layered), `src/config.rs` (HOST/PORT/log level from env with validation; `HOST=127.0.0.1` default), `src/error.rs` (`ApiError` enum, `IntoResponse` through one status table, envelope `{"error":{"code","message"}}`, rejections from extractors mapped too), `src/routes/{health,notes}.rs`, `src/notes.rs` (in-memory store behind a trait, the go-api "notes" payload: create, get, list with cursor). Tests: `tests/http.rs` drives the router in process via `oneshot` (status, envelope, bad JSON, 404 for unknown id, request-id echoed); `tests/binary.rs` builds and spawns the binary on a free port, waits for `/healthz`, sends SIGTERM and asserts clean exit.
- **Verify:** install, fmt-check, clippy, check, test, build (`--release --locked`), deny, serve (`make serve` running the built binary, `expect: http://127.0.0.1:${PORT}/healthz within 60s`), readme-filled. `env: { PORT: "8080" }`.
- **Agent-ops:** rules: handlers return `Result<_, ApiError>`, never `unwrap`; body extractor last; no blocking calls in async (`std::fs`, `std::thread::sleep`, sync DB clients): use tokio equivalents or `spawn_blocking`. Clippy has no lint for this, so the rule matters. An `axum-handlers` skill: extractor order, state, mapping rejections, testing with `oneshot`.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`, `rest-api` (applies by `api` tag); optional `docker-deploy` (after a Rust branch), `rr`, `ce-plugin`, future `sqlx-postgres`. OpenAPI via `utoipa` is a decision (default off); python-api's spec-drift check is the model if it's turned on.
- **Gotchas:** The serve probe races the compile if serve runs `cargo run`; serve must run the binary the build step produced. `tokio::signal::unix` is Unix-only; gate it so `cargo check` on Windows targets still passes if promised. tower-http's `TraceLayer` default spans are noisy; ship the configured `make_span_with`. axum's `Json` rejection returns plain text by default, so the envelope test must cover it. Bind to `127.0.0.1` locally (macOS firewall prompt on `0.0.0.0`).

### 3. `rust-library` (P1): Rust library crate

- **Description (draft):** A Rust library crate for crates.io with a documented public API, thiserror errors, an optional serde feature, doctests and property tests, rustdoc with warnings denied, and a packaging check that builds exactly what would be published.
- **Why distinct:** Different deliverable: no binary, the public API and docs are the product. Matches the deferred `typescript-library`/`python-library` from the expansion plan.
- **Evidence:** Every crate in the table above is one; proptest 68 M, insta 36 M, trybuild 19 M recent downloads show the test tooling libraries use.
- **Tags:** `rust, library, make`
- **Crates:**
  - runtime: `thiserror`; `serde` optional behind a `serde` feature
  - dev: `proptest`, `serde_json` (feature test), `insta` (Debug/Display snapshots, optional)
- **Tools:** cargo, rustup, make, git; `cargo-deny`; optional `cargo-hack` (feature powerset), `cargo-semver-checks` (only after a first release).
- **Proving slice:** `src/lib.rs` with `#![doc = include_str!("../README.md")]` so the README's example is a doctest, a validated newtype (e.g. a `Slug` with `FromStr`, `Display`, `TryFrom<&str>`, `AsRef<str>`) and its `ParseError` enum, a `serde` feature with `#[cfg_attr(feature = "serde", ...)]`, `#![warn(missing_docs)]` via workspace lints, `examples/basic.rs`, `tests/api.rs` (public API only), proptest round-trip (`parse(display(x)) == x`). `Cargo.toml` with description/license/repository/keywords placeholders filled at Setup (`{{author}}` in authors is fine; no version: Setup sets `package.version = "0.1.0"` like tauri-react's note).
- **Verify:** install, fmt-check, clippy (`--all-features`), check-no-default (`cargo check --no-default-features`), test (`cargo test --all-features`, includes doctests), docs (`RUSTDOCFLAGS="-D warnings" cargo doc --no-deps --all-features`, layer `docs`), package (`cargo package --locked --allow-dirty`, layer `build`), deny, readme-filled.
- **Agent-ops:** rules: no `anyhow` in a library; every public item documented with an example; adding a public item or variant is a semver decision (`#[non_exhaustive]` on public enums by default); features are additive. A `release-checklist` doc for the first publish (the CLI never publishes; `cargo publish` is already blocked by agent-ops's destructive-command patterns).
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`, future `release-plz` (crates.io release PRs).
- **Gotchas:** `cargo test --all-targets` skips doctests; use plain `cargo test`. `cargo package` refuses a dirty tree without `--allow-dirty`, and a fresh scaffold has nothing committed. `cargo package` warns, and `cargo publish` fails, without `description` and `license`. `cargo-semver-checks` needs a published baseline, so it's a Deferred step, not a verify step. MSRV: no `rust-version` ships; record it as a decision to revisit (`cargo msrv` later).

### 4. `rust-tui` (P2, first): Ratatui terminal app

- **Description (draft):** A full-screen Rust terminal app on Ratatui and crossterm with an event loop, app state separated from rendering, keybindings in one table, panic-safe terminal restore, and snapshot tests of rendered frames.
- **Why distinct:** Interactive full-screen product with its own architecture (event loop, state machine, draw); a CLI recipe doesn't cover rendering or terminal lifecycle.
- **Evidence:** ratatui 24.7 M recent downloads, 23.1 k stars, very active; crossterm 55.6 M recent. Many recent agent-era tools ship TUIs.
- **Tags:** `rust, cli, tui, make`
- **Crates:**
  - runtime: `ratatui` (with its crossterm backend), `crossterm` (event-stream if async), `color-eyre` (ratatui's own templates use it; or anyhow, decision), `clap` (derive), `thiserror`, `tracing`, `tracing-subscriber`, `tracing-appender` (logs to a file: stderr is the screen)
  - dev: `insta`, `assert_cmd`, `predicates`
- **Tools:** cargo, rustup, make, git.
- **Proving slice:** `src/main.rs` (parse args, refuse with exit 2 and a clear message when stdout is not a terminal, init terminal via `ratatui::init` which installs the restore hook, run, restore), `src/app.rs` (pure `App` state and `fn handle(&mut self, Action)`), `src/keys.rs` (key → `Action` table, shown in a help overlay), `src/ui.rs` (`fn draw(frame, &App)`), `src/event.rs` (tick + input loop). Payload: a two-pane list/detail view over a small in-memory list with filter-as-you-type and a help popup. Tests: state transitions as plain unit tests; `ui` rendered into `TestBackend` at a fixed size and snapshotted with insta (normal, empty list, filtered, help open, narrow terminal); `tests/binary.rs` asserts the non-TTY refusal and `--version`.
- **Verify:** install, fmt-check, clippy, check, test, build, smoke (`--help`, `--version`, non-TTY run exits 2 with its message), deny, readme-filled.
- **Agent-ops:** rules: never print to stdout/stderr while the terminal is in raw mode (logs go to the file); all state changes go through `Action`; every new view gets a TestBackend snapshot. A hook is unnecessary beyond the shared rustfmt one.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`, future `cargo-dist`.
- **Gotchas:** verify and agents run without a TTY, so the app can't be driven live; the snapshot tests are the proof and the non-TTY refusal is the smoke. Snapshots depend on terminal size, so tests fix it. A panic without the restore hook leaves the user's terminal broken. Ratatui still makes breaking 0.x changes; Setup says to adapt shipped code to the installed release without dropping snapshot cases (accepting changed snapshots needs review).

### 5. `rust-python` (P2): Python extension in Rust (PyO3)

- **Description (draft):** A Python package with a Rust core built by PyO3 and maturin, managed with uv: typed stubs, Rust errors raised as Python exceptions, pytest against the built extension, cargo tests for the pure Rust code, and a wheel installed into a clean venv.
- **Why distinct:** Two languages, one artifact (a wheel); the build loop (rebuild extension, then test from Python) is unlike any other stack.
- **Evidence:** pyo3 70.8 M recent downloads, 16.3 k stars; maturin 5.9 k stars and the default build backend for Rust extensions (pydantic-core, polars, many others).
- **Tags:** `rust, python, library, make`
- **Deps:** crates `pyo3` (abi3 feature per decision), `thiserror`; PyPI dev `maturin`, `pytest`, `ruff`, `mypy`. (The format's deps are keyed by ecosystem; tauri-react already mixes npm and crates.)
- **Tools:** cargo, rustup, uv, make, git.
- **Proving slice:** maturin mixed layout: `src/lib.rs` (`#[pymodule]` named `_core`, thin wrappers only), `src/core.rs` (pure Rust logic and its `thiserror` error, no PyO3 types, unit-tested with `cargo test`), `src/py_errors.rs` (one mapping from each error variant to a `create_exception!` Python exception), `python/{{project_slug}}/__init__.py`, `_core.pyi` stubs, `py.typed`, `pyproject.toml` with maturin as build backend (no version pins), `tests/test_core.py`. Payload: one function doing real work in Rust (e.g. tokenize/count over a string or bytes, releasing the GIL with `allow_threads` / `detach`) plus one class, with one error case raised as a typed exception.
- **Verify:** install (`uv sync` builds the extension), fmt-check (rustfmt + `ruff format --check`), clippy, lint-py (`ruff check`), typecheck (`mypy --strict` against the stubs, plus `cargo check`), test-rust, test-py (`pytest` on the freshly rebuilt extension), wheel (`uv build`, then install the wheel into a throwaway venv and import it), deny, readme-filled.
- **Agent-ops:** rules: PyO3 types stay in `lib.rs`/`py_errors.rs`; a stub update accompanies every exported signature change (mypy against stubs is how drift fails); no `unwrap` across the FFI boundary (a panic becomes `PanicException`). A `pyo3-bindings` skill written against the installed PyO3 release (the Bound API and GIL/attach naming have changed across recent releases).
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`. A later `maturin-release` fragment (wheels for macOS/Linux/Windows via maturin's generated GitHub workflow) would be the release piece.
- **Gotchas:** uv caches the built package; after a Rust change `uv sync` may not rebuild, so the test target runs `uv run maturin develop --uv` (or `uv sync --reinstall-package <name>`) first. Historically `cargo test` failed to link with PyO3's `extension-module` feature; read the installed PyO3 docs on how the feature is set now (newer releases moved this to a maturin-set env var) and keep pure-Rust tests in a module that doesn't need libpython. abi3 vs per-version wheels is a decision (default abi3 with the oldest supported CPython, recorded at Setup, no literal shipped). The Python version decision mirrors python-api's.

### 6. `rust-wasm` (P2): Rust WebAssembly package for JS

- **Description (draft):** A Rust library compiled to WebAssembly with wasm-bindgen and wasm-pack, published as an npm package with generated TypeScript types, tested in Rust with wasm-bindgen-test and from a TypeScript consumer.
- **Why distinct:** The artifact is an npm package; the hard part is the JS boundary (types, errors, memory), which nothing else covers.
- **Evidence:** 23% of 2024 State of Rust respondents target wasm in the browser; wasm-bindgen 165 M recent downloads (largely transitive), wasm-bindgen-test 10.6 M, wasm-pack 1.1 M recent and 7.3 k stars.
- **Tags:** `rust, wasm, library, make, bun, node`
- **Deps:** crates `wasm-bindgen`, `js-sys`, `serde` (derive), `serde-wasm-bindgen`, `thiserror`, `console_error_panic_hook` (feature-gated); dev `wasm-bindgen-test`; npm dev `typescript`, `vitest` (consumer test; or `bun test`, decision).
- **Tools:** cargo, rustup (with `wasm32-unknown-unknown` in rust-toolchain.toml), wasm-pack, bun, node, make, git.
- **Proving slice:** `src/lib.rs` exporting one function that takes a JS object (deserialized with serde-wasm-bindgen) and returns a result, failing with a `JsError` carrying a stable code; one exported struct with a method to prove class bindings and `free()`; pure logic in `src/core.rs` tested with native `cargo test`; `tests/web.rs` with wasm-bindgen-test under Node; `consumer/` a tiny TS package importing `../pkg`, typechecked by tsc against the generated `.d.ts` and tested (happy path, error code, object freed).
- **Verify:** install, fmt-check, clippy (native and `--target wasm32-unknown-unknown`), test-native, test-wasm (`wasm-pack test --node`), build (`wasm-pack build --release --target bundler` or `web`, decision), typecheck-consumer, test-consumer, deny, readme-filled.
- **Agent-ops:** rules: exported API lives in `lib.rs` only; errors cross as `JsError` with a code, never panics; no `std::time::Instant`/threads/filesystem in wasm code paths; every export change re-runs the consumer typecheck.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`; `claude-harness` becomes eligible by the `bun`/`node` tags, which is acceptable as optional but should not be default.
- **Gotchas:** wasm-pack downloads wasm-bindgen CLI and binaryen (wasm-opt) at build time (network, no credentials). wasm-opt has rejected newer default wasm features (bulk memory, reference types) emitted by recent rustc; the fix is wasm-opt flags in `[package.metadata.wasm-pack]`, not disabling optimization silently. wasm-pack's maintenance gap after the rustwasm sunset is a risk; the fallback is `cargo build --target wasm32-unknown-unknown` + `wasm-bindgen-cli`, whose version must exactly match the `wasm-bindgen` crate in Cargo.lock (Setup must say so). clippy must run for both native and wasm targets.

### 7. `leptos` (P2): Leptos full-stack web app

- **Id note:** framework name alone, like `nextjs` and `sveltekit`.
- **Description (draft):** A full-stack Rust web app on Leptos with server rendering and hydration on Axum, server functions, typed errors shown in the UI, cargo-leptos builds, and a Playwright test against the production server.
- **Why distinct:** The only Rust stack where the frontend is Rust too; one language across server and browser.
- **Evidence:** leptos 1.58 M recent downloads (more than dioxus's 1.31 M), 21.5 k stars, the only Rust UI framework appearing in Stack Overflow 2026 (0.2%). Small in absolute terms; it's the long-tail stack of this set.
- **Tags:** `rust, web, fullstack, wasm, make, bun, node`
- **Deps:** crates `leptos`, `leptos_router`, `leptos_meta`, `leptos_axum` (ssr), `axum` (ssr), `tokio` (ssr), `wasm-bindgen` (hydrate), `console_error_panic_hook` (hydrate), `serde`, `thiserror`, `tracing`, `tracing-subscriber`; npm dev `@playwright/test`, `typescript`.
- **Tools:** cargo, rustup (wasm32 target), cargo-leptos, bun, node, make, git.
- **Proving slice:** cargo-leptos workspace metadata, `src/main.rs` (ssr server with `/healthz`), `src/app.rs` (router, one page), `src/notes.rs` (a server function listing/adding notes in an in-memory store, error enum serialized to the client and shown inline), `end2end/` Playwright test (page renders server-side, form submit via server function, error shown). Rust unit tests for the store and server functions under `ssr`.
- **Verify:** install, fmt-check (`cargo fmt` + `leptosfmt --check` if the decision picks it), clippy-ssr, clippy-hydrate (separate feature sets), test, build (`cargo leptos build --release`, timeout 15m), e2e, serve (built server binary with `LEPTOS_SITE_ADDR` on PORT_WEB, probe `/healthz` within 60s), readme-filled.
- **Agent-ops:** rules: server-only code behind `#[cfg(feature = "ssr")]`; check both feature sets after every change; don't call server-only crates from components. A `leptos` skill written from the installed release (Leptos's API changed substantially between 0.6, 0.7 and 0.8).
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `docker-deploy` (Rust branch plus site dir), `rr`, `ce-plugin`.
- **Gotchas:** first build compiles two targets and takes several minutes; verify timeouts must allow it and the sandbox target (under 20 minutes) is at risk. cargo-leptos installs slowly from source; prefer cargo-binstall. Feature-unified `cargo clippy --all-features` is wrong here (ssr and hydrate are exclusive in practice). Tailwind is a decision, default plain CSS, to avoid a third toolchain.

### 8. `rust-grpc` (P2, last): Rust gRPC service (tonic)

- **Description (draft):** A Rust gRPC service on tonic with protobuf contracts compiled at build time, health and reflection services, status codes mapped from one error enum, graceful shutdown, and tests through a generated client.
- **Why distinct:** Contract-first RPC with code generation and HTTP/2; the API recipe doesn't cover protobuf, codegen or gRPC status semantics.
- **Evidence:** tonic 106 M recent downloads (inflated by OpenTelemetry exporters pulling it transitively), prost 163 M, tonic-health 15 M, 12.5 k stars. Distributed systems at about 22% of organizations in the 2025 survey.
- **Tags:** `rust, api, grpc, make`. Note: the `api` tag pulls in `rest-api` by `applies_to: [api]`, which is wrong for gRPC. Either tag it `rpc` instead of `api` (then the anatomy's serve-step requirement for `api` doesn't bind, though the stack ships one anyway), or narrow `rest-api`'s `applies_to`. Prefer not tagging `api`.
- **Crates:**
  - runtime: `tonic`, `tonic-prost`, `prost`, `tonic-health`, `tonic-reflection`, `tokio` (macros, rt-multi-thread, signal), `axum` (HTTP health route), `thiserror`, `tracing`, `tracing-subscriber`
  - build: `tonic-prost-build`, `protox` (pure-Rust protobuf compiler, so no `protoc` on PATH)
  - dev: `tokio-stream` (in-process server over a TCP listener on port 0)
- **Tools:** cargo, rustup, make, git; optional `buf` for proto lint and breaking-change checks; optional `grpcurl` for manual smoke.
- **Proving slice:** `proto/{{project_slug}}/v1/notes.proto`, `build.rs` compiling via protox into tonic-prost-build, `src/service.rs` (the notes service: unary create/get and one server-streaming list), `src/error.rs` (enum → `tonic::Status` codes in one table), `src/main.rs` (health + reflection + service, `/healthz` over HTTP/1 on the same or a second port, graceful shutdown). Tests drive the generated client against an in-process server: success, `NOT_FOUND`, `INVALID_ARGUMENT`, stream ends.
- **Verify:** install, fmt-check, clippy, check, test, build, deny, serve (HTTP `/healthz` probe), readme-filled; optional `buf lint` step only if buf is a declared tool.
- **Agent-ops:** rules: never edit generated code; field numbers are permanent (reserve removed ones); errors leave only as `Status` from the one table. A hook denying writes under the generated output dir.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `docker-deploy`, `rr`, `ce-plugin`.
- **Gotchas:** verify's serve probe is HTTP only (`Expect.http` in `packages/format/src/entry.ts`) and tonic speaks HTTP/2, so the service must expose an HTTP/1 `/healthz` (tonic routes converted into an axum router with `accept_http1`, or a second listener). tonic-build's default path needs a system `protoc`; protox avoids the tool. tonic is mid-reorganization (repo moved to grpc/grpc-rust, master preparing breaking changes), so Setup must read the installed release's codegen API.

## Rejected and deferred candidates

| Candidate | Decision | Why |
| --- | --- | --- |
| Actix Web API | Rejected (variant) | Same product as `rust-api`; axum has about 11x the recent downloads and the only Stack Overflow share. A framework decision inside rust-api is enough if anyone asks |
| Rocket, Poem, Loco | Rejected | Variants of rust-api with much smaller usage (2.3 M, 0.9 M, 0.14 M recent) |
| Dioxus full-stack | Rejected for now | Overlaps `leptos` as "full-stack Rust web"; more stars (39.6 k) but fewer downloads, and its `dx` CLI plus multi-platform targets make verify heavier. If the maintainers prefer Dioxus, swap it in for leptos rather than shipping both |
| Cloudflare Workers (workers-rs) | Deferred (P3) | Locally verifiable with `wrangler dev`, but small (2.1 M recent, 3.8 k stars), still breaking often, and it overlaps rust-wasm plus rust-api. Revisit as a fragment or stack after rust-wasm proves the wasm toolchain |
| Bevy game | Rejected | Verify can't prove a game: rendering needs a window/GPU; headless ECS tests prove little. Clean builds take many minutes and gigabytes, at odds with the 20-minute sandbox target |
| Embedded `no_std` (embassy, probe-rs) | Rejected | Needs real boards; QEMU-only projects aren't what people ask for |
| egui / iced desktop | Rejected | Overlaps `tauri-react` (desktop); GUI can't be driven in verify |
| napi-rs Node addon | Deferred (P3) | Real (16 M recent) and the npm twin of rust-python; build after rust-python proves the two-language pattern, since its prebuilt-binary matrix is the hard part |
| UniFFI mobile bindings | Rejected | Needs Xcode/Android SDK toolchains beyond the installed set |
| Rust + sqlx API | Not a stack | A fragment on rust-api (below), like `postgres` on python-api |

## Fragment work

Existing fragments and their fit:

| Fragment | Fits | Change needed |
| --- | --- | --- |
| `agent-ops` (applies to all) | all | `format-changed.sh` and `lint-on-write.sh` handle `*.py`, JS/TS and `*.go` only. Add `*.rs`: format with `rustfmt` reading the project's `rustfmt.toml` (edition must be there), lint-on-write skipped or a `cargo check --message-format short` with a timeout (clippy per write is too slow). `_destructive-patterns.sh` already blocks `cargo publish` |
| `git-hooks` (all) | all | Prose is generic; pre-commit runs `cargo fmt` on staged `.rs`, clippy goes to the project's lint target (whole-crate tool, like golangci-lint) |
| `ci-github` (all) | all | Add a `tag=rust` branch: toolchain from `rust-toolchain.toml`, a Cargo cache action, cargo subcommands from a prebuilt-binary installer action; macOS runner only where needed |
| `rest-api` (`api` tag) | rust-api | None; keep rust-grpc off the `api` tag |
| `docker-deploy` | rust-api, rust-grpc, leptos | Add to `applies_to` and add a `tag=rust` branch: multi-stage build in the official Rust image (dependency layer caching via a cached `cargo fetch` or cargo-chef), distroless `cc` runtime, nonroot; health check needs a binary-native probe (a `--healthcheck` flag), since distroless has no curl |
| `rr`, `ce-plugin` | all | None |
| `claude-harness` | none by default | Bun TypeScript hooks; only eligible on rust-wasm/leptos through their `bun`/`node` tags. Keep it optional there |

New fragments worth adding later:

- **`cargo-dist`** (release, like `goreleaser`): applies to rust-cli and rust-tui. Tag-triggered GitHub release with cross-platform archives, checksums, shell/PowerShell installers, optional Homebrew tap, via dist's generated workflow (axodotdev/cargo-dist, 2.1 k stars, active). Verify step: `dist plan` (no credentials). Note the product is now branded "dist"; `cargo-dist` is the clearer id.
- **`release-plz`** (crates.io release PRs) for rust-library: changelog and version bump PRs, publish from CI with a token the user adds (Pending user action). 1.5 k stars.
- **`sqlx-postgres`** for rust-api: Docker Compose Postgres, `sqlx migrate`, a repository behind the store trait, `#[sqlx::test]` per-test databases, and the offline query cache (`cargo sqlx prepare --check`) so builds don't need a live DB. sqlx 53 M recent downloads.
- **Shared Rust guidance**: the clippy/error/unsafe/async rules repeat across all eight stacks. Two options: (a) each stack ships its own short `.claude/rules/rust.md` (simple, duplicated, drifts per stack), or (b) one `rust` guidance fragment required by every Rust stack, the way `effect` serves the Effect stacks. (b) saves brief words and keeps one source; its cost is a cross-stack fragment that must stay neutral about app vs library. I'd do (b) after rust-cli and rust-api ship, once the shared rules are proven rather than guessed.

## Gotchas common to all Rust stacks

- **Compile time and the sandbox target.** A fresh axum + tokio + tracing project compiles in about a minute on Apple Silicon, but clippy, `cargo build`, `cargo test` and `--release` don't share artifacts, so verify compiles the dependency graph three or four times. Keep release builds to the steps that need them; consider `[profile.dev] debug = "line-tables-only"` to cut size. Leptos and PyO3 add a second target or build system on top.
- **Disk.** `target/` reaches gigabytes quickly; worktrees each get their own unless `CARGO_TARGET_DIR` is shared (document it in AGENTS.md; don't set it in shipped config). `make clean` runs `cargo clean`.
- **Cargo.lock.** Commit it for binaries and, per current Cargo guidance, for libraries too; verify uses `--locked` after install so the lockfile is the record.
- **No versions anywhere.** No `rust-version`, no `[dependencies]` in shipped manifests, no tool versions in the Makefile. `edition = "2024"` is a language edition, already shipped by tauri-react.
- **Features are part of the dependency line.** `cargo add tokio` without features compiles but `#[tokio::main]` fails; each Setup lists features per crate as tauri-react does.
- **Network at verify time.** `cargo deny` fetches the advisory DB and wasm-pack downloads binaries; both need network but no credentials.
- **Registry bookkeeping.** Each new crate needs a dependency card in `packages/cli/registry/deps/crates.json` and an allowlist line in `packages/cli/registry/allowlist.json` (`scripts/index/allowlist.ts` fails the index build otherwise), plus a search card per stack under `registry/search/stacks/`. Rough new-crate count: rust-cli about 10, rust-api about 8, others smaller once shared.
