# Architecture

One Maven module built by the Quarkus Maven plugin into `target/quarkus-app/`
(run `quarkus-run.jar` inside it, never a copy of the jar alone: it loads
`lib/`, `app/` and `quarkus/` beside it). `app.Main` either runs the health
probe (`--healthcheck`, `HealthProbe`) or starts Quarkus, which maps and
validates `AppConfig`, wires the beans and serves on `HOST` and `PORT`. On
SIGTERM or SIGINT the server stops accepting connections, waits up to
`SHUTDOWN_TIMEOUT` for requests in flight and exits.

Quarkus does most of its wiring at build time: it scans the classes, resolves
injection and generates the bytecode that starts the app. A build-time
property changed only in the environment has no effect until the next build.

| Package | Owns |
|---|---|
| `app` | `Main` (the entry point, the only reader of the process environment) and `HealthProbe` |
| `app.config` | `AppConfig`: the application's settings, their defaults and validation |
| `app.errors` | `ErrorCode` (the one error table) and `AppException` |
| `app.notes` | The notes resource: records, validation, `NoteStore` and `InMemoryNoteStore` |
| `app.web` | `NotesResource`, `ErrorMappers`, `RequestFilters`, `ErrorEnvelope` |

A request passes `RequestFilters` before matching (request id into the MDC),
then after matching (undeclared or repeated query parameters are rejected),
then the resource validates its body and calls the store. Any exception,
including Quarkus REST's own (no route, wrong method, wrong media type, bad
JSON, failed validation), is turned into the error envelope by
`ErrorMappers`. The response filter adds the request id and `Cache-Control`
and logs one access record. Health (`/q/health`) and the OpenAPI document
(`/q/openapi`) are served by their extensions outside these filters.

Dependencies point one way: `app.web` uses `app.notes`, `app.errors` and
`app.config`; those three import nothing from `app.web`, Jakarta REST,
RESTEasy or Vert.x. `ArchitectureTest` checks it, along with: no
`System.getenv` or `System.getProperty` outside `Main`, no `@ConfigProperty`
fields and no field injection. A database store implements `NoteStore` and
replaces `InMemoryNoteStore` without touching the resource.

Tests: unit tests per package and `NotesResourceTest` (`@QuarkusTest`, the app
in the test JVM on a free port) run under Surefire as `*Test`; `ApiIT`
(`@QuarkusIntegrationTest`, Failsafe) starts the packaged application as its
own process. No external service is needed.
