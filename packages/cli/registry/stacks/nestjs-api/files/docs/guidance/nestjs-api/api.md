# Modules, errors and logging

## Where things go

- `src/main.ts` creates the app with `bodyParser: false`, `bufferLogs` and `abortOnError: false`, switches to the JSON logger at the configured level, calls `configureApp` and listens on `PORT_API`. A `ConfigError` exits 2 with the variable names.
- `src/app.setup.ts::configureApp` holds what can't live in a module: the request-context middleware (first), the JSON body parser with its size limit, URI versioning, shutdown hooks and Swagger (`/docs`, `/openapi.json`). Tests call it too.
- `src/app.module.ts` imports `ConfigModule` (global, validated by `src/config/env.ts::validateEnv`) and one module per feature, and registers the global `ValidationPipe` (`APP_PIPE`) and `ErrorEnvelopeFilter` (`APP_FILTER`). A new global pipe, guard, interceptor or filter goes here as an `APP_*` provider, so tests that import `AppModule` get it.
- `src/<feature>/`: `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `dto/`, and `<feature>.service.spec.ts`. `src/common/` holds what every feature shares.

## Module boundaries

- A feature module declares its controllers and providers and exports only the services another module needs. Another feature imports the module, never a controller, and never lists a service from another feature in its own `providers` (that makes a second instance).
- Controllers translate HTTP: they read validated DTOs, call one service method and return its result. No business rules, no storage.
- Services hold the rules and the data access and know nothing about HTTP. They throw `AppError` subclasses from `src/common/errors.ts` (`NotFoundError`, `BadRequestError`, or a new one), never `HttpException` or its subclasses.
- Read settings through `ConfigService<Env, true>` with `{ infer: true }`, never `process.env` outside `src/config/env.ts`.

## Decorators and imports

Nest finds what to inject, and which DTO to validate, from decorator metadata TypeScript writes at build time. An `import type` of an injected class or a DTO erases it, and Nest then injects `undefined` or skips validation without an error. Import those classes as values. `oxlint`'s consistent-type-imports rule can't tell the difference, so it stays off.

## Routes and DTOs

1. Controllers declare `@Controller({ path: '<plural>', version: '1' })`; URI versioning serves them under `/v1`. `/healthz`, `/docs` and `/openapi.json` stay outside it (`VERSION_NEUTRAL`).
2. Bodies and queries are DTO classes in `dto/` with class-validator decorators and `@ApiProperty`. The global pipe uses `whitelist` and `forbidNonWhitelisted`, so an unknown body field or query key is a 400, and `transform`, so query numbers need `@Type(() => Number)`.
3. Path ids go through `ParseUUIDPipe` (a malformed id is a 400).
4. A create returns 201 with a `Location` header (`@Res({ passthrough: true })`). A list takes `limit` and `cursor` and returns `{ items, nextCursor }`.
5. Every response a route can return carries an `@Api*Response` decorator; error responses use `ErrorEnvelope` from `src/common/error-envelope.dto.ts`.

## Errors

`errorTable` in `src/common/errors.ts` is the one place a status and its safe message live. `ErrorEnvelopeFilter` renders everything thrown during a request as:

```json
{ "error": { "code": "not_found", "message": "Resource not found.", "requestId": "..." } }
```

Validation failures add `issues: [{ path, message }]`. Nest's `HttpException`s (unknown route or wrong method 404, `ParseUUIDPipe` 400) and the body parser's errors (malformed JSON 400, too large 413) keep their status through `toAppError`. Anything else is `internal` (500): the client gets the generic message and the log gets the error class and stack, never its message. A new failure adds a row to `errorTable`, an `AppError` subclass and a contract test.

## Logging

`createLogger` is Nest's `ConsoleLogger` in JSON mode: one object per line on stdout with `level`, `pid`, `timestamp`, `message`, `context` and the fields passed after the message. Log with `new Logger(<Class>.name)` and flat fields: `this.logger.log('note created', { noteId })`. Keys named like secrets are redacted as a backstop; pass only the fields you need, never bodies, headers, query strings or tokens. `requestContext` writes one `request` record per response (`requestId`, `method`, `route` pattern, `status`, `durationMs`), at debug for `/healthz`.

## Request ids

`requestContext` keeps a client's `X-Request-Id` when it is at most 128 word characters, `-` or `=`, and generates one otherwise. It is on every response, request record and error envelope; read it with `requestIdOf(res)`.
