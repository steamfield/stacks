# Java

How Java code in this project is written. The shipped code follows every rule here; keep to them when extending it.

## Build

- Maven runs only through the committed wrapper (`./mvnw`, or the make targets that call it). Never `mvn`, never a second build tool. The wrapper files (`mvnw`, `mvnw.cmd`, `.mvn/wrapper/`) change only through `mvn -N wrapper:wrapper`, run by a person.
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
- Domain packages (records, store interfaces, rules) import nothing from Spring MVC, `jakarta.servlet` or the web package. Controllers translate HTTP to domain calls and back, and hold no rules.
- Use records for values and request bodies, with constraints on their components; `@Valid` on the controller parameter triggers them.
- Prefer `final` fields, immutable collections (`List.copyOf`) and small classes. Shared mutable state is guarded (`synchronized`, or a concurrent collection) because requests run on virtual threads in parallel.

## Errors

- A request fails by throwing `AppException` with an `ErrorCode` row (status, tag, fixed message, retryability) and a detail for the log. Add a row rather than building a response by hand; never rename a tag, since clients branch on it.
- `ApiExceptionHandler` turns every exception into the envelope, including Spring's own (bad JSON, validation, wrong method, unsupported media type). Don't add `@ExceptionHandler` methods in controllers or catch exceptions just to rethrow them.
- Detail goes into the log, never into the response body. An unexpected exception is logged as its class and stack frames, not its message, which can carry request data.
- Catch only what you can handle, and never swallow an exception: a `catch` either answers with a defined result or failure (as the cursor decoder does) or rethrows. When a caught exception becomes an `AppException`, log the cause first or add a constructor that keeps it.

## Logs

- SLF4J with key-value pairs through the fluent API (`log.atInfo().addKeyValue("noteId", id).log("note created")`), never string concatenation, `System.out` or `printStackTrace`. Logs are ECS JSON on stdout; `LOGGING_LEVEL_*` variables set levels.
- The request filter puts `requestId` in the MDC, so every line logged while handling a request carries it. Don't clear the MDC yourself.
- Never log request bodies, query values, headers carrying credentials, or anything a client sent beyond the request id.

## Testing

- JUnit Jupiter with AssertJ (`assertThat`); no Hamcrest, no JUnit `assertEquals`. Mock only what crosses a process boundary; the in-memory store is real in tests.
- Unit tests are `*Test` (Surefire, `make test`); tests that start the application on a port are `*IT` (Failsafe, `make test-integration`).
- HTTP behaviour is tested in a `@WebMvcTest` slice with `MockMvcTester`, asserting status, the envelope's `tag` and headers. A slice loads no `@ConfigurationProperties`, so a test that needs settings enables them in a nested `@TestConfiguration`, as `NotesControllerTest` does.
- Settings binding is tested with `ApplicationContextRunner`, not by setting process variables.
- `ArchitectureTest` (ArchUnit) states the layering rules; extend it when you add a rule worth enforcing, never relax it to make a change pass.
- Iterate with `./mvnw -q test -Dtest=<Class>`; run `make lint coverage` before finishing.
