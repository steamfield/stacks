---
name: add-resource
description: Add a REST resource to this NestJS API end to end, as a feature module with its controller, service, DTOs, unit spec and contract tests. Use when asked for a new resource, endpoint, route or feature module.
---

# Add a resource

Follow the notes slice; `src/notes/` and `tests/e2e/http-contract.e2e-spec.ts` are the model. Read `docs/guidance/nestjs-api/api.md` first, and `docs/guidance/rest-api/rest-api.md` when it exists.

Before any code, write down: the plural noun, its fields and types, each endpoint as `METHOD /v1/<path>` with its success status, and every error status. Reuse a noun that already exists under `src/`. Ask before guessing an ambiguous name or a breaking change.

1. **Generate** the module, controller and service, in that order so the last two register in the new module: `bunx nest g module <things>`, `bunx nest g controller <things> --no-spec`, `bunx nest g service <things> --no-spec`. Check `src/app.module.ts` imports the module, then `bun run format`.
2. **DTOs** in `src/<things>/dto/<thing>.dto.ts`: the response class, the create input and the list query, with class-validator decorators and `@ApiProperty` on every field (`@Type(() => Number)` on query numbers).
3. **Errors** beyond the existing rows: a row in `errorTable` and an `AppError` subclass in `src/common/errors.ts`.
4. **Failing tests**: `src/<things>/<things>.service.spec.ts` through `Test.createTestingModule` (imports from `vitest`), and rows in a contract spec under `tests/e2e/`: success with status and body (201 and `Location` for a create), each declared error status through `expectEnvelope`, an unknown body field or query key, a malformed id, the request record, and the path in `/openapi.json`. Run them and watch them fail.
5. **Service**: the rules and storage, async methods, `NotFoundError` for a miss. No HTTP types.
6. **Controller**: `@Controller({ path: '<things>', version: '1' })`, one method per endpoint that calls the service, `ParseUUIDPipe` on ids, and an `@Api*Response` for each status. Import the service and DTOs as values.
7. Export the service from the module only if another module needs it.
8. `bun run check`, then `stacks verify`. Fetch `/openapi.json` from a running build and check the new paths.

Keep the slice thin: no endpoints, fields or filters the request didn't ask for.
