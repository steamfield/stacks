---
name: add-export
description: Export a new function, class, method or option from this Rust WebAssembly package to JavaScript, with its TypeScript types, error codes and native, wasm and consumer tests. Use when the user asks the package to expose something new to JavaScript or change an existing export.
---

# Add an export

`slugInfo` is the worked example: the logic in `src/slug.rs` (`describe`, with native tests), the export and its doc comment in `src/lib.rs`, its `SlugInfo` shape in the `TYPES` section, its wasm case in `src/web_tests.rs`, its consumer test in `consumer/test/package.test.ts`, and its row in `docs/js-api.md`. Follow the same path.

1. **Decide.** Read `docs/js-api.md`. Name the semver effect (adding is minor; changing or removing is breaking) and tell the user before writing a breaking change.
2. **Logic.** Write it in plain Rust in the module it belongs to, `pub(crate)`, returning `Result<_, Error>`. A new failure is a variant in `src/error.rs` with a new `code()`. Unit tests go beside it; run `cargo test <name>`.
3. **Export.** In `src/lib.rs` only: a `#[wasm_bindgen]` function (camelCase it with `js_name`) or method that decodes options through `js::settings`, calls the logic and returns with `?`. A new options key goes in `Options`, `Options::KEYS` and `SlugOptions` together. A plain-object result gets a `serde::Serialize` struct, an interface in `TYPES`, an `extern "C"` type named with `typescript_type`, and `js::to_js`. A class documents `free()` and `using`.
4. **Document.** A doc comment for JavaScript callers with an `# Errors` section naming the codes it throws; it lands in `pkg/*.d.ts`. A new code also goes in `SlugErrorCode`, the README's error table and `docs/js-api.md`.
5. **Test.** A wasm case in `src/web_tests.rs` with JavaScript values in and each code out, and a case in `consumer/test/package.test.ts` importing it by package name.
6. Run `make lint test test-wasm test-js`, then read the diff of `pkg/*.d.ts`.
