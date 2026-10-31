# OpenRouter wire contract

What the provider boundary and its tests rely on. Checked against OpenRouter's API reference (errors, streaming, models, usage accounting, provider routing); re-check there when a client or the API changes.

## Requests

- Base URL: `https://openrouter.ai/api/v1` (`OPENROUTER_BASE_URL` overrides it; tests use `stub.baseUrl`).
- Routing goes in the chat request body: `models` (fallback model ids, tried in order) and `provider: { sort, allow_fallbacks, data_collection, zdr }`. `sort` is `price`, `throughput` or `latency`; `data_collection` is `allow` or `deny`.
- Attribution headers: `X-OpenRouter-Title` (the older `X-Title` is still accepted) set to the project name, and `HTTP-Referer` set to `OPENROUTER_SITE_URL` when it's configured. `@effect/ai-openrouter` takes them as `siteTitle` and `siteReferrer` on the client; the AI SDK provider takes `headers`.
- Usage, including `cost`, comes back on every response. On a stream it arrives once, on the last chunk before `data: [DONE]`, which repeats the finish reason. `usage: { include: true }` and `stream_options.include_usage` are deprecated and have no effect: don't send them and don't assert them in tests. Assert that usage and cost are read from the response.

## Models

`GET /models` needs no key. With neither `limit` nor `offset` it returns the full list; with them it returns one page, `total_count` and `links.next` (null on the last page). A paging client follows `links.next`, and its test uses more models than one page. Model ids are `<author>/<model>`: the prefix is the author, not the provider that serves a request; the serving provider and model come back on each response (`provider`, `model`), which is how a fallback shows.

## Errors

The body is `{ "error": { "code", "message", "metadata"? } }`; the HTTP status matches `code` for request-level failures.

| Status | Meaning | Retry |
| --- | --- | --- |
| 400 | Invalid request or parameters (an unknown model id is a 400) | No |
| 401 | Missing, invalid or disabled key | No |
| 402 | Not enough credits on the account or key; say to add credits or raise the key limit | Only when it carries `Retry-After` |
| 403 | Moderation flag or guardrail block; `metadata.reasons` and `flagged_input` explain it. Say the request was blocked; log the reasons, never the input | No |
| 404 | No provider can serve the model under the account's or request's provider list | No |
| 408 | Request timed out | Yes |
| 429 | Rate limited; honor `Retry-After` (seconds) | Yes |
| 502 | The model is down or returned an invalid response | Yes |
| 503 | No provider meets the routing requirements | No while `zdr`, `data_collection: deny` or a provider `only` list is set (every retry fails the same way); otherwise yes, honoring `Retry-After` |

Context overflow is a 400 and not retryable. Other 5xx, network failures and timeouts are retryable.

A 200 is not success by itself:

- A non-streaming response can be a 200 whose body holds `error` and no `choices`.
- A stream can end with a chunk holding a top-level `error` (with `metadata.error_type`) and a choice with `finish_reason: "error"`, after some text has already arrived. `@effect/ai-openrouter` emits this as an `error` part instead of failing the stream; the AI SDK surfaces it as a stream error.

Treat both as a failure of that request, keep any partial reply marked as interrupted, and classify it by `error.code` like the table above.

## Streams

Chunks are `data: <json>` server-sent events ending with `data: [DONE]`. OpenRouter also sends comment lines (`: OPENROUTER PROCESSING`) to keep the connection open; a hand-written parser skips lines that start with `:`. `system_fingerprint` is present only when the provider supports it, but `@effect/ai-openrouter` requires a string on every chunk, so the stub always sends one.

## The stub

`tests/helpers/stub-openrouter.ts` implements the above for tests: start it with `startStubOpenRouter()` on an ephemeral port in `beforeAll`, `reset()` it in `beforeEach`, `close()` it in `afterAll`, and point the client at `stub.baseUrl`. Script it per test with `toolCalls`, `replies`, `servedModels`, `failCompletions(status, { retryAfter, metadata, times })`, `streamError(code, { afterDeltas })`, `dropAfter(n)`, `hangAfter(n)` and `replay(bodies, { chunkSize })`; read what it received from `chatRequests` and `chatHeaders`.

Cover with it: pagination, the models cache, unknown ids, the missing key, empty optional config, each error class above with its retry decision, `Retry-After`, both 200-with-error shapes, dropped and hung streams, routing payloads, attribution headers, and usage and cost. When a client needs a field the stub lacks, extend the stub and add a case to `tests/openrouter-stub.test.ts`. Keep a string `system_fingerprint` on every chunk, the `cost_details` prompt/completions split and the canonical `metadata.error_type` values: strict clients fail without them.
