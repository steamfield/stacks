# Java

How Java code in this project is written. The shipped code follows every rule here; keep to them when extending it.

## Build

- Maven runs only through the committed wrapper (`./mvnw`, or the make targets that call it). Never `mvn`, never a second build tool. The wrapper files (`mvnw`, `mvnw.cmd`, `.mvn/wrapper/`) are generated once during setup (`mvn -N wrapper:wrapper -Dtype=only-script`), and after that change only when a person upgrades Maven with `./mvnw wrapper:wrapper`.
- `.java-version` names the JDK major; the Makefile derives `JAVA_HOME` from it when unset, and `pom.xml`'s `java.version` must match it (`make env` checks).
- Every version lives in a `<properties>` entry of `pom.xml`. The Spring Boot BOM manages library versions, so a managed dependency has no `<version>`; an unmanaged one gets a `<name>.version` property. Plugins always get a property, since the BOM manages none.
- Keep the build's checks: Enforcer's Java version and dependency convergence, `-Xlint:all` with `failOnWarning`, Error Prone with NullAway, Spotless and the JaCoCo floor. A check that is wrong for one place gets `@SuppressWarnings("<check>")` on that member with a comment saying why, never a weaker build.
- Spotless (palantir-java-format) owns formatting. Run `make fmt` after editing rather than formatting by hand.

## Nullness

- Every package has a `package-info.java` annotated `@NullMarked` (`org.jspecify.annotations`), so types are non-null unless marked. NullAway fails the build on a possible null dereference.
- Mark a value that can be absent `@Nullable` and handle the null where it is read. A lookup that can miss returns `Optional`; a collection is empty, never null.
- Don't silence NullAway with `requireNonNull` or a suppression unless you can say why the value is never null there.

## Structure and injection

- Dependencies arrive through constructors, one constructor per class; no `@Autowired` fields or setters.
- Settings are components of a `@ConfigurationProperties` record with `@DefaultValue` and Bean Validation constraints, validated at startup. No `@Value`, and no `System.getenv` or `System.getProperty` outside the entry point. `ArchitectureTest` enforces both.
- Domain packages (records, forms, store interfaces, rules) import nothing from Spring MVC, Spring Security, Thymeleaf, `jakarta.servlet` or the web package. Controllers translate HTTP to domain calls and a view name, and hold no rules.
- Use records for values. A form is a bean with getters and setters (Thymeleaf's `th:field` reads through getters) carrying Bean Validation constraints with the message the page shows; `@Valid` on the controller parameter triggers them.
- Prefer `final` fields, immutable collections (`List.copyOf`) and small classes. Shared mutable state is guarded (`synchronized`, or a concurrent collection) because requests run on virtual threads in parallel.

## Errors

- A request fails by throwing `AppException` with an `ErrorCode` row (status, fixed title and message) and a detail for the log. Add a row rather than building an error page by hand.
- `PageExceptionHandler` turns every exception inside Spring MVC into the error page, including Spring's own (unknown path, wrong method, missing parameter); `ErrorPageController` renders the same page for failures outside it (a refused CSRF token). Don't add `@ExceptionHandler` methods in controllers or catch exceptions just to rethrow them.
- A form's validation errors are not failures: the handler re-renders the bound form with its field errors.
- Detail goes into the log, never into the page. An unexpected exception is logged as its class and stack frames, not its message, which can carry request data.
- Catch only what you can handle, and never swallow an exception: a `catch` either answers with a defined result or failure, or rethrows. When a caught exception becomes an `AppException`, log the cause first or add a constructor that keeps it.

## Logs

- SLF4J with key-value pairs through the fluent API (`log.atInfo().addKeyValue("noteId", id).log("note created")`), never string concatenation, `System.out` or `printStackTrace`. Logs are ECS JSON on stdout; `LOGGING_LEVEL_*` variables set levels.
- The request filter puts `requestId` in the MDC, so every line logged while handling a request carries it. Don't clear the MDC yourself.
- Never log form fields, query values, cookies, headers carrying credentials, or anything a client sent beyond the request id.

## Testing

- JUnit Jupiter with AssertJ (`assertThat`); no Hamcrest, no JUnit `assertEquals`. Mock only what crosses a process boundary; the in-memory store is real in tests.
- Unit tests are `*Test` (Surefire, `make test`); tests that start the application on a port are `*IT` (Failsafe, `make test-integration`).
- Pages are tested in a `@WebMvcTest` slice with `MockMvcTester`, reading the rendered HTML with jsoup: every template is rendered by at least one test, since Thymeleaf errors surface only at render. Posts carry `.with(csrf())`. A slice loads no `@ConfigurationProperties` and no `@Configuration` classes, so `NotesControllerTest` imports `SecurityConfig` and enables the settings in a nested `@TestConfiguration`.
- `*IT` tests drive the running app with HtmlUnit (JavaScript off), which submits the real form with its CSRF token and follows redirects like a browser.
- Settings binding is tested with `ApplicationContextRunner`, not by setting process variables.
- `ArchitectureTest` (ArchUnit) states the layering rules; extend it when you add a rule worth enforcing, never relax it to make a change pass.
- Iterate with `./mvnw -q test -Dtest=<Class>`; run `make lint coverage` before finishing.
