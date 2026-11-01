---
schema_version: 1
id: spring-boot-web
kind: stack
name: Spring Boot web app (Thymeleaf + htmx)
description: A server-rendered Java web app on Spring Boot with Thymeleaf templates and htmx for partial page updates, built with Maven and make, with no JavaScript build. Forms validate on the server and work without JavaScript, Spring Security checks CSRF tokens, error pages come from one table, and tests read the rendered HTML through MockMvc and a browser without JavaScript.
tags: [java, web, make]
tools: [java, mvn, make, git]
decisions:
  - "JDK: the newest LTS release Spring Boot supports (default). Its major goes in `.java-version` and pom.xml's `<java.version>`; never an update release."
  - "Build tool: Maven through the committed wrapper (default). Gradle with the Kotlin DSL and a version catalog only when the user asks; then translate each Makefile target one for one and keep every check."
  - "Root package: `app` (default), fixed so the shipped sources need no rename. To rename it, move `src/main/java/app` and `src/test/java/app`, change every `package app` and `import app.` line and the ArchitectureTest package names in one change, then run `make compile test`."
  - "Templates: Thymeleaf (default), which Spring Boot configures and agents know; jte for compile-checked templates only when the user asks, then port every template and its tests together."
  - "Interactivity: htmx from a WebJar for partial updates, with every form also working as a plain post (default). No JavaScript build; add one only for a widget htmx can't express."
  - "Sign-in: none, every page public (default). Spring Security is there for CSRF tokens and response headers; add `formLogin` and a user store in `SecurityConfig` when the app needs accounts."
  - "Formatter: palantir-java-format through Spotless (default; 4 spaces, 120 columns), or google-java-format (`<googleJavaFormat/>`) when the user prefers 2 spaces."
  - "Listen address: HOST 127.0.0.1 and PORT 8080 (default); a container sets HOST=0.0.0.0. Behind TLS, set SESSION_COOKIE_SECURE=true."
  - "Proving page: notes held in memory with the add-note form (default), or the project's first real resource with the same controller, templates and tests. Persistence: none (default); a database store implements NoteStore and replaces InMemoryNoteStore."
  - "Coverage floor: 70% of lines from unit and page tests (default; `coverage.minimum` in pom.xml)."
env:
  PORT: "8080"
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: lint, layer: lint, run: make lint }
  - { name: compile, layer: typecheck, run: make compile }
  - { name: test, layer: test, run: make coverage }
  - { name: test-integration, layer: test, run: make test-integration }
  - { name: build, layer: build, run: make build }
  - name: web
    phase: serve
    layer: serve
    run: make serve
    expect: { http: "http://127.0.0.1:${PORT}/", within: 120s }
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
  test: Unit tests and page tests without a server (*Test)
  coverage: Unit and page tests with the JaCoCo line-coverage floor
  test-integration: Integration tests (*IT) against the app on a random port
  build: Executable jar at target/app.jar
  serve: Build, then run the jar in the foreground until SIGINT or SIGTERM
  ci: "Everything CI runs (fmt-check, enforcer, every test, coverage, the jar)"
  clean: Remove build output
---

# Spring Boot web app (Thymeleaf + htmx)

A server-rendered web app on Spring Boot and Spring MVC: Thymeleaf pages in one layout, a form validated on the server that works with and without JavaScript, htmx swapping in the part of the page a post changes, CSRF tokens from Spring Security, one error table behind every error page, request ids, JSON access logs, Actuator health and a graceful stop on SIGTERM. Maven builds it through its wrapper and the `Makefile` is the entry point for every task.

## What stacks wrote

A working slice that passes every check once Setup fills the versions. `pom.xml` imports the Spring Boot BOM instead of using the parent POM and names every plugin version, htmx's and jsoup's as an empty property; `.mvn/jvm.config` opens the javac internals Error Prone needs. `src/main/java/app/`: `Application` starts Spring or runs `--healthcheck` (`HealthProbe`); `config/AppProperties` is the validated settings record; `errors/ErrorCode` is the error table (status, title, message) and `AppException` carries a row; `notes/` is the in-memory notes resource (`Note`, `NoteForm` with its validation messages, `NoteStore`, `InMemoryNoteStore`); `web/` holds `NotesController` (the home page with the add form, a page per note, fragment or full page by the `HX-Request` header), `PageExceptionHandler` and `ErrorPageController` (every failure renders `error.html`), `SecurityConfig` (CSRF and headers, every page public, no users) and `RequestLogFilter` (request id, access log). `src/main/resources/` has `application.yaml` (environment, session cookie, Actuator, ECS JSON logs), `templates/` (`layout.html`, `notes/index.html`, `notes/show.html`, `error.html`) and `static/css/site.css`; htmx is a WebJar. Tests: a unit test per package, `NotesControllerTest` (`@WebMvcTest` with `MockMvcTester`, reading the HTML with jsoup), `ArchitectureTest` (ArchUnit) and `WebIT` (a random port, driven by HtmlUnit with JavaScript off). `docs/` has ARCHITECTURE, configuration, `web.md` (pages, forms, htmx, errors, security) and `guidance/java.md`. Adding a note through the real form, CSRF token and redirect included, is the payload. Read the code before extending it.

## Setup

No generator; nothing in `src/` comes from Spring Initializr.

1. **JDK.** Write the major of the newest Java LTS release that the current Spring Boot supports to `.java-version` (the major only, one line) and to `<java.version>` in `pom.xml`. On macOS install it with `brew install openjdk@<major>`; it is keg-only and the Makefile finds it, so don't link it or rely on `mvn`'s JDK: Homebrew's `maven` depends on the newest `openjdk`, which is usually not an LTS.
2. **Versions.** For every other empty `<*.version>` property, read the newest release from `https://repo.maven.apache.org/maven2/<groupId as a path>/<artifactId>/maven-metadata.xml`. Its `<release>` can be a milestone or release candidate (`-M1`, `-RC1`), so take the highest plain numeric version: `curl -s <url> | grep -o '<version>[0-9.]*</version>' | sort -V | tail -1`. The coordinates are in `pom.xml`; the property for Spring Boot is `spring-boot-dependencies`'s, Error Prone's is `error_prone_core`'s, htmx's is `org.webjars.npm:htmx.org`'s. Thymeleaf, Spring Security, HtmlUnit and the WebJars locator come from the Boot BOM and get no property.
3. **Wrapper.** Run `mvn -N wrapper:wrapper -Dtype=only-script` once (the `mvn` from Homebrew's `maven`). It writes `mvnw`, `mvnw.cmd` and `.mvn/wrapper/maven-wrapper.properties` pinned to that Maven; commit them. From then on only `./mvnw` runs Maven.
4. `make install`, then `make fmt-check lint compile coverage test-integration build`. Where an installed release rejects shipped code (a moved Boot test class, a renamed property, a changed htmx attribute, a new Error Prone or NullAway finding), fix the code. Keep every compiler flag, Enforcer rule, the CSRF check and the coverage floor; a check that is wrong for one place gets `@SuppressWarnings("<check>")` on that member with a comment saying why. Run `make fmt` after editing.
5. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/java.md` and `docs/web.md` from AGENTS.md, then run `stacks verify` until it passes. The `web` step runs `make serve` and probes the home page on `PORT`.

## Conventions

`docs/guidance/java.md` holds the Java rules (nullness, injection, errors, logs, testing, Maven) and `docs/web.md` the page rules; the shipped code follows both. For this app:

- **Pages**: one `@Controller` per resource in `app.web` returning view names; each template replaces its `<html>` with the layout fragment and supplies its `<title>` and `<main>`. Text goes through `th:text`, links through `@{...}`. The `add-page` skill walks through a new page or form.
- **Forms**: a bean in the domain package with Bean Validation messages written for the page; `th:action` with `method="post"` so the CSRF field is added. Errors re-render the bound form with status 200; a plain post that succeeds redirects with a flash attribute.
- **htmx**: the form carries `th:hx-post`, `hx-target` and `hx-swap` beside `th:action`; the handler answers `HX-Request` with the named fragment and everything else with the full page. Browser libraries are WebJars referenced without a version.
- **Errors**: a new failure is a row in `ErrorCode` (status, title, fixed message) and in `docs/web.md`'s table; code throws `AppException` with that code and a detail for the log.
- **Domain**: resources live in their own package with no Spring MVC, Spring Security, Thymeleaf or servlet imports, behind a store interface; `ArchitectureTest` enforces it.
- **Config**: a new setting is a component of `AppProperties` with a `@DefaultValue`, constraints, a case in `AppPropertiesTest`, a line in `.env.example` and a row in `docs/configuration.md`. No `@Value`, no `System.getenv` outside `Application`.
- **Packages**: every package has a `package-info.java` with `@NullMarked`.

## Testing

Unit tests sit beside each package under `src/test/java` (`*Test`, Surefire): the error table, the store, the form's rules and messages, property binding through `ApplicationContextRunner`. `NotesControllerTest` renders every template without a server: `@WebMvcTest` loads the controller, filter, advice and imported `SecurityConfig`, `MockMvcTester` posts with `.with(csrf())`, and jsoup asserts the layout, the CSRF field, fragment versus full page by `HX-Request`, field errors, the redirect and flash, a refused post without the token, misses and a wrong method (405 with `Allow`). It starts each test with a fresh store. `WebIT` (`*IT`, Failsafe) starts the app on a random port: HtmlUnit with JavaScript off fills and submits the real form and follows the redirect, then it checks the htmx WebJar and stylesheet, the 403 and 404 pages rendered outside Spring MVC, health, the JSON access record and the health probe. A new page gets its cases in its controller test and, when it has a form, a browser flow in an `*IT`.

## Commands

The shipped Makefile (`make help`) has env, install, fmt, fmt-check, lint, compile, test, coverage, test-integration, build, serve, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md with single-test commands: `./mvnw -q test -Dtest=NotesControllerTest` and `./mvnw -q verify -DskipUTs=true -Dit.test=WebIT`. Run `make serve` in the background when needed and stop only the pid you started.
<!-- stacks:when with=ci-github -->

**CI.** One `ubuntu-latest` job: setup-java from `.java-version`, then `make install` and `make ci`. Record in AGENTS.md that CI never runs `mvn`.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make install` runs `lefthook install` outside CI once `lefthook.yml` exists, so write that file first. pre-commit runs `make fmt` on `*.java` with `stage_fixed: true`, so formatting fixes are restaged; pre-push runs `make lint test`. Compiling checks the whole project, so it stays out of pre-commit.
<!-- stacks:end -->

## Gotchas

- Spring Boot 4 split its starters: the web starter is `spring-boot-starter-webmvc` with `spring-boot-starter-webmvc-test`, security tests come from `spring-boot-starter-security-test`, and test classes moved packages (`org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest`). Memory says `spring-boot-starter-web` and `TestRestTemplate`; use the shipped names.
- Thymeleaf 3.1 needs `~{...}` around fragment expressions and removed `#request`, `#session` and `#servletContext` from templates; put what a page needs in the model.
- Template errors surface only when a page renders, so every template has a test that renders it.
- htmx 4 changed defaults from htmx 2: attributes no longer inherit unless written `hx-target:inherited`, and 4xx and 5xx responses are swapped. The shipped form puts every `hx-*` attribute on the form itself and answers validation errors with 200, which works on both.
- The WebJars resolver writes the version into `@{/webjars/...}` links (`/webjars/htmx.org/<version>/dist/htmx.min.js`), and the unversioned path is served too. Assert on the prefix and file name, not the whole URL.
- Spring Security sends `Cache-Control: no-cache, no-store` on every response, static files included. Set a cache period for `/css/**` and `/webjars/**` only when deploying behind a CDN, and keep pages uncached.
- A `@WebMvcTest` slice loads no `@Configuration` classes and no `@ConfigurationProperties`, so tests import `SecurityConfig` and enable `AppProperties` themselves. Without `SecurityConfig` the slice falls back to Boot's default chain, which asks for a login.
- Without a `UserDetailsService` bean Spring Boot creates a development user and logs its password at every start; `SecurityConfig` declares an empty one. Replace it with a real user store when adding sign-in.
- `<annotationProcessorPaths>` turns off processor discovery on the classpath, so the configuration processor, Error Prone and NullAway are all listed there.
- Error Prone needs `.mvn/jvm.config`'s exports; keep the file, and copy it into a Docker build. A NullAway error is real: mark the value `@Nullable` (`org.jspecify.annotations`) and handle null.
- `failOnWarning` covers javac's lint warnings too, deprecations included. Move off a deprecated API rather than dropping the flag.
- Without the parent POM nothing configures Failsafe for Boot: its `classesDirectory` points at `target/classes`, because the repackaged jar keeps classes under `BOOT-INF/`.
- Surefire's `argLine` starts with `@{argLine}` so JaCoCo's agent survives, and `pom.xml` declares an empty `argLine` so the reference resolves when JaCoCo is skipped.
- `make serve` runs the built jar, not `./mvnw spring-boot:run`, which forks a JVM that a signal to Maven can leave running. The guard hook denies `spring-boot:run`, `mvn` without the wrapper, and npm, pnpm, yarn or bun installs.
- A `${PORT:8080}` placeholder resolves an empty `PORT` to empty, not the default; unset a variable rather than blanking it.
- The agent-ops format hook runs `./mvnw spotless:apply` on the session's Java files at Stop; it needs the wrapper and finds the JDK from `.java-version` like the Makefile.
