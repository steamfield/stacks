# Routes, errors and logging

## Modules

- `src/main.ts` is the process entry: it parses `process.env` with `loadConfig`, exits 2 on a bad setting, starts the server and stops it on SIGINT or SIGTERM.
- `src/server.ts` serves the app with `@hono/node-server`. Nothing else imports Node.
- `src/app.ts` builds the app from its dependencies (config, logger, stores). It must stay a plain fetch handler, so the same app runs in `app.request()` tests and could run on another runtime.
- `src/router.ts` exports `createRouter()`. Every route module builds its router with it.

## Routes

1. Schemas in `src/schemas/<resource>.ts`, built with `z` from `@hono/zod-openapi` and named with `.openapi("<Name>")` so they appear once under `components.schemas`. Inputs are `z.strictObject` (unknown fields and query keys are a 400). Query numbers use `z.coerce`.
2. Each operation is a `createRoute({ method, path, operationId, request, responses })`. Paths use `{param}`, not `:param`. List every status the handler can return; error statuses use `errorResponse(description)`.
3. Register with `.openapi(route, handler)` and read input only with `c.req.valid("param" | "query" | "json")`. Return `c.json(value, status)` with the status written out.
4. Mount the router in `src/app.ts` with `app.route("/", router)`.

A body route sets `request.body.required: true`; without it an empty body reaches the handler as `{}`.

## Errors

`errorTable` in `src/errors.ts` is the one place a status and its safe message live. Throw `NotFoundError`, `BadRequestError` or a new `AppError` subclass; `app.onError` turns it into:

```json
{ "error": { "code": "not_found", "message": "Resource not found.", "requestId": "..." } }
```

Validation failures add `issues: [{ path, message }]`, with paths such as `json.title` or `query.limit`. Hono's own exceptions (malformed JSON 400, missing content type 415) keep their status through `toAppError`. Anything else is `internal` (500): the client gets the generic message, and the log gets the error class and stack, never its message, which may carry data.

## Logging

`createLogger(level)` writes JSON lines to stdout: ISO `time`, text `level`, `msg`, flat fields. Keys named like secrets (`password`, `token`, `authorization`, `cookie`, `secret`) are redacted one level deep as a backstop; don't rely on it, pass only the fields you need. `requestLogger` writes one `request` record per request: `requestId`, `method`, `route` (the pattern, never the URL with its query), `status`, `durationMs`. Health probes log at debug. `bun run dev` pipes stdout through `pino-pretty`; production keeps JSON.

## Request ids

`hono/request-id` keeps a client's `X-Request-Id` when it is at most 128 word characters, `-` or `=`, and generates one otherwise. The id is on every response, every request record and every error envelope.
