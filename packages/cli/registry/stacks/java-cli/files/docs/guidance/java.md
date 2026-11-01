# Java

How Java code in this project is written. The shipped code follows every rule here; keep to them when extending it.

## Build

- Maven runs only through the committed wrapper (`./mvnw`, or the make targets that call it). Never `mvn`, never a second build tool. The wrapper files (`mvnw`, `mvnw.cmd`, `.mvn/wrapper/`) are generated once during setup (`mvn -N wrapper:wrapper -Dtype=only-script`), and after that change only when a person upgrades Maven with `./mvnw wrapper:wrapper`.
- `.java-version` names the JDK major; the Makefile derives `JAVA_HOME` from it when unset, and `pom.xml`'s `java.version` must match it (`make env` checks).
- Every version lives in a `<properties>` entry of `pom.xml`. Jackson, SLF4J and JUnit come from their BOMs in `<dependencyManagement>`, so those dependencies have no `<version>`; any other library or plugin gets a `<name>.version` property.
- Keep the build's checks: Enforcer's Java version and dependency convergence, `-Xlint:all` with `failOnWarning`, Error Prone with NullAway, Spotless and the JaCoCo floor. A check that is wrong for one place gets `@SuppressWarnings("<check>")` on that member with a comment saying why, as `Main.terminal` does, never a weaker build.
- Spotless (palantir-java-format) owns formatting. Run `make fmt` after editing rather than formatting by hand.
- The jar is shaded: every dependency is inside `target/<name>.jar`. A new dependency that registers itself through `META-INF/services` works because the shade configuration merges those files; keep `ServicesResourceTransformer`.

## Nullness

- Every package has a `package-info.java` annotated `@NullMarked` (`org.jspecify.annotations`), so types are non-null unless marked. NullAway fails the build on a possible null dereference.
- Mark a value that can be absent `@Nullable` and handle the null where it is read: an optional picocli option field, a lookup result. A lookup that can miss returns `Optional`; a collection is empty, never null.

## Structure

- `Main` is the only class that reads the environment, system properties or the standard streams, or calls `System.exit`. Everything else receives `Env`, `Config` and `Output`. `ArchitectureTest` enforces it.
- picocli lives in `app.cli`. A command parses into fields and implements `Action`; work that is more than a few lines goes in a package of its own that knows nothing about picocli, so it tests without a command line.
- Use records for values, `final` fields and immutable collections (`List.copyOf`, `Map.copyOf`).

## Output and errors

- stdout carries the result only, written once through `Output.result`; under `--json` it is one JSON document on one line. Never `System.out.println` or `printStackTrace`.
- A command fails by throwing `CliException` with an `ErrorCode`. The message says what went wrong in words a user reads; the code supplies the exit status and the suggestion. Add a code rather than choosing an exit status in a command, and never rename one: scripts branch on it.
- Catch only what you can handle, and never swallow an exception: a `catch` either turns it into a `CliException` (keeping the cause) or rethrows. An unexpected exception reaches `App`, which logs its stack trace and reports `INTERNAL`.

## Logs

- SLF4J with key-value pairs through the fluent API (`LOG.atDebug().addKeyValue("path", path).log("reading config")`), never string concatenation. Logs go to stderr: `warn` and above by default, `debug` with `--verbose`, JSON lines under `--json`.
- Only `app.log` imports Logback. Logback starts quiet (`QuietStart`, registered in `META-INF/services`) so nothing reaches stdout before `Logging.start` runs; don't add a `logback.xml`.
- Never log secrets or the contents of user files.

## Testing

- JUnit Jupiter with AssertJ (`assertThat`); no Hamcrest, no JUnit `assertEquals`, no mocks for code this project owns.
- Unit tests are `*Test` (Surefire, `make test`). `AppTest` runs whole invocations through `App.run` with in-memory streams and asserts the exit status, stdout and stderr separately. Use `@TempDir` for files and build an `Env` instead of setting process variables.
- `*IT` tests (Failsafe, `make test-integration`) run the packaged jar with `java -jar` in a clean environment. Each exit path a user can hit gets a case there.
- `ArchitectureTest` (ArchUnit) states the layering rules; extend it when you add a rule worth enforcing, never relax it to make a change pass.
- Iterate with `./mvnw -q test -Dtest=<Class>`; run `make compile coverage test-integration` before finishing.
