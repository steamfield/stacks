# HTTP contract

The in-memory notes resource proves the boundary. It is erased on restart.

| Route | Response |
|---|---|
| GET /actuator/health | 200 with `{"status":"UP"}`, 503 when a health indicator is down |
| GET /v1/notes | 200 with `{"items":[...],"nextCursor":"..."}` |
| GET /v1/notes/{noteId} | 200 with a note, or 404 |
| POST /v1/notes | 201 with a note and `Location` pointing at its read route |

A note has `id`, `title` and `body`. Ids are opaque strings. Create takes
`title` and optional `body`, and rejects any other field. Titles must contain
a non-space character and at most 200 characters, and are stored trimmed;
bodies may contain up to 10,000. Every representation uses the same `Note`
record.

List takes `limit` (default 20, from 1 to 100) and an opaque `cursor`. Order
is creation order. Pass the returned `nextCursor` unchanged; it is omitted on
the last page. An unknown or repeated query parameter, a `limit` out of range
or not a number, and a cursor the server didn't issue are 400.

POST needs `Content-Type: application/json`; anything else is 415. Malformed
JSON, a missing or invalid field and an unknown field are 400.

Every error is `{"error":{"tag","message","retryable"}}`, with a fixed safe
message from the one table in `app.errors.ErrorCode`. The detail behind an
error is logged (debug for 4xx, error with the stack frames for 5xx), never
sent.

| Tag | Status | Retryable |
|---|---|---|
| BadInput | 400 | false |
| NotFound | 404 | false |
| MethodNotAllowed | 405 | false |
| NotAcceptable | 406 | false |
| UnsupportedMediaType | 415 | false |
| Internal | 500 | false |
| Unavailable | 503 | true |

A status Spring chooses that has no row of its own maps to BadInput for 4xx
and Internal for 5xx. A path no route declares is the 404 envelope. A wrong
method on a declared path is 405 with an `Allow` header listing the methods it
takes. Actuator's health response keeps Actuator's own body.

Responses are `application/json`, absent optional fields are omitted rather
than null, and a missing `Cache-Control` becomes `no-store`.

An incoming `X-Request-Id` of 1 to 128 letters, digits, `.`, `_` or `-` is
kept; otherwise the server generates a UUID. Either way the response carries
it and every log record of the request has it as `requestId`.
