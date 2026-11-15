# Browser API boundary

Start with [client.ts](client.ts), the only app module that calls fetch. It
decodes successful JSON with zod, logs metadata and raises typed failures.
[errors.ts](errors.ts) defines those failures, retry decisions and safe UI
messages.

[items.ts](items.ts) combines resource schemas with TanStack Query options for
list and detail requests. Pages consume decoded values through those options.
[query-client.ts](query-client.ts) configures bounded retries for transient errors.

The browser entry supplies the base URL and logger. Adjacent tests use the
MSW server in `../../tests/msw/server.ts` to exercise responses, decoding and
cancellation.

