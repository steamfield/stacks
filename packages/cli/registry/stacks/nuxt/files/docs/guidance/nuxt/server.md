# Server routes and the boundary

Nuxt's server is Nitro on h3. Read the installed h3 and Nitro declarations before using a helper from memory; the h3 major Nuxt depends on decides the helper names.

## Where code goes

- `server/api/<name>.<method>.ts` is a route (`notes.get.ts` is `GET /api/notes`). Keep it thin: validate, call a util, return data.
- `server/api/[...].ts` answers unknown `/api` paths with a JSON 404. Keep it, or unknown API paths render the HTML error page.
- `server/utils/` holds state, config and logging; Nitro auto-imports its exports into server code (`listNotes`, `log`, `serverConfig`). Tests import them by relative path.
- `server/plugins/request-log.ts` gives every request an `x-request-id` and writes one log line per request.
- Nothing under `app/` imports from `server/`, by any alias or relative path. The app reaches the server through routes; shared code lives in `shared/`.

## Validation and errors

- A route is a public endpoint anyone can call with any body. Read bodies with `readValidatedBody(event, (body) => Schema.safeParse(body))` using the schema from `shared/`, and query parameters with `getValidatedQuery` the same way.
- Expected failures throw `createError({ statusCode, statusMessage, data })`. Validation failures are 400 with `data: { fields }`, field name to first message (`fieldErrors` in `shared/schemas/note.ts`). Nuxt answers with `{ error, statusCode, statusMessage, message, data }`; the form and the e2e test read that shape.
- Don't catch and rewrap unexpected errors. Nitro answers 500 without the message in production, and the `error` hook logs the class and request ID.
- Set the status for a create with `setResponseStatus(event, 201)` and return `{ <resource> }`.

## Runtime config

- `nuxt.config.ts` `runtimeConfig` declares every setting with its default. Top-level keys are private (server only); keys under `public` ship to the browser in the page payload. Never put a secret under `public`.
- Environment variables override them when the built server starts: `NUXT_LOG_LEVEL` sets `logLevel`, `NUXT_PUBLIC_APP_TITLE` sets `public.appTitle`. A key not declared in `nuxt.config.ts` is never read.
- Server code reads config through `serverConfig()` in `server/utils/config.ts`, which validates it with zod once. A new setting gets a `runtimeConfig` default, a schema field, an `.env.example` line and a test.
- The built server doesn't load `.env`; pass real environment variables.

## Logging

`log(level, event, fields)` writes one JSON line to stdout. Its fields are a fixed list (`LogFields`): request ID, method, path without the query string, status, duration, error class, a count. Never log bodies, query strings, cookies, headers or error messages. Add a field to `LogFields` when a new boundary needs it.

## Server state

`server/utils/notes.ts` keeps notes in process memory on `globalThis`: shared by every user, lost on restart, not persistence. Replace it behind the same async functions when a database arrives.
