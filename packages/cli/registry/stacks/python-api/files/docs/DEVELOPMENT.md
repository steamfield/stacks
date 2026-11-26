# Development

Use the shipped pyproject.toml. Add the stack's runtime dependencies with uv add
(uvicorn with its standard extra), and dev dependencies with uv add --dev.
Record Python in .python-version (`uv python pin`) and requires-python; ruff takes
its target version from requires-python. The project is an unpackaged application;
do not add a build backend.

Run `make install ci`. The lockfile and generated OpenAPI document belong in git.
Install uses uv sync --locked in CI. `make audit` checks the locked dependencies
against known vulnerabilities with pip-audit, a dev dependency locked in uv.lock;
it needs the network for the vulnerability database.

`make dev` reloads the app; `make start` runs without reload. Both disable Uvicorn
access logging so the middleware emits one request record. `make dev-bg` runs
`make dev` in the background for agents and scripts: it writes the server's output
to logs/dev.log and the process group to logs/dev.pid, and returns once /healthz
answers. A second `make dev-bg` reuses that server; it refuses a port answered by a
server it didn't start. `make dev-stop` stops the whole process group. Uvicorn's reload supervisor and its worker are
separate processes, so stopping only one pid leaves the port taken.

Copy .env.example to .env for local settings. ENVIRONMENT accepts development,
test and production; LOG_LEVEL accepts DEBUG, INFO, WARNING, ERROR and CRITICAL.
Invalid values fail startup. Env overrides .env; explicit Settings overrides both.
Unrelated .env keys are ignored. PORT_API defaults to 8000 in Make; API_HOST defaults
to 127.0.0.1. Export these variables to change the listener.

Unit tests sit beside config and the store; the HTTP suite is tests/test_http.py.
`uv run pytest tests/test_http.py` runs that file and
`uv run pytest tests/test_http.py::test_health` one test. `make test` uses random
ordering and xdist; `make coverage` enforces an 80% branch-aware floor. Use
TEST_WORKERS=2 on shared machines. Tests isolate config and create one fresh
lifespan/store per client.

The HTTP suite covers create/read/paging, invalid input, route/method misses,
dependency failure, response encoding, unexpected errors, ids, logs, cache policy
and OpenAPI. Keep strict mypy, ruff's rules and warnings-as-errors when adapting to
dependency releases. `make format` applies safe fixes; `make clean` removes caches
and coverage output.
