# Development

Use the shipped pyproject.toml. Add the stack's runtime dependencies with uv add
(uvicorn with its standard extra), and dev dependencies with uv add --dev.
Record Python in .python-version and requires-python, and set ruff's target-version.
The project is an unpackaged application; do not add a build backend.

Run `make install lint typecheck coverage openapi check-openapi`. The lockfile and
generated OpenAPI document belong in git. Install uses uv sync --locked in CI.
`make dev` reloads the app; `make start` runs without reload. Both disable Uvicorn
access logging so the middleware emits one request record.

Copy .env.example to .env for local settings. ENVIRONMENT accepts development,
test and production; LOG_LEVEL accepts DEBUG, INFO, WARNING, ERROR and CRITICAL.
Invalid values fail startup. Env overrides .env; explicit Settings overrides both.
Unrelated .env keys are ignored. PORT_API defaults to 8000 in Make; API_HOST defaults
to 127.0.0.1. Export these variables to change the listener.

Unit tests sit beside config and the store; the HTTP suite is tests/test_http.py.
`uv run pytest tests/test_http.py` runs that file. `make test` uses random ordering
and xdist; `make coverage` enforces an 80% branch-aware floor. Use TEST_WORKERS=2
on shared machines. Tests isolate config and create one fresh lifespan/store per client.

The HTTP suite covers create/read/paging, invalid input, route/method misses,
dependency failure, response encoding, unexpected errors, ids, logs, cache policy
and OpenAPI. Keep strict mypy, ruff's rules and warnings-as-errors when adapting to
dependency releases. `make format` applies safe fixes; `make clean` removes caches
and coverage output.
