---
name: add-public-item
description: Add a public type, function, method, error variant or feature to this Rust library with its docs, doctest, tests and API notes. Use when the user asks the crate to expose something new or change what it exports.
---

# Add a public item

`Rules::with_max_len` is the worked example: the method and its doctest in `src/rules.rs`, the `Error::ZeroMaxLen` variant in `src/error.rs`, its cases in `tests/api.rs`, and its row in `docs/public-api.md`. Follow the same path.

1. **Decide.** Read `docs/public-api.md`. Name the semver effect (adding is minor; changing or removing is breaking) and tell the user before writing a breaking change.
2. **Write.** Put the item in the module it belongs to, `pub` there, and re-export it from `src/lib.rs` if it's new at the top level. Prefer private fields with constructors and accessors, `#[non_exhaustive]` on enums, `#[must_use]` on pure functions (clippy asks).
3. **Fail.** A new failure is a documented `Error` variant in `src/error.rs` with fields a caller can match on and a lowercase message naming the input. List it under the function's `# Errors`.
4. **Document.** A doc comment with a first line saying what it is, `# Errors` when fallible, and an example that uses the crate root path and asserts the result.
5. **Feature.** An item that needs an optional dependency goes behind a feature (`#[cfg(feature = "...")]`), added with `cargo add <crate> --optional`; the feature only adds. Add its row to the features table in `docs/public-api.md` and the README.
6. **Test.** Unit tests beside the code for each rule; a case in `tests/api.rs` through the crate root; a property in `tests/properties.rs` for a parser or conversion.
7. Add the row to `docs/public-api.md`, then run `make lint test doc package`.
