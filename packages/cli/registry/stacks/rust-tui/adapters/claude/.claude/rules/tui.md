---
paths:
  - "src/app.rs"
  - "src/keys.rs"
  - "src/ui.rs"
  - "src/tui.rs"
  - "src/snapshots/**"
---

# Terminal UI rules

- State changes only in `App::update(Action)`. A new behavior is a new `Action` variant, handled there and tested by sending it.
- `ui::draw` reads `&App` and renders: no I/O, no state changes. Styles come from `Theme` in `ui.rs`; no colors inline.
- Every key is a row in `keys::BINDINGS` with its modes, label and help text, so it shows in the footer and the help overlay. While filtering, characters go to the filter; only ctrl+c quits.
- Only `tui::run` touches the real terminal, and it restores it on every path. Don't call `enable_raw_mode` or `execute!` elsewhere.
- Never log or print while the UI runs; use `tracing` (it writes to `--log-file` or nowhere).
- Import crossterm as `ratatui::crossterm`, never as a separate crate.
- A new screen or visible state gets a snapshot in `ui.rs`'s tests. Accept snapshot changes only with `make snapshots`, then read the diff with the user. The `add-screen` skill has the steps.
- Never run the binary under `script`, `unbuffer`, `tmux` or `screen`. Prove behavior with `make test`, or `--no-tui` and `--json`; ask the user to try the UI in their terminal.
