Status: RESEARCH 2026-10-31. Read-only proposal; nothing in the registry was changed. Builds on `plans/research/registry-expansion-stacks-2026-10-29.md` (its `django`, `python-library`, `python-cli`, `streamlit` and `python-data` outlines are reused and corrected here).

# Python stack expansion

Python has two stacks today, and both are FastAPI: `python-api` (API only) and `python-react` (API plus a React SPA). Every other kind of Python project a developer starts with an agent (a Django site, a CLI, a library on PyPI, a data pipeline, a dashboard, an LLM agent) has no recipe. This report proposes seven new stacks, which brings Python to nine. Five are P1 and two are P2.

## Ranked list

| Rank | Id | Name | Priority | One line |
| --- | --- | --- | --- | --- |
| 1 | `django` | Django web app | P1 | Server-rendered Django with ORM, admin, templates, migrations drift check, gunicorn serve probe |
| 2 | `python-cli` | Python CLI (Typer) | P1 | Packaged Typer CLI with JSON output, exit-code table, wheel built and smoke-run from an isolated install |
| 3 | `python-library` | Python library for PyPI | P1 | src-layout typed library, wheel+sdist build, `twine check`, install-and-import smoke, min/max Python test runs |
| 4 | `python-data` | Python data pipeline (Polars, DuckDB) | P1 | Packaged transform library + pipeline CLI + marimo notebooks, golden-output check on fixture data |
| 5 | `django-api` | Django REST API (DRF) | P1 | API-only Django with Django REST Framework, drf-spectacular OpenAPI drift check, one error envelope |
| 6 | `streamlit` | Streamlit data app | P2 | Streamlit dashboard over pure-function data modules, AppTest tests, `/_stcore/health` serve probe |
| 7 | `pydantic-ai-agent` | Python LLM agent (Pydantic AI) | P2 | Pydantic AI agent with typed tools and output, served over FastAPI, tested with TestModel/FunctionModel and no API key |

Build order follows the rank, with one exception worth considering: `python-library` and `python-cli` share packaging (src layout, `uv_build`, wheel smoke), so author them back to back and copy the packaging slice from whichever ships first.

## Evidence

Numbers collected 2026-10-31. Downloads are pypistats `last_month` and include transitive installs, so they overstate direct choice for libraries that other packages depend on (click, typer, httpx, pandas, langchain). Stars are a GitHub API snapshot. Survey shares are self-selected respondents, not market share.

| Package | PyPI downloads, last month | GitHub stars | Survey |
| --- | ---: | ---: | --- |
| fastapi | 381.6M | 104.4k | SO 2026 web frameworks 18.5%; JetBrains 38% |
| flask | 136.5M | 75.0k | SO 2026 12.5%; JetBrains 34% (falling) |
| django | 41.1M | 91.6k | SO 2026 11.3%; JetBrains 35% |
| djangorestframework | 24.1M | 30.2k | |
| django-ninja | 3.7M | 9.2k | |
| click | 817.5M (mostly transitive) | 17.8k | |
| typer | 243.8M (partly transitive via fastapi-cli) | 20.2k | |
| hatchling (build backend) | 320.5M | | |
| pandas | 546.9M | | |
| polars | 50.7M | 40.2k | |
| jupyterlab | 30.3M | | |
| marimo | 2.5M | 23.4k | |
| streamlit | 19.4M | 46.2k | |
| gradio | 5.2M | 43.9k | |
| pydantic-ai | 5.4M | 21.0k | |
| langchain | 170.5M (mostly transitive) | | |
| celery | 43.2M | 29.1k | |
| litestar | 1.7M | 8.5k | |
| scrapy | 4.3M | 65.1k | |
| discord-py | 4.9M | 16.2k | |
| textual | 55.5M (transitive heavy) | 37.6k | |
| dagster / prefect | 7.9M / 6.9M | 16.4k / n.a. | |
| uv | | 91.4k | JetBrains: 11% and rising fast |

Sources:

- [Stack Overflow Developer Survey 2026, web frameworks](https://survey.stackoverflow.co/2026/technology/data/web-framework): 10,281 respondents. FastAPI 18.5%, Flask 12.5%, Django 11.3%. No other Python framework is listed.
- [JetBrains/PSF State of Python 2025](https://blog.jetbrains.com/pycharm/2025/08/the-state-of-python-2025) and [The Register's summary](https://www.theregister.com/2025/08/19/python_survey/): 30,000+ respondents (collected late 2024). FastAPI 38% (up from 29%), Django 35%, Flask 34%; uv at 11%. No 2026 edition had been published as of this research.
- [JetBrains, most popular Python frameworks and libraries 2025](https://blog.jetbrains.com/pycharm/2025/09/the-most-popular-python-frameworks-and-libraries-in-2025/).
- [pypistats.org API](https://pypistats.org/api/packages/django/recent) (one call per package above).
- GitHub REST API `repos/<owner>/<repo>` star counts.
- [Django 6.0 release notes](https://docs.djangoproject.com/en/dev/releases/6.0/) and [the release announcement](https://www.djangoproject.com/weblog/2025/dec/03/django-60-released/): built-in Tasks framework (dev/test backends only), template partials, built-in CSP.
- [django-stubs 6.0 release](https://newreleases.io/project/github/typeddjango/django-stubs/release/6.0.0): covers Django 6.0; plugin enabled with `mypy_django_plugin.main` and `django_settings_module`.
- [uv project init docs](https://docs.astral.sh/uv/concepts/projects/init/): `uv init --lib` and `--package` default to the `uv_build` backend.
- [ty beta](https://pydevtools.com/blog/ty-beta/) and [ty releases](https://github.com/astral-sh/ty/releases/tag/0.0.93): still 0.0.x; Django inference landing release by release. Not ready to replace mypy as the verify typechecker.
- [Streamlit AppTest](https://docs.streamlit.io/develop/api-reference/app-testing).
- [Pydantic AI testing guide](https://pydantic.dev/docs/ai/guides/testing/): `TestModel`, `FunctionModel`, `models.ALLOW_MODEL_REQUESTS = False`, `capture_run_messages`, `Agent.override`.
- [marimo check](https://marimo.io/blog/marimo-check) and [marimo scripts guide](https://docs.marimo.io/guides/scripts/).

What the evidence says, briefly. Django and FastAPI are the two Python web frameworks people start new projects on; Flask is still widely used but falling in the JetBrains series and covered in product terms by the other two. Outside web, the biggest Python audiences are data work and CLIs/libraries, which have no recipe. Streamlit leads Gradio by about 4x in downloads for data apps. Pydantic AI is the agent framework that fits this catalog's conventions (pydantic, mypy strict, testable without a model), even though LangChain's raw downloads are larger.

## Conventions shared by every proposal

These match `python-api` so the stacks read as one family. Each stack below lists only where it differs.

- **Toolchain.** uv for environments and locking (`uv add`, `uv add --dev`, `uv sync --locked` under CI), ruff for lint and format with the `python-api` rule set as the base, mypy strict (with the framework's plugin where one exists), pytest with `pytest-cov` (branch coverage, a floor), `pytest-randomly`, `pytest-xdist`, `filterwarnings = ["error"]`, `--strict-markers --strict-config`. Make as the task runner (`make` tag), with `help`, `install`, `lint`, `format`, `typecheck`, `test`, `coverage`, `clean` targets named exactly as in `python-api`. ty is not a candidate yet (0.0.x).
- **No versions.** No `requires-python` in shipped `pyproject.toml.tmpl`; Setup runs `uv python pin` and writes `requires-python` and ruff's `target-version`, as `python-api` Setup step 3 does. No `[build-system]` pin either: packaged stacks tell the agent to add the current `uv_build` backend (`uv init --package` writes it with a version range) or `hatchling`, so the range is the agent's. This is a real wrinkle: a packaged project needs a `[build-system]` table, and that table normally carries a version range. Shipping it unbounded would be wrong, so the shipped file leaves it out and Setup adds it.
- **Settings.** `pydantic-settings` with validated defaults and an `.env.example`, except where the framework owns settings (Django).
- **Logging.** `structlog`, JSON in production and readable in development, configured once at startup, nothing logged to stdout by a CLI.
- **Errors.** One error base type with a table of code, safe message, and exit code or HTTP status, as `python-api`'s `AppError` and `go-cli`'s `internal/errors` do.
- **README check.** Every stack keeps the `readme-filled` verify step.
- **Agent ops.** Each stack ships a `.claude/rules/<stack>.md` path-scoped rule, `.claude/settings.json` allow rules for its non-destructive make targets (listed in `merge`), and a guard hook only where there's a generated artifact to protect. Each new stack that ships allow rules must be added to `agent-ops`'s `stacks:when stack=astro-blog,go-cli,mobile-expo,python-react` block (python-api isn't in that list today, which looks like an existing gap worth checking).
- **Registry bookkeeping per stack.** Every new PyPI name goes into `registry/allowlist.json` `names.pypi` (today: 18 names, all from the FastAPI stacks) and gets a dependency card in `registry/deps/pypi.json`; `scripts/index/allowlist.ts` fails `build:index` otherwise. Each stack also needs a search card under `registry/search/stacks/`.

## Fragment fit

| Fragment | `applies_to` today | Fits which proposals | Work needed |
| --- | --- | --- | --- |
| `agent-ops` | all | all | Add new stacks to the settings-allow `stacks:when` list |
| `git-hooks` | all | all | None; Python branch already formats with ruff |
| `ci-github` | all | all | Its `tag=python` branch covers uv setup. `python-library` wants a Python version matrix; add a short `stack=python-library` branch |
| `rr` | all | all | None |
| `ce-plugin` | all | all | None |
| `rest-api` | tag `api` | `django-api`, `pydantic-ai-agent` (tagged `api`) | Its `stacks:when` notes are per stack; add one line each |
| `docker-deploy` | id list incl. `python-api` | `django`, `django-api`, `streamlit`, `pydantic-ai-agent` | Widen `applies_to`. Its `tag=python` branch says "run uvicorn"; Django needs gunicorn, Streamlit needs `streamlit run --server.headless`. Add per-stack branches |
| `postgres` | `python-react`, `python-api` | `pydantic-ai-agent` only (SQLAlchemy/Alembic) | Django needs its own: Django uses its ORM and migrations, not SQLAlchemy/Alembic. Propose a new `django-postgres` fragment (psycopg, Compose dev/test DBs, `DATABASE_URL` parsing, pytest-django's test DB on Postgres) applying to `django` and `django-api` |
| `goreleaser`, `bun-release` | Go / TS CLIs | none | A PyPI release fragment (`pypi-release`: trusted publishing workflow, tag-driven) for `python-cli` and `python-library` is the natural follow-up; it can't be verified locally, so it's a P2 fragment, not part of the stacks |
| `openrouter-ai` | TS only | `pydantic-ai-agent` conceptually | Pydantic AI has an OpenRouter provider; a Python branch or sibling fragment later. Not needed for the base |
| `effect*`, `posthog`, `clerk`, `cloudflare-*`, `drizzle-postgres` | non-Python | none | |

---

## 1. `django` (P1)

- **Name:** Django web app
- **Description (draft, ~40 words):** A server-rendered Python web app on Django with its ORM, admin, templates and migrations, managed with uv and make. pytest-django tests run against a real database, structlog request logs carry ids, and gunicorn serves the verify probe.
- **Why distinct:** The only Python stacks are FastAPI APIs. Django is the batteries-included server-rendered framework (ORM, admin, auth, forms, templates, migrations) and a developer asks for it by name. SO 2026 11.3%, JetBrains 35%, 91.6k stars, 41M downloads/month.
- **Libraries.** Runtime: `django`, `gunicorn`, `whitenoise`, `structlog`, `django-structlog` (optional; a 40-line middleware is enough and avoids a dep, recommend the hand-written one), `environs` or plain `os.environ` parsing in `settings.py` (recommend plain stdlib parsing with a small validated helper; Django settings are a module, so pydantic-settings is a poor fit). Dev: `ruff`, `mypy`, `django-stubs` (with the `[compatible-mypy]` extra), `pytest`, `pytest-django`, `pytest-cov`, `pytest-randomly`, `pytest-xdist`, `djlint` (template lint/format).
- **Tools:** `uv`, `make`, `git`.
- **Lint/format/typecheck/test:** ruff (add the `DJ` rule set), `djlint --check` for templates, mypy strict with `mypy_django_plugin.main` and `[tool.django-stubs] django_settings_module = "config.settings"`, pytest-django.
- **Proving slice:** `manage.py`; `config/` (`settings.py` reading env with validated defaults and failing fast on a missing `SECRET_KEY` when `DEBUG` is off, `urls.py`, `wsgi.py`, `asgi.py`); one feature app `notes/` with a `Note` model, its admin registration, an initial migration, a `ModelForm`, a list view and a create view (POST, redirect, messages), templates with a base layout and one template partial (Django 6's `{% partialdef %}`), static CSS through whitenoise; `core/` with the error views (custom 404/500 templates), request-id middleware binding structlog context, and `/healthz` (a plain view, DB-free). Tests: model and form unit tests, view tests through Django's test client (create, list, validation error, 404), a settings test that the production check fails without `SECRET_KEY`. The payload: create a note through the form and see it listed, which proves ORM, migrations, forms, CSRF, templates and static wiring end to end.
- **Verify steps:**
  - `install` (setup): `make install`
  - `lint`: `make lint` (ruff check, ruff format --check, djlint --check)
  - `typecheck`: `make typecheck` (mypy with the plugin)
  - `test`: `make coverage`
  - `migrations`: `make check-migrations` (`manage.py makemigrations --check --dry-run`; fails on model drift)
  - `deploy-check` (check layer): `make check-deploy` (`manage.py check --deploy --fail-level WARNING` with a throwaway secret and `DEBUG=0`)
  - `collectstatic` (build): `make build` (`collectstatic --noinput` into `staticfiles/`)
  - `web` (serve): `make start` runs `migrate` then gunicorn on `127.0.0.1:${PORT_WEB}`; `expect: http://127.0.0.1:${PORT_WEB}/healthz`. A second check that `/` answers is free since the serve probe only takes one URL; the view tests cover `/`.
  - `readme-filled`
- **Decisions:** Database: SQLite file under `var/` (default), `--with django-postgres` for Postgres. Custom user model: ship an `accounts.User` subclass from day one (default; Django's docs recommend it, and switching after the first migration is painful). Frontend interactivity: none (default), HTMX via `django-htmx` later as a fragment. Background work: Django 6 Tasks with the immediate backend for dev/test (default), a real worker via a later fragment.
- **Agent ops:** `.claude/rules/django.md` (apps own models/views/templates; settings only via env; every model change ships its migration from `makemigrations`, never hand-written; no raw SQL without a reason recorded; querysets in views get `select_related`/`prefetch_related` where a template loops over relations). A guard hook that blocks Edit/Write of existing files under `*/migrations/` (new migrations come from `makemigrations`; editing an applied migration is the classic agent mistake), with a test like `python-api`'s `test_openapi_guard.py`. Allow rules for lint/typecheck/test/check-migrations and `uv run python manage.py makemigrations`, never `migrate` against anything but the dev DB (don't allow-list `migrate`).
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `django-postgres` (new), `docker-deploy` (widened, gunicorn branch), `rr`, `ce-plugin`.
- **Gotchas:**
  - `django-stubs` must match the installed Django major; the agent adds both in the same `uv add` so the resolver picks compatible releases. The mypy plugin imports settings, so typecheck needs the same env defaults as tests (set `DJANGO_SETTINGS_MODULE` and a dev `SECRET_KEY` in the Makefile, not in `.env`).
  - Ruff's TC rules move model and form imports into `TYPE_CHECKING` blocks that Django needs at runtime; set `runtime-evaluated-base-classes` for `django.db.models.Model` and `django.forms.Form`.
  - `filterwarnings = error` turns Django's `RemovedInDjangoXXWarning` into failures; that's intended, keep it.
  - Gunicorn doesn't serve static files; whitenoise must be in middleware right after `SecurityMiddleware`, and `collectstatic` must run before `start` with `DEBUG=0`, otherwise the probe passes but pages lose CSS. The Makefile's `start` should depend on `build`.
  - Django 6 Tasks' built-in backends are dev/test only; don't let the agent call that production-ready.
  - The custom user model must exist before the first `migrate`.

## 2. `python-cli` (P1)

- **Name:** Python CLI (Typer)
- **Description:** A Python command-line tool on Typer, packaged with uv and installable with `uv tool install`, with typed config from env and file, human and JSON output, an exit-code table, and pytest tests that run the installed command.
- **Why distinct:** Go and TypeScript have CLI stacks; Python doesn't, and Python CLIs are distributed and tested differently (a wheel with a console-script entry point, not a binary). Typer: 20.2k stars, 244M downloads/month (partly transitive via FastAPI's CLI). Typer over Click: same engine (Typer is built on Click), type hints as the command signature, which mypy can check, and the FastAPI author's stack matches `python-api`.
- **Libraries.** Runtime: `typer` (brings `rich` and `click`), `pydantic-settings`, `structlog`. Dev: `ruff`, `mypy`, `pytest`, `pytest-cov`, `pytest-randomly`, `pytest-xdist`, `twine`.
- **Tools:** `uv`, `make`, `git`.
- **Proving slice:** `src/{{project_slug}}/` (Setup renames the directory, since directory names can't be templated; the same issue `go-cli` solves with the module path): `__main__.py`, `cli.py` (root app with `--json`, `--verbose`, `--no-color`, `--version` handled eagerly so it honors `--json`; `config show` command), `config.py` (defaults < `~/.config/<slug>/config.toml` via stdlib `tomllib` < env < flags), `errors.py` (base `CliError` with code, message, suggestion and exit code; one mapping function; unexpected exceptions become `INTERNAL` exit 1 with no traceback unless `--verbose`), `output.py` (results to stdout, everything else to stderr; one JSON document under `--json`, errors as `{"error":{...}}` on stderr), `log.py` (structlog to stderr). `pyproject.toml` with `[project.scripts]`. Tests: unit tests per module; `typer.testing.CliRunner` tests for commands; an integration test that runs the built console script in a subprocess. The payload: `config show` reads a `greeting` setting through every precedence layer and prints it in both modes, matching `go-cli`'s.
- **Verify steps:** `install`, `lint`, `typecheck`, `test` (`make coverage`), `build` (`make build`: `uv build` then `uv run twine check dist/*`), `smoke` (`make smoke`: `uvx --from dist/*.whl <slug> --version` and `--help`, and `config show --json | jq`-free check using `python -c json.load`, from an isolated environment so a missing package file or entry point fails), `readme-filled`.
- **Decisions:** Command name: the project slug (default). Distribution: wheel on PyPI via `uv tool install`/`pipx` (default); standalone binaries (PyInstaller, Nuitka) out of scope. Config file format: TOML (default; stdlib reader, no extra dep).
- **Agent ops:** `.claude/rules/python-cli.md`: never `print()` (ruff `T20` already bans it; output goes through `output.py`), never `sys.exit` outside the entry point, every new command gets a CliRunner test and, if it has a new exit path, an integration case. No hook needed.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`, and later `pypi-release`.
- **Gotchas:**
  - `CliRunner` mixes stderr into output unless constructed to separate it; assert stdout and stderr separately or the stdout contract isn't tested.
  - Rich's console wraps and colors when it thinks it's a terminal; tests and `--json` must force no color and no width wrapping (`NO_COLOR`, `TERM=dumb`, or a Console created with explicit settings).
  - `--version` as a Typer callback with `is_eager=True`, otherwise it runs after required-option validation.
  - Typer's `rich_markup_mode` renders help text through Rich; don't put user data in help strings.
  - The installed-command smoke is the only check that catches a missing `[project.scripts]` entry or a module left out of the wheel; keep it.
  - Startup time: import heavy modules lazily inside commands; a `--help` that takes a second is a real complaint for Python CLIs.

## 3. `python-library` (P1)

- **Name:** Python library for PyPI
- **Description:** A typed Python library published to PyPI, in a src layout built with uv, with a `py.typed` marker, strict mypy, pytest against the oldest and newest supported Python, and a wheel and sdist checked with twine and installed in isolation before release.
- **Why distinct:** No stack produces a package other code imports. A library has a public API, a supported-Python range, and an artifact that must install cleanly, none of which an app stack cares about. The `uv_build` backend (default for `uv init --lib`) and hatchling (320M downloads/month) show how much packaging happens.
- **Libraries.** Runtime: none. Dev: `ruff`, `mypy`, `pytest`, `pytest-cov`, `pytest-randomly`, `twine`, `hypothesis` (property tests suit library code and catch edge cases a slice can demonstrate in one test).
- **Tools:** `uv`, `make`, `git`.
- **Proving slice:** `src/{{project_slug}}/` with `__init__.py` (explicit `__all__`, `__version__` read from `importlib.metadata`), one small module with a pure function and a custom exception hierarchy (`{{Project}}Error` base, documented), `py.typed`. Tests: unit tests, one Hypothesis property test, a public-API test that asserts `__all__` matches the documented surface (so an accidental export or removal fails). `docs/` holds an API stub and a CHANGELOG. The payload: a tiny parser/formatter pair with a round-trip property.
- **Verify steps:** `install`, `lint`, `typecheck` (mypy strict over `src` and `tests`), `test` (`make coverage`), `test-min` (`make test-min`: `uv run --isolated --python <oldest supported> pytest`; the oldest version comes from `requires-python`, read by the Makefile rather than written into it), `build` (`uv build`, then `twine check --strict dist/*`), `install-smoke` (`make smoke`: create a temp venv, install the built wheel without the source tree on the path, import the package and assert `py.typed` is present in the installed files), `readme-filled`.
- **Decisions:** Supported Pythons: every CPython not past end of life through the newest stable (default); Setup writes `requires-python` and the oldest goes to `test-min`. Build backend: `uv_build` (default) or `hatchling` when the user needs build hooks or VCS versioning. Versioning: static version in `pyproject.toml` (default) or VCS tags via `hatch-vcs` (switches the backend). License: ask; default MIT with `{{author}}` and `{{year}}`. Docs site: none in the base.
- **Agent ops:** `.claude/rules/python-library.md`: no runtime dependency without asking (each one is forced on every user); public names change only with a CHANGELOG entry; no print/logging configuration in library code (use `logging.getLogger(__name__)` with a `NullHandler`, never structlog, which would impose a dependency); the public-API test changes only deliberately.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github` (needs a matrix branch); optional `rr`, `ce-plugin`, later `pypi-release`.
- **Gotchas:**
  - A library must not commit a lockfile as its contract; it's fine to keep `uv.lock` for development, but tests against the oldest Python should also run with lowest direct dependencies (`uv sync --resolution lowest-direct`) once the library has any.
  - The src layout exists so tests import the installed package, not the working tree; don't add `pythonpath = ["src"]` to pytest config to "fix" an import error.
  - `py.typed` must be inside the package directory and included in the wheel; `uv_build` includes it, other backends may need config. The install smoke checks it.
  - `twine check` validates the README renders on PyPI; a README using unsupported Markdown fails, which is correct.
  - Don't set an upper bound on `requires-python`.
  - The no-version-literal rule meets `[build-system] requires`, which normally carries a range. Setup must add the table (uv writes one); the shipped `pyproject.toml.tmpl` omits it, and the build step fails loudly until it's there.

## 4. `python-data` (P1)

- **Name:** Python data pipeline (Polars, DuckDB)
- **Description:** A Python data project with a tested transformation package on Polars and DuckDB, a pipeline command that turns raw CSV into Parquet, and marimo notebooks stored as plain Python that lint, typecheck and run in verify.
- **Why distinct:** Data analysis is Python's single largest use (JetBrains has it ahead of web development every year), and nothing in the catalog is a pipeline or notebook project. Polars: 40.2k stars, 50.7M downloads/month and growing; DuckDB is the local SQL engine of choice.
- **Why marimo over Jupyter as the default:** marimo notebooks are `.py` files, so ruff, mypy and git diffs work on them, `marimo check` lints them, and `python notebook.py` or `marimo export html` runs them headlessly. That makes them verifiable, which `.ipynb` files are only with extra tooling (`nbstripout`, `nbmake`). Jupyter has the bigger audience (jupyterlab 30M downloads vs marimo 2.5M), so it's a decision, not a rejection.
- **Libraries.** Runtime: `polars`, `duckdb`, `pyarrow`, `structlog`, `pydantic-settings`. Dev: `ruff`, `mypy`, `pytest`, `pytest-cov`, `pytest-randomly`, `marimo`, `altair` (notebook charts; accepts Polars frames). Optional via the decision: `jupyterlab`, `ipykernel`, `nbmake`, `nbstripout`.
- **Tools:** `uv`, `make`, `git`.
- **Proving slice:** `src/{{project_slug}}/` with `io.py` (read raw CSV with an explicit Polars schema; write Parquet), `transform.py` (pure `pl.LazyFrame -> pl.LazyFrame` functions: clean, dedupe, aggregate), `queries.py` (one DuckDB SQL query over the Parquet output, proving the Polars/Arrow/DuckDB handoff), `pipeline.py` (CLI entry: `python -m <pkg>.pipeline --in data/raw --out data/processed`), `errors.py` (schema/validation errors with exit codes). `data/fixtures/` holds a 20-row committed CSV with deliberate dirty rows (nulls, a duplicate, a bad date) and `data/fixtures/expected.parquet` or an expected CSV. `notebooks/explore.py` (marimo) imports the package, runs the pipeline on fixtures and charts one aggregate. `data/raw` and `data/processed` are gitignored. Tests: unit tests per transform using `polars.testing.assert_frame_equal`; a pipeline test on the fixtures comparing against the expected output; a DuckDB query test. The payload: the fixture CSV through clean, aggregate, Parquet, and a DuckDB query, with the dirty rows handled the documented way.
- **Verify steps:** `install`, `lint` (ruff over `src`, `tests`, `notebooks`), `typecheck` (mypy over the same), `test` (`make coverage`), `pipeline` (`make pipeline-check`: run the pipeline CLI on fixtures into a temp dir and compare to the expected output), `notebooks` (`make notebooks`: `marimo check notebooks/` then `marimo export html` each into a temp dir, which executes them), `readme-filled`.
- **Decisions:** Notebooks: marimo (default) or Jupyter (adds `nbstripout` as a git filter and `pytest --nbmake notebooks/` as the notebook step). DataFrame library: Polars (default); pandas when the user's existing code or a library needs it (`pandas-stubs` for mypy). Data location: local files (default); object storage and warehouses are out of the base. Orchestration: none (default; a Make target); Dagster/Prefect are later fragments.
- **Agent ops:** `.claude/rules/python-data.md`: transforms are pure functions on LazyFrames, with no I/O; schemas are explicit on read, never inferred; notebooks import from the package and hold no logic that tests don't cover; never commit real data, only fixtures. A hook that blocks writes into `data/raw/` (raw data is input, never edited) is cheap and useful. Also a `.gitignore` covering `data/raw`, `data/processed`, `*.parquet` outside fixtures.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`.
- **Gotchas:**
  - Polars' typing is good, but mypy can't see column names; tests are where schema mistakes show. Keep `assert_frame_equal` tests per transform.
  - `collect()` inside transforms defeats lazy evaluation; only `io.py` and the pipeline entry collect.
  - DuckDB and Polars both use Arrow; pass Arrow tables or Parquet paths between them, not Python lists.
  - marimo notebooks fail `marimo check` on redefined variables across cells; that's the rule that makes them reproducible, don't disable it.
  - `marimo export html` needs the notebook's imports installed in the project env (notebook deps go in dev), and runs every cell, so notebooks must work on fixture data, not a path that only exists on the author's machine.
  - Expected-output files compare data, not bytes; Parquet bytes vary by writer version, so compare frames.

## 5. `django-api` (P1)

- **Name:** Django REST API (DRF)
- **Description:** A Python JSON API on Django and Django REST Framework with no server-rendered pages, using Django's ORM, migrations and admin, a drf-spectacular OpenAPI spec with a drift check, one error envelope, and pytest-django tests through the real API client.
- **Why distinct:** `python-api` is FastAPI with no ORM; `django` is server-rendered. Teams pick DRF when they want Django's ORM, admin and auth behind an API, and they ask for it by name. DRF: 30.2k stars, 24.1M downloads/month, more than half of Django's own downloads.
- **Is this a fragment on `django` instead?** The prior research leaned that way ("API capability is a fragment unless the layout changes substantially"). The layout does change: no templates, static or forms, a serializer layer, a committed OpenAPI spec and drift check, an exception handler replacing error pages, API-client tests instead of page tests, and the `api` tag (which pulls in `rest-api`). A Django site that also needs an API is the fragment case (`django` plus a later `drf` fragment); an API-only service is a different product. I'd ship this as a stack and accept the overlap in the settings/logging/health code, which can be copied from `django`.
- **Libraries.** Runtime: `django`, `djangorestframework`, `drf-spectacular`, `gunicorn`, `structlog`. Dev: `ruff`, `mypy`, `django-stubs`, `djangorestframework-stubs`, `pytest`, `pytest-django`, `pytest-cov`, `pytest-randomly`, `pytest-xdist`.
- **Tools:** `uv`, `make`, `git`.
- **Proving slice:** `config/` as in `django` minus templates/static; `notes/` app with model, migration, admin, `serializers.py` (camelCase field names via `source=`), a `ModelViewSet` restricted to list/create/retrieve, router under `/v1/`, cursor pagination (DRF's `CursorPagination`); `core/` with the exception handler (DRF validation errors, 404, 405 and unexpected exceptions all mapped to one `{"error": {"tag", "message", "retryable"}}` envelope matching `python-api`'s, so `rest-api`'s guidance applies unchanged), request-id middleware, `/healthz`. `openapi.yaml` committed (generated in Setup, like `python-api`'s `openapi.json`). Tests: serializer unit tests, API tests through `APIClient` for success, validation, 404, 405 and pagination. The payload: create, read and list notes, matching `python-api`'s notes resource so the two API stacks are directly comparable.
- **Verify steps:** `install`, `lint`, `typecheck`, `test` (`make coverage`), `migrations` (`makemigrations --check --dry-run`), `openapi-drift` (`make check-openapi`: `spectacular --validate --fail-on-warn` into a temp file, compare parsed), `deploy-check`, `api` (serve: `make start`, probe `/healthz`), `readme-filled`.
- **Decisions:** Database as `django`. Auth: none (default); session auth for a same-origin browser client or token auth via a later fragment. Path prefix `/v1` (default). Browsable API: off in production (default; renderer classes set to JSON only outside `DEBUG`).
- **Agent ops:** `.claude/rules/django-api.md` (thin views, serializers own validation, no business logic in serializers' `save` beyond persistence, the error handler owns the envelope, regenerate `openapi.yaml` after any serializer/view change). Reuse `django`'s migrations guard and `python-api`'s OpenAPI guard pattern (blocks hand edits to `openapi.yaml`).
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`, `rest-api`; optional `django-postgres` (new), `docker-deploy` (widened), `rr`, `ce-plugin`.
- **Gotchas:**
  - DRF's typing is weaker than FastAPI's: serializers' `validated_data` is `dict[str, Any]`. The stubs help with views and fields; keep mypy strict and convert `validated_data` into a typed value at the boundary.
  - drf-spectacular infers schemas from serializers; a `SerializerMethodField` or a custom action without `@extend_schema` produces warnings, and `--fail-on-warn` makes them failures. Annotate, don't drop the flag.
  - DRF's default exception handler returns different shapes for validation (`{"field": [...]}`) and other errors (`{"detail": ...}`); the custom handler must be set in `REST_FRAMEWORK["EXCEPTION_HANDLER"]` and Django's own 404/500 for non-DRF paths need JSON views too, or `/nope` returns an HTML page.
  - `CursorPagination` needs a stable unique ordering (`-created`, `-id`).

## 6. `streamlit` (P2)

- **Name:** Streamlit data app
- **Description:** A Python data app on Streamlit that charts and filters a local dataset, with data logic in a tested package on Polars, Streamlit's AppTest for the page, and a headless server probe, managed with uv and make.
- **Why distinct:** An interactive data app for non-developers is neither an API nor a pipeline; it's what data people ship most often. Streamlit: 46.2k stars, 19.4M downloads/month, about 4x Gradio's downloads.
- **Libraries.** Runtime: `streamlit`, `polars`, `altair`, `pydantic-settings`. Dev: `ruff`, `mypy`, `pytest`, `pytest-cov`, `pytest-randomly`.
- **Tools:** `uv`, `make`, `git`.
- **Proving slice:** `app.py` (thin: sidebar filters, one metric, one Altair chart, one table; calls into the package only), `src/{{project_slug}}/data.py` (load the committed fixture CSV with `st.cache_data` applied in `app.py`, not in the package, so the package stays Streamlit-free), `src/.../metrics.py` (pure filter/aggregate functions), `data/sample.csv`, `.streamlit/config.toml` (headless, no usage stats, theme). Tests: unit tests for metrics; AppTest tests (`AppTest.from_file("app.py")`, set a filter, assert the metric value and no exception). The payload: changing a filter changes the metric, proven by AppTest.
- **Verify steps:** `install`, `lint`, `typecheck`, `test` (`make coverage`), `app` (serve: `make start` = `streamlit run app.py --server.headless true --server.port ${PORT_WEB} --server.address 127.0.0.1`, probe `http://127.0.0.1:${PORT_WEB}/_stcore/health`), `readme-filled`.
- **Decisions:** Data source: committed sample file (default); a database or API later. Multipage: single page (default), `pages/` when asked. Auth: none (Streamlit's own auth needs an OIDC provider, which breaks the no-credentials rule).
- **Agent ops:** `.claude/rules/streamlit.md`: Streamlit reruns the whole script per interaction, so expensive work goes behind `st.cache_data`/`st.cache_resource`; widgets get explicit `key`s (AppTest finds them by key); logic lives in the package, never in `app.py`.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `docker-deploy` (widened, Streamlit branch), `rr`, `ce-plugin`.
- **Gotchas:**
  - Streamlit collects usage stats unless `browser.gatherUsageStats = false`; set it in config.
  - Without `--server.headless true` the first run prompts for an email and opens a browser, which hangs verify.
  - AppTest runs the script in process with a default timeout of a few seconds; slow data loads need `at.run(timeout=...)` or cached fixtures.
  - mypy treats many Streamlit return types loosely; that's fine, but keep the package (where the logic is) strict.
  - `/_stcore/health` answers before the script first runs; the AppTest step is what proves the page renders.
- **Why P2:** narrower audience than the P1s, and the health probe doesn't prove rendering, so the AppTest tests carry more weight than a serve probe usually does.

## 7. `pydantic-ai-agent` (P2)

- **Name:** Python LLM agent (Pydantic AI)
- **Description:** A Python LLM agent on Pydantic AI with typed tools, dependencies and structured output, served as a FastAPI endpoint, tested with Pydantic AI's TestModel and FunctionModel so verify needs no API key or network.
- **Why distinct:** Building an agent (tools, structured output, a model provider, evals) is a different job from a CRUD API, and it's what a lot of new Python projects are in 2026. Pydantic AI (21.0k stars, 5.4M downloads/month) fits the catalog's conventions: pydantic models, strict typing, and a first-class testing story that blocks real model calls in tests. LangChain has larger raw downloads but most are transitive and its abstractions are harder to test offline.
- **Id note:** `python-agent` would read as "coding agent" in this product, where "agent" already means Claude Code or Codex. `pydantic-ai-agent` names the main package and the product. An alternative is `python-llm-agent`; test both with `stacks search`.
- **Libraries.** Runtime: `pydantic-ai-slim` with the chosen provider extra (the slim package avoids installing every provider SDK), `fastapi`, `uvicorn`, `pydantic-settings`, `structlog`. Dev: `ruff`, `mypy`, `pytest`, `pytest-cov`, `pytest-randomly`, `anyio` (pydantic-ai's docs use the anyio pytest plugin), `httpx`, `asgi-lifespan`, `inline-snapshot`, `dirty-equals`, `pydantic-evals`.
- **Tools:** `uv`, `make`, `git`.
- **Proving slice:** `app/agent.py` (one `Agent` with a typed `deps` dataclass, a structured `output_type`, and two tools, one reading from an in-memory store and one doing a pure computation), `app/main.py` (FastAPI factory reused from `python-api`'s shape: settings, lifespan, error envelope, request-id logging, `/healthz`, `POST /v1/ask`), `app/config.py` (model name and provider key as optional `SecretStr`; with no key the app still starts and `/v1/ask` returns a 503 `ModelUnavailable` with a safe message, so the serve probe works with no credentials). Tests: tool unit tests; agent tests with `TestModel` (all tools called, output validates) and `FunctionModel` (drives a specific tool path), `capture_run_messages` for one exact exchange; HTTP tests overriding the agent's model via `Agent.override`; a conftest that sets `models.ALLOW_MODEL_REQUESTS = False`. `evals/` with a `pydantic-evals` dataset of three cases and a `make evals` target that runs against the real model only when a key is set (not a verify step). The payload: `POST /v1/ask` routes a question through a tool and returns the typed output, driven by FunctionModel in tests.
- **Verify steps:** `install`, `lint`, `typecheck`, `test` (`make coverage`), `openapi-drift` (as `python-api`), `api` (serve, probe `/healthz`), `readme-filled`. Evals stay out of verify because they need a key and are nondeterministic.
- **Decisions:** Provider: OpenAI-compatible (default, which also covers OpenRouter and local Ollama), or Anthropic, or Google, chosen at Setup; the key is optional and only `make evals` and real use need it. Interface: HTTP endpoint (default) or a CLI (Typer). Streaming: off in the base (default); SSE later. Persistence of conversations: none (default); `--with postgres` (the existing FastAPI `postgres` fragment fits, once widened).
- **Agent ops:** `.claude/rules/pydantic-ai.md`: never call a real model in tests; every tool has a unit test and a FunctionModel test that exercises it; prompts live in one module; structured outputs over parsing text; record model names in settings, never in code. A hook isn't needed; the conftest guard enforces the no-network rule.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `postgres` (widened), `docker-deploy` (widened; its uvicorn branch fits), `rest-api`, `rr`, `ce-plugin`.
- **Gotchas:**
  - Pydantic AI is young and moves fast; the shipped code must be written against a current release and Setup must say to update shipped code the installed release rejects (renamed parameters have happened, e.g. `result_type` to `output_type`).
  - `TestModel` generates schema-valid but meaningless data; tests on content belong to FunctionModel.
  - Model names in docs go stale quickly; the shipped default model name is a version-like literal. Make it a required decision answered at Setup, not a shipped constant.
  - The agent object is module-level in most examples; keep construction in a factory so tests and the lifespan can build it with overrides.
- **Why P2:** the space changes fastest of any here, so it has the highest rot risk, which is what the product cares about most. It's still worth shipping because agents are the job developers are starting most often right now.

---

## Rejected or deferred

| Candidate | Verdict | Why |
| --- | --- | --- |
| Flask | Deferred | Large installed base (SO 2026 12.5%, 136M downloads/month, 75k stars) but falling in the JetBrains series, and its two product shapes are already covered: server-rendered (`django`) and JSON API (`python-api`). Revisit on request with the prior research's outline (`flask`, `gunicorn`, `pydantic-settings`; app factory, blueprints, error envelope, serve probe). |
| Litestar | Rejected | A variant of `python-api` (same product, different framework), 8.5k stars and 1.7M downloads vs FastAPI's 104k and 382M. |
| Django Ninja | Rejected as a separate stack | Same product as `django-api`. Ninja is better typed (pydantic schemas), but DRF has 6.5x the downloads and agents know it better. Could become the `django-api` default if typing problems with DRF prove expensive in bench runs. |
| Gradio | Rejected as a stack | Overlaps `streamlit` (an interactive Python UI); its distinct use is ML model demos, often on Hugging Face Spaces. A later fragment on `pydantic-ai-agent` (a chat UI) is the better home. |
| Celery / RQ / Dramatiq worker | Fragment, not a stack | A worker is part of a web project, not a project of its own. Propose a `celery-worker` fragment for `python-api`, `django`, `django-api` (Redis via Docker Compose, eager mode in unit tests, a real worker in an integration test). Django 6's built-in Tasks framework may make a Django-specific fragment simpler. |
| LangChain / LangGraph agent | Rejected | Downloads are mostly transitive; offline testing needs more scaffolding; and two agent stacks would be variants of one product. |
| Scrapy scraper | Deferred (P3) | Distinct product, 65k stars, but only 4.3M downloads, and the real deliverable hits third-party sites; a verify against a local fixture server proves little about the real target. |
| Discord bot (discord.py) | Rejected | Can't reach a meaningful green verify without a bot token and Discord's servers, which breaks the no-credentials rule; unit tests alone don't prove the wiring. |
| Textual TUI | Deferred (P3) | A real distinct product (37.6k stars) with a good headless test story (`App.run_test`, snapshot testing), but a small audience for agent-started projects. Good candidate after the seven above. |
| Jupyter notebook project | Folded into `python-data` | As a decision; `.ipynb` files need extra tooling to lint and execute in verify. |
| ML training project (scikit-learn, PyTorch) | Deferred | GPU and platform scope, large downloads, slow verify. A `python-data` fragment with scikit-learn on CPU is the first step. |
| Dagster / Prefect pipeline | Deferred | Orchestrators on top of `python-data`; fragments later. |
| Python monorepo (uv workspaces) | Deferred | A structure, not a product; it's what `python-react` already is in part. |

## Open questions for the maintainer

1. `[build-system] requires` carries a version range by convention. The proposal has Setup add it rather than shipping it; confirm that's the reading of "no version literals" you want for `python-cli` and `python-library`.
2. `django-api` as a stack vs a `drf` fragment on `django`: this report argues stack. If you'd rather keep the count down, ship `django` first and decide after its bench run.
3. The FastAPI `postgres` fragment can't serve Django. A new `django-postgres` fragment is needed before either Django stack has a production database option.
4. `python-api` isn't in `agent-ops`'s settings-allow `stacks:when` list, though it ships `.claude/settings.json` allow rules. Possibly an oversight; worth a check, independent of this proposal.
5. The default dataframe library: Polars across `python-data` and `streamlit` keeps one choice in the catalog; pandas is more familiar to most users and agents. The report picks Polars with pandas as a decision.
