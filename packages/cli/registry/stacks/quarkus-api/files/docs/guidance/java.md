# Java

How Java code in this project is written. The shipped code follows every rule here; keep to them when extending it.

## Build

- Maven runs only through the committed wrapper (`./mvnw`, or the make targets that call it). Never `mvn`, never a second build tool. The wrapper files (`mvnw`, `mvnw.cmd`, `.mvn/wrapper/`) are generated once during setup (`mvn -N wrapper:wrapper -Dtype=only-script`), and after that change only when a person upgrades Maven with `./mvnw wrapper:wrapper`.
- `.java-version` names the JDK major; the Makefile derives `JAVA_HOME` from it when unset, and `pom.xml`'s `java.version` must match it (`make env` checks).
- Every version lives in a `<properties>` entry of `pom.xml`. The Quarkus platform BOM manages the Quarkus extensions and most libraries, so a managed dependency has no `<version>`; an unmanaged one gets a `<name>.version` property. Plugins always get a property; the Quarkus Maven plugin shares the platform's.
- Add a Quarkus capability as its extension (`io.quarkus:quarkus-<name>`, managed by the BOM), not as the plain library underneath it: the extension does the build-time wiring the library alone lacks.
- Keep the build's checks: Enforcer's Java version and dependency convergence, `-Xlint:all` with `failOnWarning`, Error Prone with NullAway, Spotless and the JaCoCo floor. A check that is wrong for one place gets `@SuppressWarnings("<check>")` on that member with a comment saying why, never a weaker build.
- Spotless (palantir-java-format) owns formatting. Run `make fmt` after editing rather than formatting by hand.
- The app runs in JVM mode from `target/quarkus-app/`. Never `quarkus:dev` in an agent shell: it watches files and holds the terminal.

## Nullness

- Every package has a `package-info.java` annotated `@NullMarked` (`org.jspecify.annotations`), so types are non-null unless marked. NullAway fails the build on a possible null dereference.
- Mark a value that can be absent `@Nullable` and handle the null where it is read. A lookup that can miss returns `Optional`; a collection is empty, never null.
- Don't silence NullAway with `requireNonNull` or a suppression unless you can say why the value is never null there.

## Structure and injection

- Beans are CDI beans (`@ApplicationScoped` for services and stores). Dependencies arrive through the one constructor; no `@Inject` fields.
- Settings are methods of a `@ConfigMapping` interface with `@WithDefault` and Bean Validation constraints, validated at startup. No `@ConfigProperty` fields, and no `System.getenv` or `System.getProperty` outside the entry point. `ArchitectureTest` enforces both.
- Domain packages (records, store interfaces, rules) import nothing from Jakarta REST (`jakarta.ws.rs`), RESTEasy, Vert.x or the web package. Resources translate HTTP to domain calls and back, and hold no rules.
- Use records for values and request bodies, with constraints on their components; `@Valid` on the resource parameter triggers them.
- Resource methods that return plain types run on worker threads, so blocking code is fine there. Shared mutable state is guarded (`synchronized`, or a concurrent collection) because requests run in parallel.

## Errors

- A request fails by throwing `AppException` with an `ErrorCode` row (status, tag, fixed message, retryability) and a detail for the log. Add a row rather than building a response by hand; never rename a tag, since clients branch on it.
- `ErrorMappers` turns every exception into the envelope, including Quarkus REST's and Jackson's own. A new framework exception that slips past it (a test shows a body without `error.tag`) gets a `@ServerExceptionMapper` there, never a mapper in a resource class.
- Detail goes into the log, never into the response body. An unexpected exception is logged as its class and stack frames, not its message, which can carry request data.
- Catch only what you can handle, and never swallow an exception: a `catch` either answers with a defined result or failure (as the cursor decoder does) or rethrows.

## Logs

- JBoss Logging (`org.jboss.logging.Logger`, `Logger.getLogger(<Class>.class)`) with format arguments (`log.debugf("note created: id=%s", id)`), never string concatenation, `System.out` or `printStackTrace`. Logs are ECS JSON on stdout; `LOG_LEVEL` and `QUARKUS_LOG_CATEGORY__<CATEGORY>__LEVEL` set levels.
- The request filter puts `requestId` in the MDC, so every line logged while handling a request carries it. Don't clear the MDC yourself.
- Never log request bodies, query values, headers carrying credentials, or anything a client sent beyond the request id.

## Testing

- JUnit Jupiter with AssertJ (`assertThat`); RestAssured only sends requests, and its responses are asserted with AssertJ (`response.path(...)`), not Hamcrest. Mock only what crosses a process boundary; the in-memory store is real in tests.
- `*Test` classes run under Surefire (`make test`): plain unit tests, and `@QuarkusTest` classes that start the app once in the test JVM on a free port. `*IT` classes run under Failsafe (`make test-integration`) with `@QuarkusIntegrationTest` against the packaged app in its own process; they can't inject beans, only call over HTTP, and the app's output is in `target/quarkus.log`.
- `@QuarkusTest` classes share one running app, so tests never assume an empty store and create the data they read.
- Config mapping and validation are tested by building a `SmallRyeConfig` with the mapping and a validator, as `AppConfigTest` does, not by setting process variables.
- `ArchitectureTest` (ArchUnit) states the layering rules; extend it when you add a rule worth enforcing, never relax it to make a change pass.
- Iterate with `./mvnw -q test -Dtest=<Class>`; run `make lint coverage` before finishing.
