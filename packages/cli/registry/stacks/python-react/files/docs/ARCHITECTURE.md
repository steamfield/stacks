# Architecture

The root Makefile coordinates two independent projects. FastAPI's factory mounts
routers through `backend/app/routers.py`; the lifespan owns the in-memory NoteStore.
Replace that store at the dependency boundary when adding persistence. `/health`
does not touch it. No routes connect to a database or another service on import.

Settings validates environment values. Structlog emits JSON outside development.
The request middleware sanitizes ids and correlates a single completion log,
including unexpected failures, without logging bodies or query values. Error handlers
serialize requestId on the wire from Python's request_id field. The same model
documents error responses in OpenAPI; the HTTP tests cover 404, 422 and 500.

The SPA provides one QueryClient for the mounted application. The home route calls
the generated health client through `app/lib/health.ts`, which validates the result
using orval's zod schema. `app/lib/api.ts` prefixes the configured API origin and
maps non-success responses into ApiError. The root error boundary handles route
failures without displaying exception details.

`make generate-api` writes the spec, typed hooks, MSW handlers and zod schemas.
`make check-api` checks spec drift as parsed JSON. Generated clients stay committed;
regenerate them after a route or schema edit. No generated version metadata ships
in stacks: Setup produces it from the installed tools.
