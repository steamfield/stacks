---
schema_version: 1
id: django
kind: stack
name: Django web app
description: A server-rendered Python web app on Django with its ORM, admin, forms, templates and migrations, managed with uv and make. pytest-django tests pages against a real database, structlog logs each request with an id, and gunicorn with whitenoise serves it.
tags: [python, web, make]
deps:
  runtime: [django, gunicorn, whitenoise, structlog, django-stubs-ext]
  dev: [ruff, mypy, django-stubs, pytest, pytest-django, pytest-cov, pytest-randomly, pytest-xdist, djlint]
tools: [uv, make, git, jq]
merge: [.claude/settings.json]
decisions:
  - "Python version: the newest stable CPython that Django, django-stubs, ruff and mypy support (default). Setup writes it to .python-version and requires-python."
  - "Database: SQLite in var/ (default), fine for one server. For Postgres, add psycopg, read the connection from env in config/env.py, run Postgres in Docker Compose for dev and tests, and keep the tests on that real database."
  - "User model: accounts.User, a subclass of AbstractUser (default). Keep it even if unused; swapping the user model after the first migration is painful."
  - "Interactivity: plain HTML forms with full-page responses (default). Add htmx (django-htmx) only when the user asks for partial updates."
  - "Packaging: an unpackaged application deployed as source, with no build backend (default)."
  - "Proving page: notes (title, body) with the add-note form (default), or the project's first real model with the same model, admin, form, view and test shape."
env:
  PORT_WEB: "8000"
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: typecheck, layer: typecheck, run: make typecheck }
  - { name: test, layer: test, run: make coverage }
  - { name: migrations, layer: check, run: make check-migrations }
  - { name: deploy-check, layer: check, run: make check-deploy }
  - { name: build, layer: build, run: make build }
  - name: web
    phase: serve
    layer: serve
    run: make start
    expect: { http: "http://127.0.0.1:${PORT_WEB}/healthz", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: uv sync (--locked when CI is set), then git hooks outside CI
  lint: ruff check + ruff format --check + djlint lint and format check on templates
  format: ruff format + ruff check --fix + djlint --reformat
  typecheck: mypy strict with the django-stubs plugin
  test: pytest (parallel) against the test database
  coverage: pytest with the branch coverage floor
  makemigrations: Write migrations for model changes
  check-migrations: Fail when a model change has no migration
  migrate: Apply migrations to the local database
  check-deploy: Django's deployment checks with production settings; warnings fail
  build: collectstatic into staticfiles/ with hashed, compressed files
  dev: Migrate, then the development server with reload on PORT_WEB
  start: Production settings - build, migrate, then gunicorn on PORT_WEB
  clean: Remove caches, coverage and collected static files
---

# Django web app

## What stacks wrote

A working Django project that passes every check once its dependencies are installed. `config/` holds `env.py` (every deployment setting read from the environment once, validated, failing fast by name; production refuses to start without `DJANGO_SECRET_KEY` or with DEBUG on), `settings.py`, `logging.py` (structlog over the standard library, readable in development and JSON on stdout in production), `urls.py`, `wsgi.py` and `gunicorn.py`. `core/` has the request middleware (request ids, one log line per request with the route pattern) and `/healthz`. `accounts/` is the custom user model with its admin. `notes/` is the payload: a `Note` model with its migration, admin, `ModelForm` and one view that lists notes and creates one through a POST-redirect-GET form with inline errors and a flash message, proving the ORM, migrations, forms, CSRF, templates, messages and static files end to end. `templates/` holds the base layout and the 404 and 500 pages. Unit tests sit beside `config/` and `notes/`; `tests/` drives pages through Django's test client on a real database. The Makefile, `pyproject.toml` tool config, `.env.example` and `docs/` ship too. Read the code before extending it.

## Setup

No generator. Use the shipped files; `pyproject.toml` has no `requires-python` because it carries a version.

1. `uv add` every runtime dependency, then `uv add --dev` every dev dependency, with `django-stubs[compatible-mypy]` so mypy resolves to a release the stubs support. Add `django` and `django-stubs` in the same project so the resolver keeps their majors together.
2. Record the chosen Python with `uv python pin` and set `project.requires-python` to match it (a lower bound only); ruff reads its target from there. Record Python, Django and uv versions in AGENTS.md.
3. `make install lint typecheck coverage check-migrations check-deploy build`. Update shipped code or config the installed releases reject, keeping every ruff rule, strict mypy, `filterwarnings = ["error"]`, the coverage floor and `--fail-level WARNING`. If `check-migrations` reports changes after a Django upgrade, run `make makemigrations` and commit the new migration; never edit the shipped ones.
4. Fill README's `stacks:fill` marker and the selected fragments' agent guidance. Run `stacks verify` until green.

## Layout and conventions

`docs/ARCHITECTURE.md` maps the request path, settings, data and logging; `docs/DEVELOPMENT.md` covers commands and tests.

- One app per feature, shaped like `notes/`: models, admin, forms, views, `urls.py` with an `app_name`, `templates/<app>/`, unit tests beside the code and page tests in `tests/`. Cross-cutting code goes in `core/`.
- Settings come only from `config/env.py::load`. A new one gets an `Env` field with a validated default, a `VARIABLES` entry, a test and a `.env.example` line.
- Every model change ships its generated migration in the same change. Shipped and committed migrations never change; a data migration starts from `makemigrations --empty <app>`. Point foreign keys at `settings.AUTH_USER_MODEL`.
- Validation lives in forms and models. Views declare their methods, redirect after a successful POST and re-render the bound form on errors. Querysets that templates loop over are sliced or paginated, with `select_related`/`prefetch_related` for relations.
- Log with `structlog.get_logger(__name__)` and fields, never bodies or secrets. The middleware already logs every request; Django's `django.request` logger keeps 5xx tracebacks.
- Generic Django classes are subscripted (`ModelForm[Note]`, `ModelAdmin[Note]`); `django_stubs_ext.monkeypatch()` in settings makes that work at runtime.
- `/healthz` stays database-free and exempt from the HTTPS redirect.

## Testing

`make coverage` (the verify test step) runs pytest-django with xdist, random order, warnings as errors and an 85% branch floor. Form and settings rules get unit tests beside their code. Each page gets test-client cases in `tests/` with `pytestmark = pytest.mark.django_db`: the GET, a successful POST and its redirect, each validation error, CSRF refusal and any admin page. Assert log lines with `structlog.testing.capture_logs`, passing `merge_contextvars` when the request id matters. `tests/test_django_guard.py` exercises the Claude hook when that adapter is present.

## Commands

The shipped Makefile (`make help`) holds every declared target. Mirror them and a single-file command (`uv run pytest tests/test_notes.py`) in AGENTS.md. `make start`, `make build` and `make check-deploy` run with production settings and a random throwaway secret key unless `DJANGO_SECRET_KEY` is set. `uv run python manage.py createsuperuser` makes an admin login.

<!-- stacks:when with=git-hooks -->
Write lefthook.yml before `make install`: the recipe calls lefthook only outside CI when its config and executable exist. pre-commit formats staged Python with ruff and re-stages fixes, then lints; pre-push runs `make test`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->
CI uses uv's setup action (cache on, Python from .python-version), then `make install lint typecheck coverage check-migrations check-deploy build` with CI set.
<!-- stacks:end -->

## Gotchas

- SQLite can't create the directory it lives in; `var/` ships with a `.gitkeep`. A `DJANGO_DB_PATH` elsewhere needs its directory first.
- Ruff's TC rules would move imports Django needs at runtime under `TYPE_CHECKING`. Keep the runtime-evaluated base classes; annotation-only imports (`HttpRequest`) may move.
- Ruff and mypy skip `*/migrations/`; generated code isn't reformatted or hand-fixed.
- The mypy plugin imports `config.settings`, so a settings error fails `make typecheck` first. Read it as a settings bug.
- Tests run with DEBUG off. Pages that render `{% static %}` work because only production uses the manifest storage; a manifest error in `make start` means `make build` didn't run.
- Close a whitenoise test response (`response.close()`) or the open file fails the run as a `ResourceWarning`; closing it touches the database, so mark that test `django_db`.
- `make start` binds 127.0.0.1 and turns the HTTPS redirect off for local HTTP. Behind a TLS proxy, set `DJANGO_BEHIND_TLS_PROXY=1` or every request redirects forever.
- `CommonMiddleware` rejects hosts outside `DJANGO_ALLOWED_HOSTS` with a 400, health probes included.
- gunicorn's own startup lines aren't JSON; they print before Django configures logging.
