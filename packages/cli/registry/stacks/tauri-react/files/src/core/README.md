# Frontend transport boundary

Start with [transport.ts](transport.ts), the contract for metadata and tick
subscriptions. [app-transport.ts](app-transport.ts) selects
[transport/native.ts](transport/native.ts) inside Tauri or
[mock-transport.ts](mock-transport.ts) for browser development and tests.

The native adapter wraps generated commands and a window-owned channel. The mock
offers failure scenarios and explicit tick delivery. [tick-store.ts](tick-store.ts)
creates a vanilla zustand store; React subscriptions belong in [../app/](../app/).

[generated/bindings.ts](generated/bindings.ts) comes from the Rust exporter.
Import its data types where needed; command calls stay behind the transport.
