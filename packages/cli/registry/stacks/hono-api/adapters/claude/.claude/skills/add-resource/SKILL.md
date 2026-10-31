---
name: add-resource
description: Add a REST resource or endpoint to this Hono API end to end, with its zod schemas, store, createRoute declarations, handlers and contract tests. Use when asked for a new resource, endpoint or route.
---

# Add a resource

Follow the notes slice; `src/schemas/notes.ts`, `src/services/notes.ts`, `src/routes/notes.ts` and `tests/http-contract.test.ts` are the model. Read `docs/guidance/hono-api/api.md` first, and `docs/guidance/rest-api/rest-api.md` when it exists.

Before any code, write down: the plural noun, its fields and types, each endpoint as `METHOD /v1/<path>` with its success status, and every error status. Reuse a noun that already exists in `src/schemas/`. Ask before guessing an ambiguous name or a breaking change.

1. **Schemas** in `src/schemas/<thing>.ts` with `z` from `@hono/zod-openapi`: the resource, its input as `z.strictObject`, its list query (`limit`, `cursor`) and page. Name each with `.openapi("<Name>")`.
2. **Store** in `src/services/<thing>.ts`: an interface the routes use and a `createMemory<Things>()` taking `now` and `newId`, with a unit test beside it.
3. **Errors** beyond the existing rows: a row in `errorTable` and an `AppError` subclass in `src/errors.ts`.
4. **Failing tests** in `tests/http-contract.test.ts`: success with status and parsed body (201 and `Location` for a create), each declared error status through `expectEnvelope`, an unknown body field or query key, a malformed path parameter, and the request record. Run them and watch them fail.
5. **Routes** in `src/routes/<thing>.ts`: one `createRoute()` per operation with `operationId`, request schemas and every response (errors through `errorResponse`), registered with `.openapi()` on `createRouter()`. Read input only with `c.req.valid(...)`; throw `NotFoundError` for a miss.
6. **Mount** it in `src/app.ts` with `app.route("/", <thing>Routes(store))`, adding the store to `AppDeps`.
7. `bun run check`, then `stacks verify`. Fetch `/openapi.json` from a running build and check the new paths.

Keep the slice thin: no endpoints, fields or filters the request didn't ask for.
