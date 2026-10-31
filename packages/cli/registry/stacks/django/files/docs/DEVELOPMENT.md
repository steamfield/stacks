# Development

`make install` syncs the environment from `uv.lock` (`--locked` in CI). Add packages with
`uv add` (`uv add --dev` for tools), never pip.

`make dev` migrates `var/db.sqlite3` and runs Django's development server with DEBUG on. Static
files come straight from `static/` and each app's `static/`. `make start` runs what production
runs: `collectstatic` into `staticfiles/`, `migrate`, then gunicorn with `DJANGO_ENV=production`,
over plain HTTP (it sets `DJANGO_SECURE_SSL_REDIRECT=0` unless you set it). Both listen on
`WEB_HOST:PORT_WEB`, default `127.0.0.1:8000`.

Without `DJANGO_SECRET_KEY`, the production-settings targets (`start`, `build`, `check-deploy`)
generate a random key per command, so sessions don't survive a restart. Export a real key to keep
them.

## Checks

| Target | What it runs |
|---|---|
| `make lint` | ruff check, ruff format --check, djlint --lint and --check over templates |
| `make typecheck` | mypy strict with django-stubs' plugin, which imports `config.settings` |
| `make test` | pytest with pytest-django, xdist and random order; warnings are errors |
| `make coverage` | the same with an 85% branch-coverage floor |
| `make check-migrations` | `makemigrations --check --dry-run`: fails when a model has no migration |
| `make check-deploy` | `check --deploy --fail-level WARNING` with production settings |
| `make build` | `collectstatic` with whitenoise's compressed manifest storage |

One test file: `uv run pytest tests/test_notes.py`. One test: add `-k <name>`. Use
`TEST_WORKERS=2` on a shared machine.

## Tests

Unit tests sit beside the code (`config/test_env.py`, `notes/test_forms.py`); page tests are in
`tests/` and use Django's test client against the test database (`pytestmark =
pytest.mark.django_db`). `tests/urls_failing.py` adds a view that raises, for the 500 page test.
Assert logs with `structlog.testing.capture_logs`.
