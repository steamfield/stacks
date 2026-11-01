# Testing

Vitest runs every test on Node, in two projects (`vitest.config.ts`): `unit` (`src/**/*.spec.ts` and the harness hook tests) and `e2e` (`tests/e2e/**/*.e2e-spec.ts`). Never `bun test` or Jest. Import `describe`, `it`, `expect` and `vi` from `vitest`; globals are off.

- **Unit specs** beside the code: config parsing, the error mapping, the logger and each service. Build a service through `Test.createTestingModule({ providers: [...] })` so its injection is exercised, and assert domain errors (`rejects.toBeInstanceOf(NotFoundError)`).
- **Contract tests** in `tests/e2e/`: `testApp()` from `tests/helpers/app.ts` compiles the real `AppModule`, applies `configureApp` and captures log records; Supertest calls the HTTP server. Assert the status, the body, headers (`location`, `x-request-id`) and request records. `expectEnvelope(res, code)` checks an error against `errorTable`. Close the app in `afterEach`.
- **Request records** are written when the response finishes, which can be after Supertest resolves: wait for them with `vi.waitFor`.
- **Failures the real service can't produce** (a 500): pass `notes: { list: () => Promise.reject(...) }` to `testApp`, which overrides the provider. Don't mock our own modules otherwise.

A new endpoint adds rows for: success with its exact status and body, each error status the route declares, an unknown body field or query key, and a malformed path parameter, plus a check that `/openapi.json` lists the path.

Vite's transformer emits the decorator metadata Nest's injection needs, reading `experimentalDecorators` and `emitDecoratorMetadata` from `tsconfig.json`. If a test shows an injected dependency as `undefined`, check those two options and that the class is imported as a value.

Scope a run with `bun run test src/notes/notes.service.spec.ts`, `bun run test:e2e -t "<name>"`, and read the counts: a filter that matches nothing passes with every test skipped.
