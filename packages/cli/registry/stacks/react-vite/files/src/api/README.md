# Browser API boundary

Start with [client.ts](client.ts), the only app module that calls fetch. Every
API call goes through its `request` (any method, an optional JSON body) or
`get`. It decodes successful JSON with zod, resolves a 204 without reading a
body, logs metadata and raises typed failures; from a failed response it keeps
only the status and the `x-request-id` header. [errors.ts](errors.ts) defines
those failures, retry decisions and safe UI messages.

[notes.ts](notes.ts) combines the note schemas with TanStack Query options for
the list (`GET /v1/notes`, rows under `items` with a `nextCursor`) and detail
(`GET /v1/notes/:id`) requests. Paths name their API version themselves; the
base URL (`/api` by default) comes before them. Pages consume decoded values
through those options.
[query-client.ts](query-client.ts) configures bounded retries for transient errors.

The browser entry supplies the base URL and logger. Adjacent tests use the
MSW server in `../../tests/msw/server.ts` to exercise responses, decoding and
cancellation.

