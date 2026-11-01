---
schema_version: 1
id: spring-boot-api
kind: stack
name: Spring Boot REST API (Java)
description: A Java JSON API on Spring Boot with Spring MVC and Actuator, built with Maven and make. One error envelope for every failure, validated settings, request ids and structured JSON logs, Error Prone and NullAway at compile time, and tests through Spring's MockMvc and a real server.
tags: [java, api, make]
tools: [java, mvn, make, git]
decisions:
  - "JDK: the newest LTS release Spring Boot supports (default). Its major goes in `.java-version` and pom.xml's `<java.version>`; never an update release."
  - "Build tool: Maven through the committed wrapper (default). Gradle with the Kotlin DSL and a version catalog only when the user asks; then translate each Makefile target one for one and keep every check."
  - "Root package: `app` (default), fixed so the shipped sources need no rename. To rename it, move `src/main/java/app` and `src/test/java/app`, change every `package app` and `import app.` line and the ArchitectureTest package names in one change, then run `make compile test`."
  - "Formatter: palantir-java-format through Spotless (default; 4 spaces, 120 columns), or google-java-format (`<googleJavaFormat/>`) when the user prefers 2 spaces."
  - "Error body: the `{\"error\":{\"tag\",\"message\",\"retryable\"}}` envelope the other API stacks use (default), or RFC 9457 Problem Details when the API's clients expect them; then change `ErrorEnvelope`, both error handlers and their tests together."
  - "Listen address: HOST 127.0.0.1 and PORT 8080 (default); a container sets HOST=0.0.0.0."
  - "Proving resource: notes held in memory (default), or the project's first real resource with the same routes and tests. Persistence: none (default); a database store implements NoteStore and replaces InMemoryNoteStore."
  - "Coverage floor: 70% of lines from unit and slice tests (default; `coverage.minimum` in pom.xml)."
env:
  PORT: "8080"
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github, rest-api]
  optional: [docker-deploy, rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: lint, layer: lint, run: make lint }
  - { name: compile, layer: typecheck, run: make compile }
  - { name: test, layer: test, run: make coverage }
  - { name: test-integration, layer: test, run: make test-integration }
  - { name: build, layer: build, run: make build }
  - name: api
    phase: serve
    layer: serve
    run: make serve
    expect: { http: "http://127.0.0.1:${PORT}/actuator/health", within: 120s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  env: Check the JDK, the Maven wrapper and that every pom.xml version property is filled
  install: Check the toolchain and download dependencies and plugins
  fmt: Format Java sources with Spotless (palantir-java-format)
  fmt-check: Fail if Spotless would change any Java source
  lint: "Maven Enforcer: JDK version, dependency convergence, duplicate declarations"
  compile: Compile main and test code with Error Prone and NullAway
  test: Unit and slice tests (*Test)
  coverage: Unit and slice tests with the JaCoCo line-coverage floor
  test-integration: Integration tests (*IT) against the app on a random port
  build: Executable jar at target/app.jar
  serve: Build, then run the jar in the foreground until SIGINT or SIGTERM
  ci: "Everything CI runs (fmt-check, enforcer, every test, coverage, the jar)"
  clean: Remove build output
---

# Spring Boot REST API (Java)

A JSON service on Spring Boot and Spring MVC: one error table, one envelope for every failure (the framework's own rejections included), request ids, one JSON access record per request, Actuator health, and a graceful stop on SIGTERM. Maven builds it through its wrapper and the `Makefile` is the entry point for every task.

## What stacks wrote

A working slice that passes every check once Setup fills the versions. `pom.xml` imports the Spring Boot BOM instead of using the parent POM and names every plugin version as an empty property; `.mvn/jvm.config` opens the javac internals Error Prone needs. `src/main/java/app/`: `Application` starts Spring or runs `--healthcheck` (`HealthProbe`); `config/AppProperties` is the validated settings record; `errors/ErrorCode` is the error table and `AppException` carries a row; `notes/` is the in-memory notes resource (`NoteStore`, `InMemoryNoteStore`, records for the note, the create request and a page); `web/` holds `NotesController`, `ApiExceptionHandler` (`@RestControllerAdvice` over Spring's `ResponseEntityExceptionHandler`), `FallbackErrorController` for `/error`, `RequestLogFilter` (request id, `Cache-Control`, access log) and `QueryParameterGuard`. `application.yaml` maps the environment, Actuator and ECS JSON logs. Tests: a unit test per package, `NotesControllerTest` (`@WebMvcTest` with `MockMvcTester`), `ArchitectureTest` (ArchUnit) and `ApiIT` (a random port with `RestTestClient`). `docs/` has ARCHITECTURE, configuration, `http-api.md` and `guidance/java.md`, the Java rules every agent follows. Creating a note and reading it back through the filter, advice and store is the payload. Read the code before extending it.

## Setup

No generator; nothing in `src/` comes from Spring Initializr.

1. **JDK.** Write the major of the newest Java LTS release that the current Spring Boot supports to `.java-version` (the major only, one line) and to `<java.version>` in `pom.xml`. On macOS install it with `brew install openjdk@<major>`; it is keg-only and the Makefile finds it, so don't link it or rely on `mvn`'s JDK: Homebrew's `maven` depends on the newest `openjdk`, which is usually not an LTS.
2. **Versions.** For every other empty `<*.version>` property, read the newest release from `https://repo.maven.apache.org/maven2/<groupId as a path>/<artifactId>/maven-metadata.xml`. Its `<release>` can be a milestone or release candidate (`-M1`, `-RC1`), so take the highest plain numeric version: `curl -s <url> | grep -o '<version>[0-9.]*</version>' | sort -V | tail -1`. The coordinates are in `pom.xml`; the property for Spring Boot is `spring-boot-dependencies`'s, Error Prone's is `error_prone_core`'s.
3. **Wrapper.** Run `mvn -N wrapper:wrapper -Dtype=only-script` once (the `mvn` from Homebrew's `maven`). It writes `mvnw`, `mvnw.cmd` and `.mvn/wrapper/maven-wrapper.properties` pinned to that Maven; commit them. From then on only `./mvnw` runs Maven.
4. `make install`, then `make fmt-check lint compile coverage test-integration build`. Where an installed release rejects shipped code (a moved Boot test class, a renamed property, a new Error Prone or NullAway finding), fix the code. Keep every compiler flag, Enforcer rule and the coverage floor; a check that is wrong for one place gets `@SuppressWarnings("<check>")` on that member with a comment saying why. Run `make fmt` after editing.
5. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/java.md` and `docs/http-api.md` from AGENTS.md, then run `stacks verify` until it passes. The `api` step runs `make serve` and probes `/actuator/health` on `PORT`.

## Conventions

`docs/guidance/java.md` holds the Java rules (nullness, injection, errors, logs, testing, Maven) and `docs/http-api.md` the HTTP contract; the shipped code follows both. For this service:

- **Routes**: one `@RestController` per resource in `app.web`, under `/v1/<plural-noun>`. Every `@RequestParam` names itself (`name = "limit"`), because `QueryParameterGuard` rejects any query parameter a handler doesn't declare. The `add-endpoint` skill walks through a new route or resource.
- **Errors**: a new failure is a row in `ErrorCode` (status, tag, fixed message, retryable) and a row in `docs/http-api.md`; code throws `AppException` with that code and a detail for the log. Handlers never build an error response themselves.
- **Domain**: resources live in their own package (`app.notes`) with no Spring MVC, servlet or `app.web` imports, behind a store interface; `ArchitectureTest` enforces it.
- **Config**: a new setting is a component of `AppProperties` with a `@DefaultValue`, constraints, a case in `AppPropertiesTest`, a line in `.env.example` and a row in `docs/configuration.md`. No `@Value`, no `System.getenv` outside `Application`.
- **Packages**: every package has a `package-info.java` with `@NullMarked`.

## Testing

Unit tests sit beside each package under `src/test/java` (`*Test`, Surefire): the error table, the store's paging and cursors, property binding through `ApplicationContextRunner`. `NotesControllerTest` is the HTTP contract without a server: `@WebMvcTest` loads the controller, filter, guard and advice, and `MockMvcTester` asserts status, envelope `tag` and headers for every route, bad bodies (400, 415), bad queries, misses and wrong methods (405 with `Allow`). `ApiIT` (`*IT`, Failsafe) starts the app on a random port and checks health, a create-read-list round trip, the JSON access record with its request id, and the health probe. A new route gets its cases in its controller test and one round trip in an `*IT`.

## Commands

The shipped Makefile (`make help`) has env, install, fmt, fmt-check, lint, compile, test, coverage, test-integration, build, serve, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md with single-test commands: `./mvnw -q test -Dtest=NotesControllerTest` and `./mvnw -q verify -DskipUTs=true -Dit.test=ApiIT`. Run `make serve` in the background when needed and stop only the pid you started.
<!-- stacks:when with=ci-github -->

**CI.** One `ubuntu-latest` job: setup-java from `.java-version`, then `make install` and `make ci`. Record in AGENTS.md that CI never runs `mvn`.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make install` runs `lefthook install` outside CI once `lefthook.yml` exists, so write that file first. pre-commit runs `make fmt` on `*.java` with `stage_fixed: true`, so formatting fixes are restaged; pre-push runs `make lint test`. Compiling checks the whole project, so it stays out of pre-commit.
<!-- stacks:end -->
<!-- stacks:when with=rest-api -->

**API conventions.** The notes resource follows the REST rule. Record in AGENTS.md: the `/v1` prefix, the `{"error":{"tag","message","retryable"}}` envelope, cursor pagination (`limit` default 20, max 100, `nextCursor`), and 405 with `Allow` for a wrong method, with notes as the example.
<!-- stacks:end -->
<!-- stacks:when with=docker-deploy -->

**Image.** The jar is `target/app.jar`. `HEALTHCHECK` runs `java -jar /app/app.jar --healthcheck`, which reads the same `HOST` and `PORT` as the server; `ApiIT` covers it. `.dockerignore` also excludes `target/`.
<!-- stacks:end -->

## Gotchas

- Spring Boot 4 split its starters: the web starter is `spring-boot-starter-webmvc` with `spring-boot-starter-webmvc-test`, and test classes moved packages (`org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest`). Memory says `spring-boot-starter-web` and `TestRestTemplate`; use the shipped names, and never `spring-boot-starter-classic` as a fix.
- Jackson 3 is `tools.jackson.*` (`JsonMapper`); only the annotations stay in `com.fasterxml.jackson.annotation`.
- `<annotationProcessorPaths>` turns off processor discovery on the classpath, so the configuration processor, Error Prone and NullAway are all listed there. A new processor (MapStruct, say) goes there too.
- Error Prone needs `.mvn/jvm.config`'s exports on every JDK this project supports; keep the file, and copy it into a Docker build. A NullAway error is real: mark the value `@Nullable` (`org.jspecify.annotations`) and handle null, don't suppress.
- `failOnWarning` covers javac's lint warnings too, deprecations included. Move off a deprecated API rather than dropping the flag.
- Without the parent POM nothing configures Failsafe for Boot: its `classesDirectory` points at `target/classes`, because the repackaged jar keeps classes under `BOOT-INF/` where tests can't load them.
- Surefire's `argLine` starts with `@{argLine}` so JaCoCo's agent survives, and `pom.xml` declares an empty `argLine` so the reference resolves when JaCoCo is skipped.
- `make serve` runs the built jar, not `./mvnw spring-boot:run`, which forks a JVM that a signal to Maven can leave running. The guard hook denies `spring-boot:run`.
- A `${PORT:8080}` placeholder resolves an empty `PORT` to empty, not the default; unset a variable rather than blanking it.
- Health answers 503 when an indicator is down (a database, once there is one), and the serve probe fails. That is correct.
- The agent-ops format hook runs `./mvnw spotless:apply` on the session's Java files at Stop; it needs the wrapper and finds the JDK from `.java-version` like the Makefile.
