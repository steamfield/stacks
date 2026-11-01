---
schema_version: 1
id: streamlit
kind: stack
name: Streamlit data app
description: An interactive Python data app on Streamlit, managed with uv and make. Sidebar filters drive a metric, an Altair chart and a table over a local CSV; the data logic is a tested Polars package, AppTest drives the page, and verify probes the headless server.
tags: [python, web, data, make]
deps:
  runtime: [streamlit, polars, altair, pydantic, pydantic-settings, structlog]
  dev: [ruff, mypy, pytest, pytest-cov, pytest-randomly, pytest-xdist]
tools: [uv, make, git, jq]
merge: [.claude/settings.json]
decisions:
  - "Python version: the newest stable CPython that Streamlit and Polars both publish wheels for (default). Setup writes .python-version and requires-python."
  - "Package name: the project slug with hyphens as underscores (default), which uv_build expects under src/."
  - "Data source: the committed CSV under data/ (default). For a database or an API, add a loader beside data.py that returns the same frame, cache it in app.py with st.cache_data and a ttl, and keep data/sample.csv for the tests."
  - "Pages: one page (default). For several, add Streamlit's pages/ directory or st.navigation when the user asks, each page as thin as app.py with its own AppTest file."
  - "Sign-in: none (default). Streamlit's st.login needs an OpenID Connect provider and its secrets; add it only when the user names one, with the secrets outside git."
  - "DataFrame library: Polars (default), or pandas when existing code needs it; add pandas-stubs and keep the package Streamlit-free and tested the same way."
  - "Coverage floor: 85% branch coverage of the package (default)."
env:
  PORT_WEB: "8501"
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: typecheck, layer: typecheck, run: make typecheck }
  - { name: test, layer: test, run: make coverage }
  - name: web
    phase: serve
    layer: serve
    run: make start
    expect: { http: "http://127.0.0.1:${PORT_WEB}/_stcore/health", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: uv sync (--locked when CI is set), then git hooks outside CI
  lint: ruff check + ruff format --check
  format: ruff format + ruff check --fix
  typecheck: mypy strict over app.py, src and tests
  test: pytest (parallel), including the AppTest page tests
  coverage: pytest with the branch coverage floor
  dev: Streamlit on PORT_WEB, rerunning the page on save
  start: Streamlit on PORT_WEB with no file watcher, as a deploy runs it
  clean: Remove caches and coverage output
---

# Streamlit data app

## What stacks wrote

A one-page Streamlit app that passes every check once its dependencies are installed. `app.py` is the page and nothing more: page config, two sidebar multiselects with keys, three metrics, an Altair chart and a table, a `st.cache_data` wrapper around the loader, and the one place an `AppError` becomes `st.error`. The logic is in `src/package_name/`, which never imports Streamlit: `data.py` (`SALES_SCHEMA` and `load_sales`, the only file read), `metrics.py` (`Filters`, `Summary` and pure functions for filter options, filtering, totals, revenue by month and money formatting), `charts.py` (the Altair spec), `config.py` (pydantic-settings), `errors.py` (`AppError` and the `HEADINGS` table the page shows per code) and `log.py` (structlog to stderr). The payload is `data/sample.csv`, 24 orders whose totals are worked out by hand in the tests: `tests/test_app.py` runs the page with Streamlit's AppTest, selects a region and a product, and asserts the revenue changes from $1,400.00 to $380.00 and then $320.00; it also covers the missing-file error and empty data. `.streamlit/config.toml` (headless, no usage statistics, no magic, no tracebacks for viewers), the Makefile, `pyproject.toml`, `.env.example` and `docs/ARCHITECTURE.md` ship too. Read the code before extending it.

## Setup

No generator. `pyproject.toml` ships without `[build-system]`, `requires-python` and dependencies, because each carries a version.

1. Rename `src/package_name` to `src/<module>`, where `<module>` is the project slug with `-` replaced by `_`. Replace `package_name` with `<module>` in every file `grep -rl package_name app.py src tests pyproject.toml` lists.
2. Pick the Python version and run `uv python pin <version>`. Run `uv init --package --name <slug> --vcs none` into an empty directory outside the project, copy its `[build-system]` table into `pyproject.toml`, and set `project.requires-python` to `>=` the pinned version. Delete the scratch directory. `app.py` imports the package, so it must be installed.
3. `uv add` every runtime dependency and `uv add --dev` every dev dependency, so they resolve to current releases.
4. `make install lint typecheck coverage`. Update shipped code or config that the installed releases reject (a renamed Streamlit argument, a changed AppTest element), keeping every ruff rule, strict mypy, `filterwarnings = ["error"]`, the coverage floor and the hand-worked values in the tests. Check `.streamlit/config.toml` against `uv run streamlit config show`.
5. Record Python, uv, Streamlit and Polars versions in AGENTS.md. Fill the README's `stacks:fill` markers, then run `stacks verify` until it passes.

## Conventions

The shipped code follows these; new code keeps to them.

- `app.py` draws; the package decides. A filter, total or chart spec is a function in `metrics.py` or `charts.py` with a unit test, called from the page.
- Every widget has an explicit `key`, which AppTest and session state use.
- Slow work in the page sits behind `st.cache_data` (frames, values) or `st.cache_resource` (clients, connections), keyed by its arguments. The package stays cache-free so tests see fresh results.
- Columns are declared in `SALES_SCHEMA`; nothing is inferred, and an empty, unreadable or incomplete file is a `DATA_SCHEMA` error. A column change updates the schema, `data/sample.csv` and the tests together.
- Money stays `pl.Decimal` (`Summary.revenue` is a `Decimal`); `charts.py` casts to float only for drawing.
- Expected failures are `AppError` with a code in `HEADINGS`; the page shows the heading, message and suggestion and stops. Unexpected exceptions reach Streamlit, which shows viewers a generic message and logs the traceback.
- Settings come from `config.Settings` (`<PREFIX>_*` variables and `.env`); `PORT_WEB` and `WEB_HOST` are the Makefile's. Secrets come from the environment.

## Testing

`make coverage` runs pytest with xdist, random order, warnings as errors and an 85% branch floor over the package. `tests/test_data.py`, `test_metrics.py` and `test_charts.py` call the package with the sample or small inline frames. `tests/test_app.py` runs `app.py` through `AppTest.from_file`, sets widgets by key and reads `page.metric`, `page.error` and the drawn elements; a new widget or metric gets a case there with its hand-worked value. `tests/conftest.py` runs each test in an empty directory without the prefix's variables, so AppTest tests point `<PREFIX>_DATA_PATH` at the file they need.

## Commands

The shipped Makefile (`make help`) holds every declared target. Mirror them in AGENTS.md with a single-test command (`uv run pytest tests/test_app.py`). `make dev` is for people looking at the page; agents run `make test`.

<!-- stacks:when with=git-hooks -->
Write lefthook.yml before `make install`: the recipe calls lefthook only outside CI when its config and executable exist. pre-commit formats staged Python with ruff and re-stages fixes, then lints; pre-push runs `make test`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->
CI uses uv's setup action (cache on, Python from .python-version), then `make install lint typecheck coverage` with CI set.
<!-- stacks:end -->

## Gotchas

- Until Setup adds `[build-system]`, `uv sync` doesn't install the package and `app.py` can't import it. Don't add `pythonpath` to pytest's config or `sys.path` hacks to the page.
- `/_stcore/health` answers as soon as the server is up, before the script runs, so the serve probe can't see a broken page. The AppTest tests are what prove it renders.
- AppTest's default timeout is 3 seconds and the first run in a worker imports Streamlit, Polars and Altair; `tests/test_app.py` passes a longer `default_timeout`.
- `st.cache_data` pickles return values and keeps them across reruns and AppTest runs in one process. Exceptions aren't cached, so a fixed file loads on the next rerun.
- Without `server.headless` the first `streamlit run` asks for an email and opens a browser, which hangs verify. Usage statistics are on unless `browser.gatherUsageStats` is false.
- `streamlit run`, `make dev` and `make start` stay in the foreground; the guard hook denies them to agents.
- Headless on a wildcard address (`0.0.0.0`), Streamlit looks up the machine's public IP from checkip.amazonaws.com to print an "External URL". `make start` binds `127.0.0.1`, which skips it; an image sets `STREAMLIT_LOGGER_HIDE_WELCOME_MESSAGE=true`.
