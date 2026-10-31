---
schema_version: 1
id: python-cli
kind: stack
name: Python CLI (Typer)
description: A Python command-line tool on Typer, packaged as a wheel with uv and make. Settings come from a TOML file, env and flags through pydantic-settings, commands print text or JSON with a fixed exit-code table, and verify installs the built wheel and runs it.
tags: [python, cli, make]
deps:
  runtime: [typer, pydantic, pydantic-settings, structlog]
  dev: [ruff, mypy, pytest, pytest-cov, pytest-randomly, pytest-xdist, twine]
tools: [uv, make, git]
merge: [.claude/settings.json]
decisions:
  - "Python version: the newest stable CPython that Typer, ruff and mypy support (default). Setup writes .python-version and requires-python."
  - "Command and distribution name: the project slug (default). The import package is the slug with hyphens as underscores, which uv_build expects under src/."
  - "Build backend: uv_build, as `uv init --package` writes it (default), or hatchling if the user asks; then move the package settings to hatchling's and keep make build and make smoke."
  - "Config file: TOML at $XDG_CONFIG_HOME/<slug>/config.toml, falling back to ~/.config (default), or env and flags only."
  - "Distribution: a wheel installed with `uv tool install` or pipx (default). Standalone binaries (PyInstaller, Nuitka) are out of scope; record them under Deferred if asked."
  - "Coverage floor: 80% branch coverage (default)."
env: {}
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: typecheck, layer: typecheck, run: make typecheck }
  - { name: test, layer: test, run: make coverage }
  - { name: build, layer: build, run: make build }
  - { name: smoke, layer: test, run: make smoke }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: uv sync (--locked when CI is set), then git hooks outside CI
  lint: ruff check + ruff format --check
  format: ruff format + ruff check --fix
  typecheck: mypy strict over src and tests
  test: pytest (parallel), including the console-script tests
  coverage: pytest with the coverage floor
  build: Build the wheel and sdist into dist/ and check their metadata with twine
  smoke: Install the wheel in a throwaway environment and run --version, --help and config show
  clean: Remove caches, build and coverage output
---

# Python CLI (Typer)

## What stacks wrote

A packaged Typer CLI that passes every check once its dependencies are installed. `src/package_name/` holds `cli.py` (the Typer app, root options `--config --json --verbose --no-color --version`, `config show`, and `run`, which maps every failure to an exit code), `config.py` (pydantic-settings over defaults, a TOML file, env and flags), `errors.py` (`CliError` and the exit-code table), `output.py` (text or one JSON document; results on stdout, errors on stderr) and `log.py` (structlog to stderr). `tests/` has one file per module plus `tests/integration/`, which runs the installed console script in a subprocess. The `greeting` setting is the payload that proves the wiring through every layer. `pyproject.toml` carries the project, console script and tool config; the Makefile, `docs/ARCHITECTURE.md` and `docs/configuration.md` (settings, output contract, exit codes) ship too. Read the code before extending it.

## Setup

No generator for the code. `pyproject.toml` ships without `[build-system]`, `requires-python` and dependencies, because each carries a version.

1. Rename `src/package_name` to `src/<module>`, where `<module>` is the project slug with `-` replaced by `_`. Replace `package_name` with `<module>` in every file `grep -rl package_name src tests pyproject.toml` lists.
2. Pick the Python version and run `uv python pin <version>`. Run `uv init --package --name <slug>` into an empty directory outside the project, without its git setup, copy its `[build-system]` table into `pyproject.toml`, and set `project.requires-python` to `>=` the pinned version. Delete the scratch directory.
3. `uv add` every runtime dependency and `uv add --dev` every dev dependency, so they resolve to current releases.
4. `make install lint typecheck coverage build smoke`. Update shipped code or config that the installed releases reject, keeping every ruff rule, strict mypy, `filterwarnings = ["error"]`, the coverage floor and the smoke step.
5. Record Python, uv and Typer versions in AGENTS.md. Fill the README's `stacks:fill` markers, then run `stacks verify` until it passes.

## Conventions

The shipped code follows these; new code keeps to them.

- `cli.run` is the only place that turns exceptions into exit codes, and `cli.main` the only caller of `sys.exit`. Commands raise `CliError(code, message, suggestion)`; anything else becomes `INTERNAL` (exit 1) with no traceback unless `--verbose`.
- Results go through `output.render`, logs through structlog to stderr. Under `--json`, stdout holds one document and an error is one `{"error": {...}}` document on stderr. Nothing else writes to stdout.
- Every command starts with `start(ctx)` and reads typed values from `Settings`. A new setting gets a default, a validator, a precedence test and a row in `docs/configuration.md`.
- Root options are the global ones and go before the command; Typer has no inherited options. Options that only one command needs belong on that command.
- Domain modules never import Typer. Import slow modules inside the command that uses them so `--help` stays fast.
- Add dependencies with `uv add`; commit `uv.lock`.

## Testing

`tests/test_cli.py` calls `cli.run([...])` in process and reads stdout and stderr separately through `capsys`; extend it for each command's text output, JSON output and error paths. Config tests write files under the isolated `XDG_CONFIG_HOME` that `tests/conftest.py` sets for every test, and set env with `monkeypatch`. `tests/integration/` runs the console script installed in `.venv`; add a case when a command adds an exit path. `make coverage` enforces the floor with branch coverage, random order and xdist. `make smoke` is the only check that the wheel contains every module and the entry point, so keep it.

## Commands

The shipped Makefile (`make help`) holds every declared target. Mirror them in AGENTS.md with a single-test command (`uv run pytest tests/test_cli.py`). `TEST_WORKERS` defaults to auto.

<!-- stacks:when with=git-hooks -->
Write lefthook.yml before `make install`: the recipe calls lefthook only outside CI when its config and executable exist. pre-commit formats staged Python with ruff and re-stages fixes, then lints; pre-push runs `make test`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->
CI uses uv's setup action (cache on, Python from .python-version), then `make install lint typecheck coverage build smoke` with CI set.
<!-- stacks:end -->

## Gotchas

- Typer now bundles its own copy of Click as a private module. Don't add `click` or import from `typer._click`; catch `typer.TyperException` and `typer.Abort`, as `cli.as_cli_error` does.
- `config show --json` is a usage error: root options must come before the command.
- `--version` and errors raised before settings load (an unknown command, a bad flag) follow the explicit `--json` flag, not the file or env.
- Typer reads option annotations at runtime, so ruff's TC rules are off for `cli.py`. Moving `Path` under `TYPE_CHECKING` there breaks the command tree.
- structlog's default configuration prints to stdout. `run` configures stderr logging before any command runs; keep that first.
- pydantic-settings takes the TOML path from `model_config`, so `load_settings` sets it on a subclass per call. `extra="forbid"` makes an unknown key in the file an error.
- Rich wraps help to the terminal width. Assert on short substrings of help output, never on whole lines.
- Ctrl+C makes Typer return 130 without a message.
