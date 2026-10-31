---
paths:
  - "src/**"
  - "tests/**"
---

# CLI conventions

- Results go through `output.render`, errors through `CliError`. No `print()` (ruff's T20 rejects it) and no `sys.exit` outside `cli.main`.
- Every command starts with `settings = start(ctx)` and takes typed values from `Settings`, never from `os.environ`.
- Raise `CliError(code, message, suggestion)` with a code from `errors.py`. A new code gets a row in `EXIT_CODES` and in `docs/configuration.md`'s exit-code table.
- A new setting gets a default and a validator in `Settings`, a precedence case in `tests/test_config.py` and a row in `docs/configuration.md`.
- Keep Typer and output formatting out of domain modules so they test without the command tree.
- Import slow modules inside the command that needs them; `--help` should stay fast.
- Each new command gets cases in `tests/test_cli.py` (text, `--json`, each error path, reading stdout and stderr separately) and, when it adds an exit path, a case in `tests/integration/`.
- Add dependencies with `uv add` (`uv add --dev` for tools); never edit `uv.lock`.

See the project's `AGENTS.md` for commands and the remaining conventions.
