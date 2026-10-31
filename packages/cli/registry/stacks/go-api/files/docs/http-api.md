# HTTP contract

The in-memory notes resource proves the boundary. It is erased on restart.

| Route | Response |
|---|---|
| GET /healthz | 200 with `{"status":"ok"}`; never touches the store |
| GET /v1/notes | 200 with `{"items":[...],"nextCursor":"..."}` |
| GET /v1/notes/{noteId} | 200 with a note, or 404 |
| POST /v1/notes | 201 with a note and Location pointing at its read route |

A note has `id`, `title`, `body` and `createdAt`. Ids are opaque strings;
timestamps are RFC 3339 UTC. Create takes `title` and optional `body`.
Titles are trimmed and must contain 1 to 200 Unicode characters; bodies may
contain up to 10,000. Every representation uses the same Note type.

List takes `limit` (default 20, maximum 100) and an opaque `cursor`. Order is
creation time, then id. Use the returned nextCursor unchanged; it is omitted
on the last page. Unknown, duplicate, empty or malformed query values are 400.

POST requires application/json, allowing media-type parameters. The decoder
caps the entire body at 1 MiB, rejects unknown fields, trailing JSON or junk,
and non-object inputs. Decode failures are 400; a body over the cap is 413.

Every error is `{"error":{"tag","message","retryable"}}`, with a fixed
safe message from the one table in `internal/httpapi/response.go`.

| Tag | Status | Retryable |
|---|---|---|
| BadInput | 400 | false |
| NotFound | 404 | false |
| MethodNotAllowed | 405 | false |
| PayloadTooLarge | 413 | false |
| UnsupportedMediaType | 415 | false |
| Internal | 500 | false |
| Unavailable | 503 | true |

Responses use application/json and fill missing Cache-Control with no-store.
Mux misses keep the standard library's 404 or 405 decision and Allow header.
A GET route also accepts HEAD, with no response body.

Middleware runs request id, access log, panic recovery, then mux. An incoming
X-Request-Id of 1 to 64 ASCII letters, digits, hyphens or underscores is echoed;
otherwise the server generates 16 random bytes as hex. The id lives in the
request context. Each access record contains method, route pattern, status,
duration_ms, bytes and request_id; health probes log at debug. Query values
and payloads are absent from access logs. Causes stay in error logs. Recovery
logs the panic and stack, sends Internal before a response starts, or aborts
the connection after a response has started. It re-panics http.ErrAbortHandler.
