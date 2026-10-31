# Architecture

One Maven module building one executable jar. `app.Application` either runs
the health probe (`--healthcheck`, `HealthProbe`) or starts Spring, which binds
`AppProperties`, builds the beans and serves HTML on `HOST` and `PORT`. On
SIGTERM or SIGINT the server stops accepting connections, finishes requests in
flight up to `SHUTDOWN_TIMEOUT` and exits.

| Package | Owns |
|---|---|
| `app` | `Application` (the entry point, the only reader of the process environment) and `HealthProbe` |
| `app.config` | `AppProperties`: the application's settings, their defaults and validation |
| `app.errors` | `ErrorCode` (the one error table: status, title, message) and `AppException` |
| `app.notes` | The notes resource: `Note`, `NoteForm` with its validation, `NoteStore` and `InMemoryNoteStore` |
| `app.web` | `NotesController`, `PageExceptionHandler`, `ErrorPageController`, `ErrorPages`, `SecurityConfig`, `RequestLogFilter` |

| Resource | What it is |
|---|---|
| `templates/layout.html` | The shared page: head, stylesheet, htmx, header, and the page's `<main>` |
| `templates/notes/index.html` | The home page; its `notes` fragment is what an htmx post swaps |
| `templates/notes/show.html` | One note |
| `templates/error.html` | Every error page, filled from an `ErrorCode` row |
| `static/css/site.css` | The stylesheet |

A request passes `RequestLogFilter` (request id into the MDC and the response,
one access record when it finishes), then Spring Security (CSRF token check on
every unsafe method, security headers, `Cache-Control: no-cache, no-store`), then Spring
MVC: the controller validates a form, calls the store and names a view, which
Thymeleaf renders inside the layout. An exception inside Spring MVC becomes
the error page through `PageExceptionHandler`; a failure outside it (Spring
Security's refusal, say) reaches `ErrorPageController` at `/error`, which
renders the same page.

htmx is a WebJar (`org.webjars.npm:htmx.org`); Spring serves it under
`/webjars/` and writes the installed version into the link. There is no
JavaScript build.

Dependencies point one way: `app.web` uses `app.notes`, `app.errors` and
`app.config`; those three import nothing from `app.web`, Spring MVC, Spring
Security, Thymeleaf, Spring's HTTP types or servlets. `ArchitectureTest`
checks it, along with: no `System.getenv` or `System.getProperty` outside
`Application`, no `@Value` fields and no field injection. A database store
implements `NoteStore` and replaces `InMemoryNoteStore` without touching the
controller.

Tests: unit tests per package (`*Test`, Surefire); `NotesControllerTest`
renders every page through `MockMvcTester` without a server and reads the HTML
with jsoup; `WebIT` (`*IT`, Failsafe) starts the whole application on a
random port and drives it with HtmlUnit, a browser with JavaScript off. No
external service is needed.
