# IPC, bindings, and the transport

## Rust owns the types and the meaning

Rust types are the single source of truth for everything that crosses the bridge. Commands and events derive `specta::Type` and register with the one tauri-specta builder in the shell's lib; `src/core/generated/` is its output.

- Never hand-edit `src/core/generated/` and never hand-write a TypeScript type that mirrors a Rust type "until the bindings catch up". Change the Rust side and run `make bindings`.
- Fresh bindings are not the check. After regenerating, run `make typecheck` and the frontend tests: the mock's fixtures are typed with the generated types, so a breaking change surfaces there.
- A bindings diff when no Rust command, event, or type changed means the generator version or config moved. Find out why before committing it.
- Facts every consumer must agree on (units, what a value means, whether data is missing) are decided in Rust and published through a command, event, or channel. The client does view-dependent shaping only: layout, formatting, downsampling to a chart's width. If the client needs a fact Rust doesn't publish, add it in Rust instead of inferring it in TypeScript.

## Errors

Commands return `Result<T, CommandError>`; `CommandError` is a specta-typed enum tagged by `kind`. The frontend branches on `status` for expected failures and maps known `kind`s to UI states in `src/core/`. A rejected command promise is a transport failure: handle it at the workflow boundary and settle loading state, never turn it into an empty success. Missing data is not zero: render "not available" or a gap.

## The transport is the seam

`src/core/transport.ts` is the contract. Only `src/core/transport/**` and `src/core/app-transport.ts` touch `@tauri-apps/*` or the generated `commands`/`events`, and the app layer never imports the native adapter directly; keep Biome's `noRestrictedImports` overrides for these boundaries. Adding a command or channel means: Rust command plus registration, `make bindings`, a method on the contract, the native implementation, and the mock implementation, in the same change. If the mock drifts from the real app, every browser, Vitest, and Playwright run tests the wrong thing.

The TypeScript exporter refuses 64-bit integers by default. Use `u32` where it fits; otherwise override the field's exported type to `number` and document the 2^53 bound on the field, rather than adding BigInt handling.
