# Architecture

The console script in `pyproject.toml` calls `cli.main`, which calls `cli.run`
and exits with its status. `run` is the one place failures become exit codes:
it calls the Typer app with `standalone_mode=False`, so Typer raises instead of
printing its own errors, and maps every exception through the error table.
Tests call `run` directly.

| Module | Owns |
|---|---|
| `cli.py` | The Typer app, root options, commands, `run` and `main` |
| `config.py` | `Settings` (pydantic-settings), the config file path, `load_settings` |
| `errors.py` | `ErrorCode`, `EXIT_CODES`, `CliError` |
| `output.py` | `render` (stdout) and `render_error` (stderr), text or JSON |
| `log.py` | structlog configured to stderr |
| `__main__.py` | `python -m <package>` |

The root callback turns explicit flags into setting overrides and stores them
on the Typer context. Each command calls `start(ctx)`, which loads settings
through every layer and configures logging, then passes typed values on.
Commands return results through `output.render`; they never print.

Domain code goes in its own modules and never imports Typer, so it can be
tested without the command tree.

Tests live in `tests/`, one file per module. `tests/test_cli.py` runs the real
command tree in process and reads stdout and stderr separately.
`tests/integration/` runs the installed console script in a subprocess.
`make smoke` builds the wheel, installs it in a throwaway environment and runs
it, which catches a missing entry point or a module left out of the wheel.
