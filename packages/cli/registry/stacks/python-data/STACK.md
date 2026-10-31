---
schema_version: 1
id: python-data
kind: stack
name: Python data pipeline (Polars, DuckDB)
description: A Python data pipeline and notebook project on Polars and DuckDB, managed with uv and make. Tested transforms turn raw CSV into Parquet with explicit schemas and a rejects file, DuckDB queries the result, and marimo notebooks lint, typecheck and run in verify.
tags: [python, data, make]
deps:
  runtime: [polars, duckdb, pyarrow, pydantic, pydantic-settings, structlog]
  dev: [ruff, mypy, pytest, pytest-cov, pytest-randomly, pytest-xdist, marimo, altair]
tools: [uv, make, git]
merge: [.claude/settings.json]
decisions:
  - "Python version: the newest stable CPython that Polars, DuckDB and marimo all publish wheels for (default). Setup writes .python-version and requires-python."
  - "Package and command name: the project slug (default). The import package is the slug with hyphens as underscores, which uv_build expects under src/."
  - "Notebooks: marimo, stored as Python and run by make notebooks (default), or Jupyter when the user's team already works in it; then add jupyterlab, nbstripout as a git filter and nbmake, and make notebooks runs pytest --nbmake notebooks/."
  - "DataFrame library: Polars (default), or pandas when existing code or a library needs it; add pandas-stubs and keep the transforms pure and tested the same way."
  - "Data location: local files under data/ (default). Object storage and warehouses are out of the base; record them under Deferred if asked."
  - "Orchestration: make targets (default). A scheduler (Dagster, Prefect, cron) is out of the base; record it under Deferred if asked."
  - "Coverage floor: 85% branch coverage (default)."
env: {}
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: typecheck, layer: typecheck, run: make typecheck }
  - { name: test, layer: test, run: make coverage }
  - { name: pipeline, layer: test, run: make pipeline-check }
  - { name: notebooks, layer: test, run: make notebooks }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: uv sync (--locked when CI is set), then git hooks outside CI
  lint: ruff check + ruff format --check + marimo check
  format: ruff format + ruff check --fix
  typecheck: mypy strict over src and tests, then the notebooks
  test: pytest (parallel)
  coverage: pytest with the branch coverage floor
  pipeline: Run the pipeline on data/raw into data/processed
  pipeline-check: Run the pipeline on the fixture into a temp dir and compare with the expected output
  notebooks: Run every notebook headlessly with marimo export html
  clean: Remove caches and coverage output
---

# Python data pipeline (Polars, DuckDB)

## What stacks wrote

A packaged pipeline that passes every check once its dependencies are installed. `src/package_name/` holds `io.py` (the input columns, a text-only `RAW_SCHEMA`, the header check, the lazy CSV scan and Parquet writes), `transform.py` (pure LazyFrame functions: the parsing expressions, `reject_reason`, `clean`, `rejects`, `revenue_by_region`), `queries.py` (a parameterized DuckDB query over the Parquet output), `pipeline.py` (`run_pipeline`, which collects once and writes four Parquet files), `compare.py` (expected CSV against actual Parquet, as frames), `cli.py` (the `run` and `compare` commands and the one place errors become exit codes), `config.py` (pydantic-settings), `errors.py` (`PipelineError` and the exit-code table) and `log.py` (structlog to stderr). The payload is `data/fixtures/orders.csv`, twenty rows with a duplicate, a bad date, missing values, a negative quantity and a non-numeric price, and `data/fixtures/expected/`, its output worked out by hand. `notebooks/explore.py` is a marimo notebook that runs the transforms on the fixture and charts revenue with Altair. `tests/` has one file per module plus `test_pipeline.py`, which runs the fixture end to end. `docs/data-contract.md` (columns, cleaning rules, outputs, exit codes), `docs/ARCHITECTURE.md`, the Makefile, `pyproject.toml` and `.env.example` ship too. Read the code before extending it.

## Setup

No generator for the code. `pyproject.toml` ships without `[build-system]`, `requires-python` and dependencies, because each carries a version.

1. Rename `src/package_name` to `src/<module>`, where `<module>` is the project slug with `-` replaced by `_`. Replace `package_name` with `<module>` in every file `grep -rl package_name src tests notebooks pyproject.toml` lists.
2. Pick the Python version and run `uv python pin <version>`. Run `uv init --package --name <slug> --vcs none` into an empty directory outside the project, copy its `[build-system]` table into `pyproject.toml`, and set `project.requires-python` to `>=` the pinned version. Delete the scratch directory. The package must be installed for the `run` command and for notebooks to import it.
3. `uv add` every runtime dependency and `uv add --dev` every dev dependency, so they resolve to current releases.
4. `make install lint typecheck coverage pipeline-check notebooks`. Update shipped code or config that the installed releases reject, keeping every ruff rule, strict mypy, `filterwarnings = ["error"]`, the coverage floor, the expected output and `marimo check --strict`. Never edit `data/fixtures/expected/` to make a check pass.
5. Record Python, uv, Polars, DuckDB and marimo versions in AGENTS.md. Fill the README's `stacks:fill` markers, then run `stacks verify` until it passes.

## Conventions

The shipped code follows these; new code keeps to them.

- Transforms take and return `pl.LazyFrame`, open no files and never call `collect()`. `io.py` owns file access; `pipeline.py` collects every frame in one `pl.collect_all`.
- Every schema is written down. Raw columns are read as text and parsed by the `PARSED` expressions; a value that doesn't parse makes a reject with a reason rather than an exception. A rule changes in `transform.py`, `docs/data-contract.md` and a test together.
- Exact quantities stay `pl.Decimal`. Cast to float only for a chart.
- Polars and DuckDB meet through Parquet paths and Arrow (`.pl()`), never Python lists. SQL takes values as parameters.
- Notebooks import the package and run on `data/fixtures/`; lasting logic moves into the package with a test.
- `data/raw/` and `data/processed/` stay out of git and are never edited by hand. Only fixtures are committed, and they never hold real data.
- `cli.run` is the only place exceptions become exit codes. Results go to stdout, logs and errors to stderr.

## Testing

Each transform gets an inline-frame test in `tests/test_transform.py` with `assert_frame_equal` and the expected schema; mypy can't see column names, so these tests are where schema mistakes show. `tests/test_queries.py` writes a small Parquet file and runs the SQL on it. `tests/test_pipeline.py` runs the fixture end to end and compares against `data/fixtures/expected/`; `make pipeline-check` repeats that through the installed command. A new rule adds a fixture row and changes the expected files by hand-worked values. `tests/conftest.py` runs each test in an empty directory without the env prefix's variables. `make notebooks` executes every notebook and fails on any cell error.

## Commands

The shipped Makefile (`make help`) holds every declared target. Mirror them in AGENTS.md with a single-test command (`uv run pytest tests/test_transform.py`). `make pipeline` runs on `data/raw/`; people open notebooks with `uv run marimo edit notebooks/explore.py`.

<!-- stacks:when with=git-hooks -->
Write lefthook.yml before `make install`: the recipe calls lefthook only outside CI when its config and executable exist. pre-commit formats staged Python with ruff and re-stages fixes, then lints; pre-push runs `make test`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->
CI uses uv's setup action (cache on, Python from .python-version), then `make install lint typecheck coverage pipeline-check notebooks` with CI set.
<!-- stacks:end -->

## Gotchas

- Until Setup adds `[build-system]`, `uv sync` doesn't install the package, so the command, the tests and the notebooks can't import it. Don't add `pythonpath` to pytest's config to work around that.
- The notebooks' type check needs `py.typed` in the package; keep it when renaming.
- `marimo check` asks for a `__generated_with` version line (MF001). The Makefile ignores that one rule, since the editor writes the line when someone saves; don't pass `--fix`, which writes a version into the notebook.
- marimo rewrites cell signatures on save: it keeps parameter annotations it can infer and drops return annotations. That is why `make typecheck` checks notebooks with `--allow-untyped-defs`; keep the src and tests run strict.
- marimo refuses a variable defined in two cells. Rename it, or prefix it with `_` to keep it local to its cell.
- `marimo edit` and `marimo run` start a server and wait. Agents run `make notebooks`; the guard hook denies the servers.
- DuckDB's `.pl()` needs `pyarrow` installed and is typed as returning `Any`; annotate the result.
- DuckDB's `sum()` of an integer column returns `HUGEINT`, which reaches Polars as `Decimal(38, 0)`; cast it in SQL, as `TOP_PRODUCTS_SQL` does. `compare` parses expected CSVs with the actual Parquet schema, so a type change shows up in the unit tests' schema asserts, not in `pipeline-check`.
- Parquet bytes differ between writer versions. Compare frames, never files.
- `pl.len()` counts as `UInt32`; tests that build expected frames need that type.
