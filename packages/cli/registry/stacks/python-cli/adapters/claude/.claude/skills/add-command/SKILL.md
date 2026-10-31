---
name: add-command
description: Add a command or command group to this Typer CLI with its settings, errors, output and tests. Use when the user asks for a new subcommand, option or setting.
---

# Add a command

`config show` in `src/<package>/cli.py` is the model. Read it and `docs/ARCHITECTURE.md` first.

1. Put the work in a domain module under `src/<package>/` that returns plain data and raises `CliError`. It never imports Typer.
2. In `cli.py`, add the function with `@app.command("<name>")`, or create a group with `typer.Typer(no_args_is_help=False)` and `app.add_typer(...)` as `config_app` does. Declare arguments and options with `Annotated[..., typer.Argument(...)]` or `typer.Option(...)`; options that apply to every command belong on the root callback.
3. Begin with `settings = start(ctx)`, call the domain module, and finish with `render(output_options(settings), data, human_text)`. `data` must be JSON-serializable.
4. A new failure mode gets a `CliError` with a suggestion. A new error code also needs an `EXIT_CODES` row and a line in `docs/configuration.md`.
5. A new setting goes on `Settings` with a default and a validator, with a precedence case in `tests/test_config.py` and a row in `docs/configuration.md`.
6. Tests: unit tests for the domain module, `tests/test_cli.py` cases for text, `--json` and each error path, and a `tests/integration/` case when the command adds an exit path.
7. Run `make lint typecheck coverage smoke`, then add the command to the README's Usage section.
