# Architecture

`src/main.rs` captures the process (arguments, environment, working directory, whether stdin and stdout are terminals) and calls `run::run`, which returns the exit status. Nothing below `main` reads global state, so tests call `run::run` with buffers.

`run::run` parses flags (`cli.rs`), loads the typed `Config` (`config.rs`), starts logging (`logging.rs`) and loads the tasks (`tasks.rs`). Then it picks a front end: the full-screen UI (`tui.rs`) when the config allows it and both stdin and stdout are terminals, otherwise the printed list (`output.rs`). A failure from any step is reported once by `Output::error` and mapped to its exit status.

| Module | Owns |
| --- | --- |
| `cli.rs` | Flags: `--tasks`, `--log-file`, `--no-tui`, `--json`, `--version` |
| `config.rs` | `Config`, its defaults, the environment and flag layers, `validate`, and `Env` |
| `error.rs` | `AppError`: every failure with its code, suggestion and exit status |
| `logging.rs` | The tracing subscriber: JSON lines to the log file or nowhere, `RUST_LOG` validated |
| `output.rs` | Printed results (text table or one JSON document) and error reports |
| `tasks.rs` | The payload: `Task`, the sample, the file loader and its validation |
| `app.rs` | `App`, the UI state, and `update(Action)`, the only way it changes |
| `keys.rs` | `BINDINGS`: every key per mode with its action and help text; `action` maps a key event |
| `ui.rs` | `draw(frame, &App)`, one function per screen, and `Theme` |
| `tui.rs` | Terminal setup and restore, and the event loop: draw, read an event, apply its action |

## The UI loop

```text
tui::run ── ratatui::try_init (raw mode, alternate screen, panic hook)
   │
   └─ event_loop: draw(&App) ─▶ read event ─▶ keys::action ─▶ App::update ─┐
         ▲                                                                 │
         └─────────────────────────── until App::should_quit ──────────────┘
   │
   └─ ratatui::try_restore (on success and on error; the panic hook covers panics)
```

Modes: `List` (browse), `Filter` (typing into the filter), `Detail` (one task), `Help` (an overlay on the screen it was opened from).

## Exit status

| Status | Meaning | Codes |
| --- | --- | --- |
| 0 | Success, including `--help`, `--version` and quitting the UI | |
| 1 | Runtime failure | `IO`, `INVALID_DATA`, `TERMINAL` |
| 2 | Invalid invocation | `USAGE` |
| 3 | Invalid configuration | `INVALID_SETTING`, `LOG_FILE` |
