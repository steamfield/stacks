---
paths:
  - "apps/api/src/**"
  - "apps/api/drizzle.config.ts"
  - "packages/schemas/**"
---

# API and schemas

Read `docs/api.md` before changing a route, service, schema, or migration. The rules that break things when ignored:

- Schemas in `packages/schemas` use `.meta({ id })`, never `.openapi()`.
- Route objects stay literal `createRoute` calls; no wrapping factory.
- No middleware or auth SDK is reachable from `src/client.ts`; `bun` is imported only by `db/index.ts`, Drizzle only by services and `db/`. `bun run typecheck` covers mobile.
- Errors are `{ "message": string }`: `app.ts` owns exceptions and 404s; every OpenAPI group uses `validation.ts` for zod failures. Services throw `HTTPException`; composed services return a result union with a `satisfies` status map.
- Never hand-edit `apps/api/drizzle/`. Edit the schema, then `bun run db:generate`.
