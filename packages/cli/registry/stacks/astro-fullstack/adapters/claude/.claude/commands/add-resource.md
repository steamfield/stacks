---
description: Add a REST resource or endpoint end to end (contract, handler, service, tests, and the site's use of it)
argument-hint: "<the resource and what clients do with it>"
---

Add an API resource or endpoint: $ARGUMENTS

Read `docs/guidance/rest-api/rest-api.md`, `docs/guidance/astro-fullstack/effect-api.md` and `docs/guidance/astro-fullstack/testing.md` (and `docs/guidance/astro-fullstack/astro.md` if the site uses it), and `docs/guidance/effect/api.md` (when the project has one) before writing Effect code. Use the smallest existing group in `packages/contract/src/groups/` as the template.

Before any code, write down in one short list: the resource noun (plural path), its fields and their types, each endpoint as `METHOD <prefix>/<path>` with its success status (the prefix is in AGENTS.md, "API conventions"), every error status it returns, and whether the site reads it at build time (from files) or at view time (from an island). Search the contract for an existing resource with that meaning and reuse its name. If the noun or an endpoint is ambiguous, or a wrong guess would be a breaking change to undo, ask before writing code.

1. **Schemas** in `packages/contract/src/schemas/<domain>.ts`, re-exported from its `index.ts`: the resource, its create and update inputs, and its list query. Branded ids, `<event>At` timestamps, validation in the schema with a message on anything a client can trip.
2. **Errors** the endpoints need beyond the existing ones: a tagged error in `packages/contract/src/errors.ts`, its `apiErrorTable` row and status annotation, a fixed safe message.
3. **Group** in `packages/contract/src/groups/<resource>.ts`: one endpoint per operation with params, query, payload, success and error schemas, identifiers `list`, `get`, `create`, `update`, `delete`. A create's success is the resource schema at status 201 with a `location` header (`effect-api.md` names the helpers). Add it to `packages/contract/src/api.ts`.
4. **Service** for the domain logic and state (`/add-service` if it's new), with a `layerMemory` for tests. Handlers in `apps/api/src/handlers/<resource>.ts` call it and return its result; wire them into `app.ts`.
5. **Tests** through HTTP on a fresh test app: the success path, each error status with its `tag` and `retryable`, the validation boundaries, `Location` on create, and pagination for a list.
6. **Site**, only if the request includes it: a function in `apps/web/src/lib/api.ts` over the client, then the island or page that uses it, with its tests (a fake `fetch` returning contract-encoded bodies).
7. `bun run check`, then `bun run dev:bg` and exercise each endpoint once with `curl -si`, including one error, and once through the site's port. Read the `/openapi.json` diff for the new paths.

Keep the slice thin. Don't add endpoints, fields, filters or options the request didn't ask for; say what you left out instead.
