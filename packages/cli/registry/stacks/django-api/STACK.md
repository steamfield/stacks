---
schema_version: 1
id: django-api
kind: stack
name: Django REST API (DRF)
description: A Python JSON API on Django and Django REST Framework with no server-rendered pages, managed with uv and make. Django's ORM, migrations and admin hold the data, one error envelope covers every failure, drf-spectacular's committed OpenAPI schema has a drift check, and pytest-django drives the API client against a real database.
tags: [python, api, make]
deps:
  runtime: [django, djangorestframework, drf-spectacular, gunicorn, whitenoise, structlog, django-stubs-ext]
  dev: [ruff, mypy, django-stubs, djangorestframework-stubs, pytest, pytest-django, pytest-cov, pytest-randomly, pytest-xdist]
tools: [uv, make, git, jq]
merge: [.claude/settings.json]
decisions:
  - "Python version: the newest stable CPython that Django, DRF, the stubs, ruff and mypy support (default). Setup writes it to .python-version and requires-python."
  - "API framework: Django REST Framework with drf-spectacular (default). Django Ninja (pydantic schemas, typed views) on request: same layout, error table and checks, with Ninja's schema export replacing spectacular."
  - "Database: SQLite in var/ (default), fine for one server. For Postgres, add psycopg, read the connection from env in config/env.py, run Postgres in Docker Compose for dev and tests, and keep the tests on that real database."
  - "Auth: none (default). Session auth for a same-origin browser client, or token auth, goes in REST_FRAMEWORK's authentication and permission classes with tests for 401 and 403."
  - "Resource path prefix: /v1 (default), with /healthz, /openapi.json and /admin/ outside it."
  - "Browsable API: off (default; JSON renderer only). Add DRF's BrowsableAPIRenderer for DEBUG only if the user asks."
  - "Proving resource: notes (title, body) with list, create and read (default), or the project's first real resource with the same model, serializer, viewset and test shape."
env:
  PORT_API: "8000"
fragments:
  default: [agent-ops, git-hooks, ci-github, rest-api]
  optional: [docker-deploy, rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: typecheck, layer: typecheck, run: make typecheck }
  - { name: test, layer: test, run: make coverage }
  - { name: migrations, layer: check, run: make check-migrations }
  - { name: openapi-drift, layer: check, run: make check-openapi }
  - { name: deploy-check, layer: check, run: make check-deploy }
  - { name: build, layer: build, run: make build }
  - name: api
    phase: serve
    layer: serve
    run: make start
    expect: { http: "http://127.0.0.1:${PORT_API}/healthz", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: uv sync (--locked when CI is set), then git hooks outside CI
  lint: ruff check + ruff format --check
  format: ruff format + ruff check --fix
  typecheck: mypy strict with the Django and DRF plugins
  test: pytest (parallel) against the test database
  coverage: pytest with the branch coverage floor
  makemigrations: Write migrations for model changes
  check-migrations: Fail when a model change has no migration
  migrate: Apply migrations to the local database
  openapi: Write the API's OpenAPI schema to openapi.json; schema warnings fail
  check-openapi: Fail if openapi.json no longer matches the API (run make openapi)
  check-deploy: Django's deployment checks with production settings; warnings fail
  build: collectstatic for the admin's static files
  dev: Migrate, then the development server with reload on PORT_API
  start: Production settings - build, migrate, then gunicorn on PORT_API
  clean: Remove caches, coverage and collected static files
---

# Django REST API (DRF)

## What stacks wrote

A working Django REST Framework API that passes every check once its dependencies are installed and its schema is generated. `config/` holds `env.py` (every deployment setting read from the environment once, validated, failing fast by name; production refuses to start without `DJANGO_SECRET_KEY` or with DEBUG on), `settings.py` (DRF set to JSON only with no sign-in yet, the error handler and drf-spectacular), `logging.py` (structlog, readable in development and JSON on stdout in production, exceptions as class and frames with no message), `urls.py`, `wsgi.py` and `gunicorn.py`. `core/` has the error table and DRF exception handler (`errors.py`), the bases every resource uses (`api.py`: a serializer that refuses unknown fields, `?limit=&cursor=` pages, a viewset that refuses unknown query parameters, the schema class documenting the error body), the request middleware (request ids, one log line per request with the route pattern, `Cache-Control: no-store` by default), `/healthz` and JSON handlers for 400, 403, 404 and 500 outside DRF. `accounts/` is the custom user model. `notes/` is the payload: a model with its migration and admin, a serializer and a viewset with list, create and read under `/v1/notes`. Unit tests sit beside `config/`, `core/` and `notes/`; `tests/` drives the API through DRF's test client on a real database. The Makefile, `pyproject.toml` tool config, `.env.example` and `docs/` ship too. Read the code before extending it.

## Setup

No generator. Use the shipped files; `pyproject.toml` has no `requires-python` because it carries a version.

1. `uv add` every runtime dependency, then `uv add --dev` every dev dependency, with `django-stubs[compatible-mypy]` so mypy resolves to a release the stubs support. Add `django`, `djangorestframework` and both stubs packages in one project so the resolver keeps their majors together.
2. Record the chosen Python with `uv python pin` and set `project.requires-python` to match it (a lower bound only). Set ruff's `target-version` to that Python. Record Python, Django, DRF and uv versions in AGENTS.md.
3. `make openapi`, then commit `openapi.json`. Setup generates it because it records the installed generator's output; `make check-openapi` compares parsed JSON.
4. `make install lint typecheck coverage check-migrations check-openapi check-deploy build`. Update shipped code or config the installed releases reject, keeping every ruff rule, strict mypy, `filterwarnings = ["error"]`, the coverage floor, `--fail-on-warn` and `--fail-level WARNING`. If `check-migrations` reports changes after a Django upgrade, run `make makemigrations` and commit the new migration; never edit the shipped ones.
5. Fill README's `stacks:fill` marker and the selected fragments' agent guidance. Run `stacks verify` until green.

## Layout and conventions

`docs/ARCHITECTURE.md` maps the request path, settings, data and logging; `docs/http-api.md` is the HTTP contract; `docs/DEVELOPMENT.md` covers commands and tests.

- One app per resource, shaped like `notes/`: model, admin, `serializers.py`, `views.py` with a viewset, `urls.py` with a router, unit tests beside the code and API tests in `tests/`. Mount the app under `v1/` in `config/urls.py`. Cross-cutting code goes in `core/`.
- Serializers subclass `core.api.ResourceSerializer`, list `fields` explicitly, use camelCase wire names with `source=` and own validation. Viewsets subclass `core.api.ResourceViewSet` with only the mixins the resource supports; DRF answers other methods with 405 and `Allow`. Path params are named for the resource (`noteId`). Business logic beyond persistence goes in a module the view calls, not in `save()`.
- Raise DRF exceptions or `core.errors.AppError("<tag>")`; never build an error `Response` by hand. A new status needs an `ERRORS` row and a test.
- Settings come only from `config/env.py::load`. A new one gets an `Env` field with a validated default, a `VARIABLES` entry, a test and a `.env.example` line.
- Every model change ships its generated migration in the same change. Committed migrations never change.
- Every API change regenerates `openapi.json` with `make openapi` in the same change. A schema warning is a failure: annotate with `extend_schema` rather than dropping `--fail-on-warn`.
- Log with `structlog.get_logger(__name__)` and fields, never bodies or secrets. The middleware already logs every request.
- `/healthz` stays database-free and exempt from the HTTPS redirect.

## Testing

`make coverage` (the verify test step) runs pytest-django with xdist, random order, warnings as errors and an 85% branch floor. Serializer and settings rules get unit tests beside their code. Give each endpoint test-client cases in `tests/` with `pytestmark = pytest.mark.django_db`: success, each validation error, 404, the wrong method, and the envelope through `tests.assertions.assert_error`. Assert log lines with `structlog.testing.capture_logs`. `tests/test_django_api_guard.py` exercises the Claude hook when that adapter is present.

## Commands

The shipped Makefile (`make help`) holds every declared target. Mirror them and a single-file command (`uv run pytest tests/test_notes_api.py`) in AGENTS.md. `make start`, `make build` and `make check-deploy` run with production settings and a random throwaway secret key unless `DJANGO_SECRET_KEY` is set.

<!-- stacks:when with=git-hooks -->
Write lefthook.yml before `make install`: the recipe calls lefthook only outside CI when its config and executable exist. pre-commit formats staged Python with ruff and re-stages fixes, then lints; pre-push runs `make test`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->
CI uses uv's setup action (cache on, Python from .python-version), then `make install lint typecheck coverage check-migrations check-openapi check-deploy build` with CI set.
<!-- stacks:end -->
<!-- stacks:when with=rest-api -->
The notes resource already follows the REST rule. Record /v1, the tag/message/retryable envelope (`core/errors.py`), cursor limits (20 default, 100 maximum), 400 for unknown fields and query parameters, 415 for non-JSON bodies and 405 with Allow in AGENTS.md. Keep those contracts when adding resources.
<!-- stacks:end -->
<!-- stacks:when with=docker-deploy -->
**Image.** One root `Dockerfile`, built as docker-deploy's Python section says and served by gunicorn: `CMD ["gunicorn", "-c", "config/gunicorn.py"]` with `DJANGO_ENV=production`, `API_HOST=0.0.0.0` and `PORT_API` set and that port exposed. The build stage runs `python manage.py collectstatic --noinput` with `DJANGO_ENV=production` and a throwaway `DJANGO_SECRET_KEY` on that `RUN` line only (the real key comes from the runtime environment); the runtime stage copies `staticfiles/`, which whitenoise serves. Migrations are a release step (`docker run --rm --env-file .env <image> python manage.py migrate --noinput` before the new image takes traffic), never in `CMD`. SQLite lives on a mounted volume (`DJANGO_DB_PATH=/data/db.sqlite3`, the directory owned by the image's uid), one container at a time. The health check requests `/healthz` with Python's `urllib`, sending the first `DJANGO_ALLOWED_HOSTS` entry (default `localhost`) as the `Host` header, since Django answers other hosts with a 400. `.dockerignore` also excludes `tests/`, `var/`, `staticfiles/` and `openapi.json`.

Prove the image with `make docker-build`, then run it with a mounted data directory, `DJANGO_SECRET_KEY` set and the migrate release step first, and wait for its health check to report healthy. Record the release step in AGENTS.md.
<!-- stacks:end -->

## Gotchas

- DRF's typing is looser than its stubs suggest: `validated_data` is `dict[str, Any]`. Convert it to a typed value before business logic uses it.
- The DRF stubs make serializers and viewsets generic (`ResourceSerializer[Note]`); DRF's classes accept the subscript at runtime.
- Django renders 404 and 500 through `config/urls.py`'s handlers only with DEBUG off. `make dev` shows Django's debug pages instead; tests run with DEBUG off.
- An unexpected exception is logged by `django.request` with frames and no message, and answered with the generic 500 envelope.
- drf-spectacular turns a viewset docstring into every operation's description, and `--fail-on-warn` fails on a `SerializerMethodField` or custom action it can't type. Comment instead of docstring, and annotate with `extend_schema_field` or `extend_schema`.
- DRF's `CursorPagination` falls back to the default page on a bad `limit` and reads junk like `?cursor=!` as the first page; `core.api.CursorPage` turns both into a 400. Keep its checks when changing pagination.
- Ruff and mypy skip `*/migrations/`; generated code isn't reformatted or hand-fixed.
- The mypy plugin imports `config.settings`, so a settings error fails `make typecheck` first.
- `make start` binds 127.0.0.1 and turns the HTTPS redirect off for local HTTP. Behind a TLS proxy, set `DJANGO_BEHIND_TLS_PROXY=1` or every request redirects forever.
- `CommonMiddleware` rejects hosts outside `DJANGO_ALLOWED_HOSTS` with the 400 envelope, health probes included.
