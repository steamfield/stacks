---
paths:
  - "**/*.rs"
  - "Cargo.toml"
  - "clippy.toml"
  - "deny.toml"
  - "consumer/**"
  - "README.md"
---

Read [Rust and WebAssembly guidance](../../docs/guidance/rust-wasm.md) before changing Rust code, crate config or `consumer/`, and [the JavaScript API](../../docs/js-api.md) before adding, changing or removing anything the package exports or any error code. They are the shared guidance for every agent; this rule only points at them. Every export change ends with `make test-wasm test-js`, which rebuilds `pkg/` and typechecks `consumer/` against the new `.d.ts`; the `add-export` skill walks through one.
