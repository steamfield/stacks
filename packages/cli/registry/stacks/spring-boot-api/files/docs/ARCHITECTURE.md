# Architecture

One Maven module building one executable jar. `app.Application` either runs
the health probe (`--healthcheck`, `HealthProbe`) or starts Spring, which binds
`AppProperties`, builds the beans and serves on `HOST` and `PORT`. On SIGTERM
or SIGINT the server stops accepting connections, finishes requests in flight
up to `SHUTDOWN_TIMEOUT` and exits.

| Package | Owns |
|---|---|
| `app` | `Application` (the entry point, the only reader of the process environment) and `HealthProbe` |
| `app.config` | `AppProperties`: the application's settings, their defaults and validation |
| `app.errors` | `ErrorCode` (the one error table) and `AppException` |
| `app.notes` | The notes resource: records, validation, `NoteStore` and `InMemoryNoteStore` |
| `app.web` | `NotesController`, `ApiExceptionHandler`, `FallbackErrorController`, `RequestLogFilter`, `QueryParameterGuard`, `WebConfig`, `ErrorEnvelope` |

A request passes `RequestLogFilter` (request id into the MDC and the response,
`Cache-Control: no-store`, one access record when it finishes), then Spring
MVC: `QueryParameterGuard` rejects undeclared or repeated query parameters,
the controller validates its body and calls the store, and any exception is
turned into the error envelope by `ApiExceptionHandler`. A failure outside
Spring MVC reaches `FallbackErrorController` at `/error`.

Dependencies point one way: `app.web` uses `app.notes`, `app.errors` and
`app.config`; those three import nothing from `app.web`, Spring MVC, Spring's
HTTP types or servlets. `ArchitectureTest` checks it, along with: no
`System.getenv` or `System.getProperty` outside `Application`, no `@Value`
fields and no field injection. A database store implements `NoteStore` and
replaces `InMemoryNoteStore` without touching the controller.

Tests: unit tests per package (`*Test`, Surefire); `NotesControllerTest`
drives the web layer through `MockMvcTester` without a server; `ApiIT`
(`*IT`, Failsafe) starts the whole application on a random port. No external
service is needed.
