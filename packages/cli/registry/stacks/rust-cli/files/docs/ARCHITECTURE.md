# Architecture

`src/main.rs` captures the process (arguments, environment, working directory, whether stderr is a terminal) and calls `app::run`, which returns the exit status. Nothing below `main` reads global state, so tests call `app::run` with buffers.

`app::run` parses the command line (`src/cli.rs`, clap derive), loads the typed `Config` (`src/config.rs`), starts logging for this invocation (`src/logging.rs`), and dispatches to a command under `src/commands/`. A failure from any step is reported once by `Output::error` and mapped to its exit status.

| Module | Owns |
| --- | --- |
| `cli.rs` | Flags and subcommands. Global flags: `--config`, `--json`, `-v/--verbose`, `--no-color`; the root's own `--version` |
| `config.rs` | `Config`, its defaults, the file, environment and flag layers, `validate`, and `Env` |
| `error.rs` | `AppError`: every failure with its code, suggestion and exit status |
| `output.rs` | Every write to stdout and stderr: results as text or one JSON document, errors as text or a JSON envelope |
| `logging.rs` | The tracing subscriber: stderr, `RUST_LOG` or the verbose level, JSON records under `--json` |
| `commands/` | One module per command; `config show` is the first |

## Exit status

| Status | Meaning | Codes |
| --- | --- | --- |
| 0 | Success, including `--help` and `--version` | |
| 1 | Runtime failure | `IO` |
| 2 | Invalid invocation: unknown command or flag, missing subcommand | `USAGE` |
| 3 | Invalid configuration: file missing, unreadable or malformed, bad setting value, bad `RUST_LOG` | `CONFIG_NOT_FOUND`, `CONFIG`, `INVALID_SETTING` |

`--help` and `--version` never read config files, so they work while a config file is broken. Before config is loaded, only an explicit `--json` on the command line selects JSON output.
