# HTTP contract

The in-memory notes resource proves the boundary. It is erased on restart.

| Route | Response |
|---|---|
| GET /healthz | 200 with `{"status":"ok"}`; never touches the store |
| GET /v1/notes | 200 with `{"items":[...],"nextCursor":"..."}` |
| GET /v1/notes/{noteId} | 200 with a note, or 404 |
| POST /v1/notes | 201 with a note and `Location` pointing at its read route |

A note has `id`, `title` and `body`. Ids are opaque strings. Create takes
`title` and optional `body`, and rejects any other field. Titles are trimmed
and must contain 1 to 200 characters; bodies may contain up to 10,000. Every
representation uses the same `Note` type.

List takes `limit` (default 20, from 1 to 100) and an opaque `cursor`. Order
is creation order. Pass the returned `nextCursor` unchanged; it is omitted on
the last page. Unknown, duplicate, empty or malformed query values are 400.

POST needs `Content-Type: application/json`. Bodies over 1 MiB are 413.
Malformed JSON, a wrong field type and an unknown field are 400.

Every error is `{"error":{"tag","message","retryable"}}`, with a fixed safe
message from the one table in `ApiError::row` (`src/error.rs`). The detail
behind an error is logged (debug for 4xx, error for 5xx), never sent.

| Tag | Status | Retryable |
|---|---|---|
| BadInput | 400 | false |
| NotFound | 404 | false |
| MethodNotAllowed | 405 | false |
| PayloadTooLarge | 413 | false |
| UnsupportedMediaType | 415 | false |
| Internal | 500 | false |
| Unavailable | 503 | true |

A path no route declares is the 404 envelope. A wrong method on a declared
path is 405 with an `Allow` header listing the methods it takes. A GET route
also answers HEAD, without a body. A handler still running after
`REQUEST_TIMEOUT_SECS` is cancelled and answered 503; a panicking handler is
answered 500 and the panic is logged.

Responses are `application/json`, and a missing `Cache-Control` becomes
`no-store`.

Middleware, outermost first (`app::layer`): request id, its echo on the
response, the access log, panic recovery, `Cache-Control`, the request
timeout and the body limit. An incoming `X-Request-Id` is kept; otherwise the
server generates a UUID. Either way the response carries it. Each request logs
one record when it finishes, with `method`, `route` (the pattern, such as
`/v1/notes/{noteId}`, never the raw path or query), `request_id`, `status`
and `latency`. Bodies and query values are never logged.
