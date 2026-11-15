# Desktop shell

Start with [lib.rs](lib.rs): it configures tracing, registers commands through
`specta_builder()` and cancels window streams on page replacement or destruction.
[main.rs](main.rs) starts that shell.

[commands.rs](commands.rs) adapts domain metadata from the core crate and sends
ticks over a Tauri channel. [streams.rs](streams.rs) tracks per-window cancellation;
[error.rs](error.rs) maps core and stream failures into the typed IPC error.
Tests beside these modules cover command export and stream lifetime.

The frontend reaches these commands through its transport boundary.
[../examples/export_bindings.rs](../examples/export_bindings.rs) uses the same command
builder to generate TypeScript bindings.
