# HTTP contract

`GET /healthz` returns `{"status":"ok"}` without a database dependency.
`POST /v1/notes` accepts a title (trimmed, 1 to 200 characters) and optional body
(at most 10000 characters). It returns 201, the note and Location.
`GET /v1/notes/{noteId}` returns the same shape: id, title, body and createdAt
(UTC). Unknown ids return 404. There is no authentication in the slice.

`GET /v1/notes?limit=20&cursor=...` returns items and optional nextCursor.
The maximum limit is 100; ordering is createdAt then id. Unknown query parameters,
invalid cursors and invalid bodies return 400. Undeclared input fields are rejected.
Non-JSON bodies return 415. Wrong methods return 405 with Allow; unknown paths
return 404. The API does not redirect trailing slashes.

Every error is `{"error":{"tag":"NotFound","message":"Resource not found.","retryable":false}}`.
The table in app/errors.py owns all statuses and messages. Unavailable is a
retryable 503; Internal is a generic 500. Input values and exception messages do
not appear in errors. Request ids travel in X-Request-ID, not the error body.

API responses default to Cache-Control: no-store. Endpoint policies are preserved;
304 responses receive no added cache policy. Request ids accept ASCII letters,
digits, underscores and hyphens, at most 64 characters; other values are replaced.
Logs contain route patterns and duration_ms.

`make openapi` creates sorted openapi.json. Commit it after Setup and whenever
routes or schemas change. `make check-openapi` compares parsed JSON with the app.
FastAPI's built-in documentation remains at /docs and /openapi.json.
