# Architecture

`main.go` owns signals and the exit status: it calls `app.Main` and passes its
result to `os.Exit`. Version, commit and date are set by ldflags.

`internal/app` is the only package that sees the process. `Run` loads config,
answers `--help` and `--version`, opens the logger, then picks a front end. The
full-screen UI starts only when neither `--no-tui` nor `--json` is set and both
stdin and stdout are terminals. Everything else prints through
`internal/output` and exits. `Main` reports any error on stderr (text, or JSON
under `--json`) and maps it to an exit status through `internal/errors`.

The terminal check comes first because Bubble Tea, given a stdin that isn't a
terminal, opens `/dev/tty` and takes over the controlling terminal. Behind a
pipe or in an agent's shell that hangs the caller.

| Package | Owns |
|---|---|
| `internal/config` | Flags over `<PREFIX>_*` environment variables over defaults, validation, `--help` text |
| `internal/errors` | Error codes, suggestions and the one `ExitCode` table (usage 2, interrupted 130, other failures 1) |
| `internal/log` | JSON slog to a file, or discarded. Never stdout or stderr: the UI owns the terminal |
| `internal/tasks` | The payload's domain: `Task`, `Load` (file or sample), `Validate`. No UI imports |
| `internal/output` | Text table, JSON documents and the error envelope for non-interactive runs |
| `internal/theme` | Every Lip Gloss style, for a dark or light background |
| `internal/ui` | The Bubble Tea model: screens, keys, help and views |

## The UI

`ui.Model` is one root model with a `screen` field (loading, browsing, detail,
failed). `Init` returns a command that calls the injected `LoadFunc` and
delivers a `loadedMsg`; `Update` never does I/O. Bubbles' `list` gives the
browse screen its movement, filtering, status bar and help. The model's own
bindings (open, back, quit) live in `keys.go` and are added to the list's help.
Bubble Tea sends a `BackgroundColorMsg` at start, which switches the theme
between dark and light styles.

When the program ends, `app` reads `Model.Err()` so a load failure the user
saw on screen still exits 1.

## Tests

Unit tests sit beside the code. `internal/ui` drives `Update` with key and
window messages and compares `View()` output for each screen with golden files
in `testdata/` at a fixed 60x16 size. `program_test.go` runs the real program
headless through teatest. `tests/integration` builds the binary with `-race`
and runs it with stdin from `/dev/null`, checking flags, text, JSON, exit codes
and the log file.
