# Frontend source

Start with [main.tsx](main.tsx): it selects a transport and mounts the React
providers and memory router. [app/](app/) owns the window UI, queries and subscription
lifecycle. [core/](core/) defines the transport contract, browser fixtures and tick
store without React.

Only the transport boundary calls Tauri commands. The UI consumes the same interface
in desktop and browser runs, while Rust owns native commands and stream cancellation
in [../src-tauri/src/](../src-tauri/src/).

Unit tests sit beside source. Shared rendering support and browser end-to-end tests
live in [../tests/](../tests/).
