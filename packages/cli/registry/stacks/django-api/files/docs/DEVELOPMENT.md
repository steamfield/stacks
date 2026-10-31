# Development

`make install` syncs the environment from `uv.lock` (`--locked` in CI). Add packages with
`uv add` (`uv add --dev` for tools), never pip.

`make dev` migrates `var/db.sqlite3` and runs Django's development server with DEBUG on. `make
start` runs what production runs: `collectstatic` into `staticfiles/` (the admin's files),
`migrate`, then gunicorn with `DJANGO_ENV=production`, over plain HTTP (it sets
`DJANGO_SECURE_SSL_REDIRECT=0` unless you set it). Both listen on `API_HOST:PORT_API`, default
`127.0.0.1:8000`.

Without `DJANGO_SECRET_KEY`, the production-settings targets (`start`, `build`, `check-deploy`)
generate a random key per command, so admin sessions don't survive a restart. Export a real key
to keep them.

## Checks

| Target | What it runs |
|---|---|
| `make lint` | ruff check and ruff format --check |
| `make typecheck` | mypy strict with the django-stubs and DRF stubs plugins, which import `config.settings` |
| `make test` | pytest with pytest-django, xdist and random order; warnings are errors |
| `make coverage` | the same with an 85% branch-coverage floor |
| `make check-migrations` | `makemigrations --check --dry-run`: fails when a model has no migration |
| `make openapi` | `spectacular --validate --fail-on-warn` into `openapi.json` |
| `make check-openapi` | the same into a temporary file, compared with `openapi.json` as parsed JSON |
| `make check-deploy` | `check --deploy --fail-level WARNING` with production settings |
| `make build` | `collectstatic` with whitenoise's compressed manifest storage |

One test file: `uv run pytest tests/test_notes_api.py`. One test: add `-k <name>`. Use
`TEST_WORKERS=2` on a shared machine.

## Tests

Unit tests sit beside the code (`config/test_env.py`, `core/test_errors.py`,
`notes/test_serializers.py`); API tests are in `tests/` and use DRF's `APIClient` (the `api`
fixture) against the test database (`pytestmark = pytest.mark.django_db`).
`tests.assertions.assert_error` checks an error's status, envelope and headers.
`tests/urls_failing.py` adds a view that raises, for the 500 test. Assert logs with
`structlog.testing.capture_logs`.
