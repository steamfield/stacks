# Rust

How Rust code in this crate is written. The shipped code follows every rule here; keep to them when extending it. [The public API policy](../public-api.md) covers what the crate exports and how that may change.

## Crate layout

- One package at the repository root, inside a workspace (`[package]` and `[workspace]` in the same `Cargo.toml`). `src/lib.rs` declares private modules and re-exports the public items from the crate root; callers never write a module path. A second crate goes under `crates/<name>/` with `edition.workspace = true` and `[lints] workspace = true`, and joins `members`.
- Dependencies are added with `cargo add <crate> --features <list>`, never by editing version strings by hand. An optional dependency (`cargo add serde --optional`) gets its feature from `cargo add`. `Cargo.lock` is committed and only cargo writes it; checks run with `--locked`.
- `include` in `Cargo.toml` lists every path that goes into the published `.crate`. A new file the library needs at compile time (an `include_str!` target, a data file) is added there; `make package` fails when one is missing.
- `rust-toolchain.toml` selects the toolchain. Record the installed stable release there (`channel = "<version>"`) so CI and every machine build with the same compiler.

## Lints

`[workspace.lints]` in `Cargo.toml` is the lint policy: `missing_docs`, `unreachable_pub` and rustdoc's broken links denied, clippy's default set denied, `pedantic` warned (and denied by `-D warnings`), plus `unwrap_used`, `expect_used`, `panic`, `todo`, `dbg_macro`, `print_stdout` and `print_stderr` denied. `clippy.toml` allows unwrap, expect and panic inside `#[test]` functions and `#[cfg(test)]` modules only.

- Fix a lint rather than silencing it. When a lint is wrong for one item, use `#[expect(clippy::<lint>, reason = "why")]` on that item: `allow_attributes` denies `#[allow]`, and an `expect` fails once it stops being needed.
- `unsafe` is forbidden. Lifting that is a decision for the user, not a fix.
- Keep the policy when adapting it to a newer clippy; a renamed lint gets its new name.

## Docs

- Every public item has a doc comment whose first line says what it is, and a code example that runs as a doctest. Fallible functions have an `# Errors` section naming the variants they return; a function that can panic has `# Panics` (better: return an error).
- Examples use the crate the way a dependent does (`use crate_name::...`) and end in assertions, so a doctest fails when behavior changes. Use `?` with a trailing `# Ok::<(), crate_name::Error>(())` line rather than `unwrap`.
- `README.md` is the crate root's documentation (`#![doc = include_str!("../README.md")]`), so its `rust` blocks are doctests too. Non-Rust blocks need a language tag (`bash`, `toml`) or rustdoc runs them.
- Link items with intra-doc links (`` [`Rules::parse`] ``); `make doc` fails on a broken one.

## Errors

- One `thiserror` enum (`src/error.rs`) is the error type of every public function. It is `#[non_exhaustive]`, each variant is documented, and variant fields carry what a caller needs to react (the offending value, its position), not a preformatted string.
- Messages are lowercase, without trailing punctuation, and name the input that failed. A wrapped error goes in a `#[source]` field, so the message doesn't repeat it.
- No `anyhow`, `Box<dyn Error>` or `String` errors in the public API. No `unwrap`, `expect` or `panic!` outside tests; the library never prints, logs to stdout or exits the process.

## Testing

- Unit tests sit in `#[cfg(test)] mod tests` beside the code and may use private items.
- `tests/api.rs` uses only what the crate root exports, as a dependent would. Each public item gets a case there; a feature's cases sit behind `#[cfg(feature = "...")]`.
- `tests/properties.rs` holds proptest properties: round trips (`parse(display(x)) == x`) and invariants that must hold for any input. Add one for each new parser or conversion.
- Helpers in `tests/*.rs` return `Result`, because clippy's unwrap allowance covers `#[test]` functions but not helper functions there.
- Iterate with `cargo test <name>` or `cargo test --doc`; never `cargo test --all-targets`, which skips doctests. Run `make lint test doc` before finishing.
