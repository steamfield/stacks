---
description: Add a REST resource or endpoint end to end (schema, group, handler, service, tests)
argument-hint: "<the resource and what clients do with it>"
---

Add an API resource or endpoint: $ARGUMENTS

Read `docs/guidance/rest-api/rest-api.md`, `docs/guidance/typescript-api/effect-api.md` and `testing.md`, and `docs/guidance/effect/api.md` (when the project has one) before writing Effect code. Use the smallest existing group in `src/api/` as the template.

Before any code, write down in one short list: the resource noun (plural path), its fields and their types, each endpoint as `METHOD <prefix>/<path>` with its success status (the prefix is in AGENTS.md, "API conventions"), and every error status it returns. Search `src/api/` for an existing resource with that meaning and reuse its name. If the noun or an endpoint is ambiguous, or a wrong guess would be a breaking change to undo, ask before writing code.

1. **Schemas** in `src/schemas/<domain>.ts`, re-exported from `index.ts`: the resource, its create and update inputs, and its list query. Branded ids, `<event>At` timestamps, validation in the schema with a message on anything a client can trip.
2. **Errors** the endpoints need beyond the existing ones: a tagged error in `errors.ts`, its `apiErrorTable` row and status annotation, a fixed safe message.
3. **Group** in `src/api/<resource>.ts`: one endpoint per operation with params, query, payload, success and error schemas, identifiers `list`, `get`, `create`, `update`, `delete`. A create's success is the resource schema at status 201 with a `location` header (`effect-api.md` names the helpers). Add it to `src/api.ts`.
4. **Service** for the domain logic and state (`/add-service` if it's new), with a `layerMemory` for tests. Handlers in `src/handlers/<resource>.ts` call it and return its result; wire them into `app.ts`.
5. **Tests** through HTTP on a fresh test app: the success path, each error status with its `tag` and `retryable`, the validation boundaries, `Location` on create, and pagination for a list.
6. `bun run check`, then `bun run dev:bg` and exercise each endpoint once with `curl -si`, including one error. Read the `/openapi.json` diff for the new paths.

Keep the slice thin. Don't add endpoints, fields, filters or options the request didn't ask for; say what you left out instead.
