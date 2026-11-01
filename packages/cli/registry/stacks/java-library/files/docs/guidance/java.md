# Java

How Java code in this library is written. The shipped code follows every rule here; keep to them when extending it. [public-api.md](../public-api.md) lists the exports and what breaks callers.

## Build

- Maven runs only through the committed wrapper (`./mvnw`, or the make targets that call it). Never `mvn`, never a second build tool. The wrapper files (`mvnw`, `mvnw.cmd`, `.mvn/wrapper/`) are generated once during setup (`mvn -N wrapper:wrapper -Dtype=only-script`), and after that change only when a person upgrades Maven with `./mvnw wrapper:wrapper`.
- `.java-version` names the JDK major; the Makefile derives `JAVA_HOME` from it when unset, and `pom.xml`'s `java.version` must match it (`make env` checks).
- Every version lives in a `<properties>` entry of `pom.xml`. JUnit comes from its BOM in `<dependencyManagement>`; any other library or plugin gets a `<name>.version` property. `src/it/consumer/pom.xml` reads the same properties as `@name@`.
- Keep the build's checks: Enforcer's Java version and dependency convergence, `-Xlint:all` with `failOnWarning`, Error Prone with NullAway, doclint, Spotless, the JaCoCo floor and japicmp. A check that is wrong for one place gets `@SuppressWarnings("<check>")` on that member with a comment saying why, never a weaker build.
- Spotless (palantir-java-format) owns formatting, `src/it` included. Run `make fmt` after editing rather than formatting by hand.

## Dependencies

- A runtime dependency reaches every caller's build and module graph. The library has one, JSpecify, which callers need only to compile (`requires static`). Add another only when the user agrees; test-only libraries are free.
- Never shade or relocate dependencies into the jar.

## API and modules

- `module-info.java` exports `app` and nothing else. Implementation goes in `app.internal`, which may change in any release; public types never return or accept an `app.internal` type.
- Classes are `final` with private constructors and static factories; values are immutable (`final` fields, records, `List.copyOf`). Add a setting as a new factory or method on `SlugRules`, never a new parameter on an existing method.
- Failures are unchecked exceptions that carry a record of what went wrong (`SlugException.error()`), so callers branch on data, never on the message. A new kind of failure is a new `SlugError` record, which is a breaking change: see public-api.md.
- Library code never prints, reads the environment or system properties, calls `System.exit` or configures logging (`ArchitectureTest` enforces it). If the user asks for logs, use `System.Logger`, so callers choose the backend.

## Nullness

- Every package has a `package-info.java` annotated `@NullMarked` (`org.jspecify.annotations`), so types are non-null unless marked. NullAway fails the build on a possible null dereference, and callers' NullAway reads the same annotations.
- A lookup that can miss returns `Optional`; a collection is empty, never null. Mark a parameter `@Nullable` only when null means something.

## Javadoc

- Every public and protected type, method, field, record component and constructor in `app` has a Javadoc comment with `@param`, `@return` and `@throws` where they apply; `make docs` fails on a missing one (doclint `all`, warnings as errors).
- Examples are `{@snippet file="app/ExamplesTest.java" region="<name>"}` tags pointing at a region of `ExamplesTest`, never code typed into the comment, so every example compiles and runs in `make test`.
- doclint rejects bare `<`, `>` and `&` and unclosed HTML: use `{@code ...}`.

## Testing

- JUnit Jupiter with AssertJ (`assertThat`); no Hamcrest, no JUnit `assertEquals`, no mocks.
- Unit tests sit beside each class in the same package (`SlugRulesTest`) and cover every rule and its error record and message. Property tests (`SlugPropertiesTest`) state what holds for any input, checked over thousands of inputs from a fixed-seed `Random` with the input in each assertion's description: a parser either accepts or fails with the error `check` reports.
- `src/it/consumer` is a caller on the module path: `make test-consumer` installs the jar into `target/local-repo` and builds the consumer against it, so a missing export or a type left in `app.internal` fails there. A new public type gets a call in `Names` and an assertion in `NamesTest`.
- Iterate with `./mvnw -q test -Dtest=<Class>`; run `make compile coverage docs test-consumer api-check` before finishing.
