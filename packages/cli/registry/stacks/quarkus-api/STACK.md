---
schema_version: 1
id: quarkus-api
kind: stack
name: Quarkus REST API (Java)
description: A Java JSON API on Quarkus with Quarkus REST and Jackson, built with Maven and make. One error envelope for every failure, a validated config mapping, request ids and structured JSON logs, readiness checks, Error Prone and NullAway at compile time, and tests through @QuarkusTest and the packaged application.
tags: [java, api, make]
tools: [java, mvn, make, git]
decisions:
  - "JDK: the newest LTS release Quarkus supports (default). Its major goes in `.java-version` and pom.xml's `<java.version>`; never an update release."
  - "Quarkus: the newest platform release (default), or the current LTS stream when the team upgrades only between LTS releases."
  - "Build tool: Maven through the committed wrapper (default). Gradle with the Kotlin DSL and a version catalog only when the user asks; then translate each Makefile target one for one and keep every check."
  - "Runtime: JVM mode from `target/quarkus-app/` (default). A native executable (GraalVM or Mandrel, `-Dquarkus.native.enabled=true`) only when the user asks for it; then add a native build and a native `*IT` run to the Makefile and verify."
  - "Root package: `app` (default), fixed so the shipped sources need no rename. To rename it, move `src/main/java/app` and `src/test/java/app`, change every `package app` and `import app.` line and the ArchitectureTest package names in one change, then run `make compile test`."
  - "Formatter: palantir-java-format through Spotless (default; 4 spaces, 120 columns), or google-java-format (`<googleJavaFormat/>`) when the user prefers 2 spaces."
  - "Error body: the `{\"error\":{\"tag\",\"message\",\"retryable\"}}` envelope the other API stacks use (default), or RFC 9457 Problem Details when the API's clients expect them; then change `ErrorEnvelope`, `ErrorMappers` and their tests together."
  - "Listen address: HOST 127.0.0.1 and PORT 8080 (default); a container sets HOST=0.0.0.0."
  - "Proving resource: notes held in memory (default), or the project's first real resource with the same routes and tests. Persistence: none (default); a database store implements NoteStore and replaces InMemoryNoteStore."
  - "Coverage floor: 70% of lines from unit and @QuarkusTest tests (default; `coverage.minimum` in pom.xml)."
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
    expect: { http: "http://127.0.0.1:${PORT}/q/health/ready", within: 120s }
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
  test: Unit and @QuarkusTest tests (*Test)
  coverage: Unit and @QuarkusTest tests with the JaCoCo line-coverage floor
  test-integration: Integration tests (*IT) against the packaged application in its own process
  build: JVM application in target/quarkus-app (run its quarkus-run.jar)
  serve: Build, then run the application in the foreground until SIGINT or SIGTERM
  ci: "Everything CI runs (fmt-check, enforcer, every test, coverage, the build)"
  clean: Remove build output
---

# Quarkus REST API (Java)

A JSON service on Quarkus and Quarkus REST (Jakarta REST on Vert.x): one error table, one envelope for every failure (the framework's own rejections included), request ids, one JSON access record per request, SmallRye Health, a build-time OpenAPI document and a graceful stop on SIGTERM. Maven builds it through its wrapper in JVM mode, and the `Makefile` is the entry point for every task.

## What stacks wrote

A working slice that passes every check once Setup fills the versions. `pom.xml` uses `quarkus` packaging, imports the Quarkus platform BOM and names every plugin version as an empty property; `.mvn/jvm.config` opens the javac internals Error Prone needs. `src/main/java/app/`: `Main` (`@QuarkusMain`) starts Quarkus or runs `--healthcheck` (`HealthProbe`); `config/AppConfig` is the validated `@ConfigMapping`; `errors/ErrorCode` is the error table and `AppException` carries a row; `notes/` is the in-memory notes resource (`NoteStore`, `InMemoryNoteStore`, records for the note, the create request and a page); `web/` holds `NotesResource`, `ErrorMappers` (`@ServerExceptionMapper` methods for every failure) and `RequestFilters` (request id, query guard, `Cache-Control`, access log). `application.properties` maps the environment, the free test port and ECS JSON logs. Tests: a unit test per package, `AppConfigTest` (SmallRye Config with validation), `NotesResourceTest` (`@QuarkusTest` with RestAssured), `ArchitectureTest` (ArchUnit) and `ApiIT` (`@QuarkusIntegrationTest` against the packaged app). `docs/` has ARCHITECTURE, configuration, `http-api.md` and `guidance/java.md`, the Java rules every agent follows. Creating a note and reading it back through the filters, mappers and store is the payload. Read the code before extending it.

## Setup

No generator; nothing in `src/` comes from code.quarkus.io or the Quarkus CLI.

1. **JDK.** Write the major of the newest Java LTS release that the current Quarkus supports to `.java-version` (the major only, one line) and to `<java.version>` in `pom.xml`. On macOS install it with `brew install openjdk@<major>`; it is keg-only and the Makefile finds it, so don't link it or rely on `mvn`'s JDK: Homebrew's `maven` depends on the newest `openjdk`, which is usually not an LTS.
2. **Versions.** For every other empty `<*.version>` property, read the newest release from `https://repo.maven.apache.org/maven2/<groupId as a path>/<artifactId>/maven-metadata.xml`. Its `<release>` can be a beta or release candidate (`.Beta2`, `.CR1`), so take the highest plain numeric version: `curl -s <url> | grep -o '<version>[0-9.]*</version>' | sort -V | tail -1`. Quarkus versions can have four parts (`x.y.z.w`); keep them whole. The coordinates are in `pom.xml`; the property for Quarkus is `io.quarkus.platform:quarkus-bom`'s, Error Prone's is `error_prone_core`'s.
3. **Wrapper.** Run `mvn -N wrapper:wrapper -Dtype=only-script` once (the `mvn` from Homebrew's `maven`). It writes `mvnw`, `mvnw.cmd` and `.mvn/wrapper/maven-wrapper.properties` pinned to that Maven; commit them. From then on only `./mvnw` runs Maven.
4. `make install`, then `make fmt-check lint compile coverage test-integration build`. Where an installed release rejects shipped code (a relocated extension, a renamed property, a new Error Prone or NullAway finding), fix the code. Keep every compiler flag, Enforcer rule and the coverage floor; a check that is wrong for one place gets `@SuppressWarnings("<check>")` on that member with a comment saying why. Run `make fmt` after editing.
5. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/java.md` and `docs/http-api.md` from AGENTS.md, then run `stacks verify` until it passes. The `api` step runs `make serve` and probes `/q/health/ready` on `PORT`.

## Conventions

`docs/guidance/java.md` holds the Java rules (nullness, injection, errors, logs, testing, Maven) and `docs/http-api.md` the HTTP contract; the shipped code follows both. For this service:

- **Routes**: one resource class per resource in `app.web`, under `/v1/<plural-noun>`. Every query parameter is `@QueryParam("<name>")`, because `RequestFilters` rejects any query parameter the method doesn't declare. The `add-endpoint` skill walks through a new route or resource.
- **Errors**: a new failure is a row in `ErrorCode` (status, tag, fixed message, retryable) and a row in `docs/http-api.md`; code throws `AppException` with that code and a detail for the log. Resources never build an error response themselves.
- **Domain**: resources live in their own package (`app.notes`) with no Jakarta REST, RESTEasy, Vert.x or `app.web` imports, behind a store interface; `ArchitectureTest` enforces it.
- **Config**: a new setting is a method of `AppConfig` with `@WithDefault`, constraints, a case in `AppConfigTest`, a line in `.env.example` and a row in `docs/configuration.md`. No `@ConfigProperty`, no `System.getenv` outside `Main`.
- **Packages**: every package has a `package-info.java` with `@NullMarked`.

## Testing

Unit tests sit beside each package under `src/test/java` (`*Test`, Surefire): the error table, the store's paging and cursors, the config mapping. `NotesResourceTest` (`@QuarkusTest`) starts the app once in the test JVM on a free port and asserts, with RestAssured and AssertJ, status, envelope `tag` and headers for every route, bad bodies (400, 415), bad queries, misses, wrong methods (405) and media types (406). `ApiIT` (`*IT`, Failsafe) runs the packaged app as its own process and checks readiness, a create-read-list round trip, the JSON access record with its request id (from `target/quarkus.log`), the OpenAPI document and the health probe. A new route gets its cases in its resource test and one round trip in an `*IT`.

## Commands

The shipped Makefile (`make help`) has env, install, fmt, fmt-check, lint, compile, test, coverage, test-integration, build, serve, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md with single-test commands: `./mvnw -q test -Dtest=NotesResourceTest` and `./mvnw -q verify -DskipUTs=true -Dit.test=ApiIT`. Run `make serve` in the background when needed and stop only the pid you started.
<!-- stacks:when with=ci-github -->

**CI.** One `ubuntu-latest` job: setup-java from `.java-version`, then `make install` and `make ci`. Record in AGENTS.md that CI never runs `mvn`.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make install` runs `lefthook install` outside CI once `lefthook.yml` exists, so write that file first. pre-commit runs `make fmt` on `*.java` with `stage_fixed: true`, so formatting fixes are restaged; pre-push runs `make lint test`. Compiling checks the whole project, so it stays out of pre-commit.
<!-- stacks:end -->
<!-- stacks:when with=rest-api -->

**API conventions.** The notes resource follows the REST rule. Record in AGENTS.md: the `/v1` prefix (health and OpenAPI stay under `/q`), the `{"error":{"tag","message","retryable"}}` envelope, cursor pagination (`limit` default 20, max 100, `nextCursor`), and 405 without an `Allow` header for a wrong method, since Quarkus REST sends none, with notes as the example.
<!-- stacks:end -->
<!-- stacks:when with=docker-deploy -->

**Image.** Quarkus builds a directory, not one jar: copy `target/quarkus-app/lib/`, `app/`, `quarkus/` and `quarkus-run.jar` into the runtime stage as four `COPY --chown` lines, dependencies first so a source edit reuses the `lib/` layer. `CMD` is `java -jar /app/quarkus-run.jar` and `HEALTHCHECK` runs it with `--healthcheck`, which reads the same `HOST` and `PORT` as the server; `ApiIT` covers it. `.dockerignore` also excludes `target/`.
<!-- stacks:end -->

## Gotchas

- Quarkus's JUnit extension is `io.quarkus:quarkus-junit`; memory says `quarkus-junit5`, which is now only a relocation. The platform BOM doesn't manage AssertJ, so it has its own property.
- `<packaging>quarkus</packaging>` with the plugin's `<extensions>true</extensions>` binds the Quarkus build to `package`; `make build` writes `target/quarkus-app/`, which runs only as a whole directory.
- Never run `quarkus:dev` (or `quarkus dev`) as an agent: it watches files, reads keys from the terminal and holds it. The guard hook denies it; `make serve` runs the built app.
- Build-time properties (`quarkus.package.*`, which extensions are active, `quarkus.http.root-path`) are fixed when the app is built: changing one in the environment does nothing until `make build`. Runtime properties (host, port, log level, `app.*`) are read at start.
- Dev Services start a container whenever an extension needs a service (a datasource, Kafka) and no URL is configured, in `@QuarkusTest` too. With Docker absent, tests then fail with a container error, not a config error. Set the service's URL to turn them off.
- `quarkus.http.test-port=0` keeps tests off `PORT` and off the default test port 8081; keep it, or parallel test runs collide.
- Quarkus REST has its own mapper for Jackson's `MismatchedInputException` (unknown field, wrong type), which outranks a mapper for `JsonProcessingException`, so `ErrorMappers` names both. A test showing a 400 without `error.tag` means a framework mapper won.
- `-Xlint:all` drops `classfile`: test jars carry OSGi annotations whose classes aren't on the classpath, and `failOnWarning` would fail on them. Every other lint category stays on.
- Error Prone needs `.mvn/jvm.config`'s exports on every JDK this project supports; keep the file, and copy it into a Docker build. A NullAway error is real: mark the value `@Nullable` (`org.jspecify.annotations`) and handle null, don't suppress.
- Surefire's `argLine` starts with `@{argLine}` so JaCoCo's agent survives, and `pom.xml` declares an empty `argLine` so the reference resolves when JaCoCo is skipped. `quarkus-jacoco` records `@QuarkusTest` coverage into the same data file the agent appends to; the agent skips Quarkus's class loader.
- Quarkus reads a `.env` file from the working directory, so a stray `.env` with `PORT` changes where `make serve` listens.
- The agent-ops format hook runs `./mvnw spotless:apply` on the session's Java files at Stop; it needs the wrapper and finds the JDK from `.java-version` like the Makefile.
