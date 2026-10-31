# Effect HTTP API

Everything under `src/` is Effect. This rule says what the code must do; the installed Effect release says how. Resource naming and status codes are in `docs/guidance/rest-api/rest-api.md`.

## Finding the API for the installed release

Effect's module names, helpers and defaults change between majors, and examples online mix them. Before writing Effect code:

1. Read the installed version (`node_modules/effect/package.json`) and work only from that major.
2. Read the Effect API reference, `docs/guidance/effect/api.md`, when it exists: it was written against the installed release and records its names and traps.
3. Treat the installed type declarations and their doc comments (`node_modules/effect/dist/**/*.d.ts`) as the authority, and the package's compiled source when behavior matters (how a failure is surfaced, what a default does). Effect's own documentation and changelog for that major come next; an example from another major, a blog post or memory comes last.
4. When a name in a skill or a doc doesn't exist in the declarations, find the concept there instead of adding a shim, and correct the skill.
5. Behavior this rule depends on is pinned by tests (below). After an Effect upgrade, a failing one of those tests means the mechanism moved: find the new one, don't loosen the test.

## The API definition

- `src/api.ts` composes the API from one group per resource, each in `src/api/<resource>.ts`: the variable is `<Name>Group`, the group identifier the singular `<Name>` (`OrderGroup`, `"Order"`, in `src/api/orders.ts`). That one declaration is the router, the request decoder, the response encoder and the OpenAPI document. An endpoint declares its path params, query, payload, success and errors as schemas; nothing is decoded by hand in a handler.
- `src/handlers/<resource>.ts` implements its group, one handler per endpoint. A handler reads its decoded input, calls a domain program or service, and returns the success value. No business logic, no SDK calls, no environment reads, no status picking.
- `app.ts` exports the platform-free app (the api, every group's handlers and `AppLayer`) and the request middleware. It imports nothing platform-specific; `src/platform/node.ts` serves it. A route that only works under one platform entry is a leak: fix the core instead.
- A success status that isn't 200 is declared on the success schema, never by building a response by hand. A create returns the resource with 201 and a `location` header, both declared; a delete with nothing to return is 204. Check which status helpers in the installed release carry a body and which are body-less. Returning a raw response from a handler bypasses the encoder and the OpenAPI document; do it only for streaming or files, and say why.
- Unknown query params are rejected through the API's parse options. Scope that option to query parameters: applied to headers, it rejects every real request.

## The request boundary

One request middleware in `app.ts` owns the `x-request-id`, the `request` log line, the defect log and the error envelope. It must see every response, so install it at server level wherever the app is served (the Node entry and the web-handler test), not on a route. A route-level middleware never sees misses or responses the framework builds before a handler runs. Turn the framework's own request logger off in each of those places, or calls log twice and a defect's message reaches the log.

Response rewriting must happen before the transport sends headers/body. Mapping a response returned by middleware after sending is too late. Check the installed router/server declarations for pre-response hooks or middleware that can still change the wire response, and record the verified mechanism in `docs/guidance/effect/api.md`. The same HTTP matrix must prove the actual response on both transports.

The envelope rules, each pinned by a test:

- A request that fails to decode (params, query, headers, payload) gets the 400 envelope.
- A response that fails to encode is the server's bug: a defect, the generic 500.
- A response the framework produces itself (unsupported media type, payload too large, route not found) is rewritten into the envelope with the same status. Don't re-implement those checks by hand.
- A wrong method on a declared path is a route miss: the 404 envelope.

How the installed release surfaces a decode failure (a typed failure, or a defect carrying a framework error class) is a detail to read in its source, not assume: inspect the whole cause in the middleware, map only request-side decode errors to 400, and leave everything else a defect.

## Services and the runtime

- A service is a `Context` service class in `src/services/` with its layers as statics (a live layer, plus an in-memory one when tests need fresh state), added to `AppLayer`. Its key is namespaced (`<project>/<Name>`).
- Service methods return Effects with no remaining requirements: yield dependencies once in the layer constructor, not in each method. A service depends on another through the context, never by providing the other's layer itself.
- The server builds `AppLayer` once. Never provide a layer in a handler or per request: that builds it again, with fresh state. Only the platform entry runs a program; application code never creates a runtime or runs an Effect as a promise.
- Keep a service interface free of its backing store (no exposed map, client or connection), so another store is a new layer, not a new interface.
- A storage-backed service goes through Effect's SQL client service with plain SQL migrations, so the driver is a layer the platform entry picks.

## Config and errors

- Every env var is read in `config.ts` through Effect Config, never from `process`; empty counts as unset. The platform entry supplies the config provider (the environment on Node, bindings elsewhere). Secrets are redacted values and never logged.
- Expected failures are schema-backed tagged error classes in `errors.ts` with fixed, user-safe messages. Add the error, its `apiErrorTable` row and its status annotation together, and list it in the endpoint's error schemas. Context goes in log annotations, never into the message.
- Unexpected failures are defects: the request middleware logs them once and returns the generic 500 envelope. Don't catch and swallow them earlier, and don't turn a defect into a tagged error to make it look handled.

## Retry, timeout, limits

- Non-streaming calls to a third party retry with a jittered exponential schedule and a cap, plus a timeout, and retry only errors that can succeed on retry (429, 5xx, network). Turn off the SDK's own retries so there is one retry layer.
- A streaming response is never wrapped in retry or timeout: once bytes reached the client, a retry repeats them.
- Limits (body size, page size, counts, durations) come from Config and are enforced before calling a third party or the store.

## Effect traps

- The typed-failure catch helpers don't see defects or interruption; handling those takes the cause-level variant. A rejected promise wrapped without a failure mapping, or a throw inside a synchronous Effect, is a defect: wrap third-party promises with the try-promise constructor (passing its abort signal through) and throwing code with the try constructor, mapping to a tagged error.
- Fail by yielding the error (`return yield* new SomeError({...})`).
- Work that outlives the response is forked onto a scope that outlives the request, and ends in a cause-level handler that logs: a failing forked fiber prints nothing otherwise.
- Finalizers belong to a scope. Check how the installed release builds a layer with a scoped constructor before reaching for a helper from another major.
- Time comes from `Clock`, not `Date.now()`, and randomness from `Random`, in anything a test drives.

## Logging

Use Effect's log functions with annotations, never `console.*`. Annotation keys become top-level JSON keys, so use stable camelCase names and don't reuse `time`, `level`, `msg`, `detail` or `error`. The request middleware already logs one `request` line per call and annotates everything under it with `requestId`; don't add per-handler access logs. Never log bodies, credentials, IPs or whole third-party error objects: pass the error as a log argument and `logging.ts` keeps only allowlisted fields. A tagged error logs its name, fixed message and status; a defect logs its name and stack frames without its message, because a defect's message can carry input. `logging.ts` builds the logger over a sink it is given; the platform entry picks the sink (terminal plus file, or stdout), so core code never writes files.
