# Java stacks for the bundled registry: research and proposal

Date: 2026-10-31. Read-only research; nothing in the repo was changed.

## Summary

Propose six Java stacks, all built with Maven through a generated `mvnw` and driven by a Makefile (`make` tag), on the current LTS JDK (25) recorded at setup:

| Rank | Id | Priority | One line |
| --- | --- | --- | --- |
| 1 | `spring-boot-api` | P1 | Spring Boot JSON API, in-memory proving resource, Postgres as a fragment |
| 2 | `java-cli` | P1 | picocli command-line tool packaged as a runnable jar, native image optional |
| 3 | `spring-boot-react` | P1 | Spring Boot API plus a React SPA (Vite) in one repo, like `python-react` |
| 4 | `spring-boot-web` | P2 | Server-rendered Spring Boot app with Thymeleaf and HTMX |
| 5 | `quarkus-api` | P2 | Quarkus JSON API with Dev Services and native-image readiness |
| 6 | `java-library` | P2 | A Java library built for Maven Central, proven by a consumer smoke |

None of them can ship until a P0 format and harness change lands (section "P0: what must change before any Java stack"): a `maven` ecosystem in `@steamfield/stacks-format`, a `pom.xml` (and `gradle/libs.versions.toml`) reader in `core/deps.ts::readDependencies`, Java version-literal detection in `core/validate/version-sensitive.ts`, and `tag=java` branches in `agent-ops`, `ci-github`, `git-hooks` and `docker-deploy`.

Key recommendations:

- **Build tool: Maven by default, not Gradle.** Maven is the majority build tool by every source found (JetBrains 2025: 67% "most widely used"; Quarkus build telemetry June 2026: 85% Maven, and Maven grew year over year). Its POM is declarative XML that the CLI can read without running the build; a Gradle Kotlin DSL build is a program. Gradle is a per-project decision line, not a separate stack.
- **Wrapper: don't ship it; generate it at setup.** Maven Wrapper's default `only-script` type is two shell scripts plus `.mvn/wrapper/maven-wrapper.properties`, no jar. The properties file pins a Maven version, so it is an "ages" artifact the agent creates with `mvn wrapper:wrapper` from Homebrew's `maven`, then commits. Gradle's wrapper needs the binary `gradle-wrapper.jar`, another reason Gradle isn't the default.
- **Versions without literals: no parent POM; import the BOM with property references.** The shipped `pom.xml` uses `${spring-boot.version}`-style references only; Setup writes one `<properties>` block with current releases read from Maven Central metadata. `./mvnw versions:update-properties` refreshes them later. This keeps every version in one block the agent owns.
- **Lint/format/static analysis:** Spotless (palantir-java-format by default, google-java-format as the decision's alternative) for format; Error Prone plus NullAway with JSpecify annotations in the compile step (the `typecheck` layer); Maven Enforcer for dependency convergence and the Java floor; ArchUnit for layering rules. No Checkstyle (overlaps the formatter), no SpotBugs or PMD in the default verify (slow, overlap Error Prone, noisy on Spring).
- **Tests:** JUnit Jupiter (JUnit 6 line), AssertJ, Mockito only where a seam has no real implementation, Spring's `MockMvcTester` for slice tests and `RestTestClient` against a real port, Testcontainers for Postgres. JaCoCo enforces a coverage floor. RestAssured only in Quarkus, where it is the framework's documented default.
- **JDK:** current LTS (25 as of today) from `brew install openjdk@25` (keg-only), recorded at setup in `.java-version` and `maven.compiler.release`/`java.version`. Watch out: macOS ships a `/usr/bin/java` stub, so `tools: [java]` passes even with no JDK.
- **Ecosystem id:** `maven`, names `groupId:artifactId`, covering Gradle projects too (Gradle resolves from the same repositories with the same coordinates). `readDependencies` parses `pom.xml` (direct `<dependencies>`, not `dependencyManagement`) and `gradle/libs.versions.toml` (`[libraries]`); never `build.gradle(.kts)`.

## Evidence

### Popularity

| Signal | Finding | Source |
| --- | --- | --- |
| Stack Overflow 2026, web frameworks (10,281 respondents) | Spring Boot 12.8% (1,314); Quarkus 0.3% (26); Micronaut and Javalin not listed | [survey.stackoverflow.co/2026 web-framework](https://survey.stackoverflow.co/2026/technology/data/web-framework) |
| Stack Overflow 2025 | Spring Boot about 14.7%, 53.7% admired | [habr.com write-up](https://habr.com/ru/articles/933180), [dev.to](https://dev.to/davidshq/thoughts-on-stackoverflow-2025-developer-survey-part-1-3d5o) |
| JetBrains State of Java 2025 | Spring 65% of Java developers; Maven 67%, "the most widely used build system"; Java 21 at 40%, 17 at 39%, 8 at 31% regularly used | [lp.jetbrains.com/the-state-of-java-2025](https://lp.jetbrains.com/the-state-of-java-2025) |
| Quarkus build analytics (2026-06-30, opt-in telemetry) | Maven about 85% of Quarkus builds (+2.5 pp year over year), Gradle about 15%; Java 21 + 25 about 76% of builds, Java 25 about 22%; total builds +26% year over year | [quarkus.io Insights #253](https://quarkus.io/blog/quarkus-insights-253-build-analytics/) |
| Azul State of Java 2026 (2,039 respondents, Feb 2026) | 62% of organisations use Java to build AI functionality (50% the year before); 81% migrating some Oracle Java to OpenJDK distributions | [Business Wire](https://secure.businesswire.com/news/home/20260210972138/en/Azul-2026-State-of-Java-Survey-Report-62-of-Enterprises-Now-Leverage-Java-to-Power-AI-Functionality-41-Rely-on-High-Performance-Java-Platforms-to-Reduce-Cloud-Compute-Costs) |
| Older Maven/Gradle splits | Snyk JVM report: Maven 64%, Gradle 25%; Baeldung: 75%/20%; JRebel 2022: 68%/23% | [i-programmer](https://i-programmer.info/news/80-java/13478-the-true-state-of-java-and-its-ecosystem-part-3.html), [keyholesoftware summary](https://keyholesoftware.com/?p=160301) |
| GitHub stars (`gh api`, 2026-10-31) | spring-boot 81.7k; gradle 18.9k; quarkus 16.0k; langchain4j 13.3k; spring-ai 9.6k; testcontainers-java 8.8k; javalin 8.4k; error-prone 7.3k; micronaut-core 6.4k; google-java-format 6.2k; spotless 5.7k; picocli 5.5k; apache/maven 5.4k; NullAway 4.1k; spotbugs 4.0k; helidon 3.8k; openjdk/jfx 3.3k; thymeleaf 3.0k; jreleaser 1.2k; spring-modulith 1.2k; jte 1.1k; palantir-java-format 0.9k; htmx 49.6k | GitHub API |

Not found: a 2026 JetBrains Java report, a 2025/2026 JRebel/Perforce report with build-tool or framework splits, or public per-artifact Maven Central download counts (Sonatype doesn't publish them). Spring Initializr has made Gradle its default selection, but no published Initializr statistics split Maven and Gradle ([dev.to](https://dev.to/ksilz/how-to-build-java-applications-today-69-52le)). Stars measure attention, not use; Spring Boot's lead is consistent across every source.

### Platform facts the stacks depend on

- **Spring Boot 4.0** (GA 2025-11-20) on Spring Framework 7: Java 17 minimum, 21/25 recommended; Jackson 3 by default (`tools.jackson.*` packages); JSpecify `@NullMarked` across the portfolio; JUnit 4 and Undertow removed; **modular starters**, so `spring-boot-starter-web` became `spring-boot-starter-webmvc` with a `spring-boot-starter-webmvc-test` companion; `RestTestClient` replaces `TestRestTemplate`. A secondary source reports 4.1.0 on 2026-06-10 (unverified). [spring.io release highlights](https://spring.io/projects/release-highlights/), [Spring Boot 4 migration guide summary](https://stevenpg.com/posts/ultimate-guide-spring-boot-4-migration/), [OpenRewrite modular starters recipe](https://docs.openrewrite.org/recipes/java/spring/boot4/migratetomodularstarters-community-edition), [AutoConfigureRestTestClient javadoc](https://docs.spring.io/spring-boot/api/java/org/springframework/boot/resttestclient/autoconfigure/AutoConfigureRestTestClient.html), [issoh.co.jp on 4.1](https://www.issoh.co.jp/tech/details/10124/).
- **JUnit 6.0** GA 2025-09-30: Java 17 baseline, unified versions across Platform/Jupiter/Vintage, JSpecify annotations, Vintage deprecated. [InfoQ](https://www.infoq.com/news/2025/10/junit6-java17-kotlin), [release notes](https://docs.junit.org/6.0.3/release-notes.html).
- **Testcontainers 2.0** dropped JUnit 4 and prefixed every module (`postgresql` became `testcontainers-postgresql`); the 2.0 BOM manages only the new ids. Docker 29 raised the minimum API version to 1.44, which broke older Testcontainers/docker-java clients; 2.0.2+ works. [OpenRewrite rename recipe](https://docs.openrewrite.org/recipes/java/testing/testcontainers/testcontainers2dependencies), [no42 blog](https://blog.no42.org/article/docker-broke-the-internet), [Debezium DBZ-9699](https://issues.redhat.com/browse/DBZ-9699).
- **Maven Wrapper** default type `only-script`: `mvnw`, `mvnw.cmd` and `.mvn/wrapper/maven-wrapper.properties` (pins `distributionUrl`), no jar. [maven.apache.org/tools/wrapper](https://maven.apache.org/tools/wrapper/). Maven 4.0 is still at release candidates ([4.0.0-rc-4 notes](https://maven.apache.org/docs/4.0.0-rc-4/release-notes.html)); target Maven 3.9 behaviour.
- **Gradle** current is 9.5.0; its wrapper jar is a checked binary ([services.gradle.org/versions/current](https://services.gradle.org/versions/current)).
- **Quarkus** recommends the 3.33 LTS line (3.33.4 on 2026-10-01); 3.38 is the current minor. [quarkus.io/releases](https://quarkus.io/releases), [quarkus-dev 3.33.4](https://groups.google.com/g/quarkus-dev/c/RcLcmY7eoSI).
- **Spring AI 2.0** GA on Boot 4 / Framework 7; starters `spring-ai-starter-model-ollama`, `spring-ai-starter-model-openai`. [codecentric](https://www.codecentric.de/en/knowledge-hub/blog/integrating-llms-ollama-spring-ai), [thenote.app](https://thenote.app/post/en/spring-ai-2-0-0-ga-available-now-zrojeblbhv).
- **JDK on Homebrew:** `openjdk` is now 26 (non-LTS); `openjdk@25` is the LTS line, keg-only, bottled for Apple Silicon; cask `temurin@25` is the alternative (a .pkg installer, which asks for an admin password, so not agent-friendly). [formulae.brew.sh/formula/openjdk@25](https://formulae.brew.sh/formula/openjdk@25), [openjdk](https://formulae.brew.sh/formula/openjdk).
- **Error Prone/NullAway** on JDK 16+ need javac internals exported (`-J--add-exports=jdk.compiler/com.sun.tools.javac.*=ALL-UNNAMED`, or `.mvn/jvm.config` when the compiler runs in process); NullAway's JSpecify mode needs JDK 22+ or `-XDaddTypeAnnotationsToSymbol=true` on 21. JDK 25 avoids that flag. [NullAway wiki](https://github.com/uber/nullaway/wiki), [Spring Shell commit](https://github.com/spring-projects/spring-shell/commit/63eb82eaa80f85d1b4c76552621026ce12288a1c).

## Cross-cutting decisions

### Maven vs Gradle

Recommend **Maven** as the default for every Java stack, with a decision line "Build tool: Maven (default). Gradle with the Kotlin DSL and a version catalog only when the user asks; then translate the Makefile targets one for one and keep every check."

Reasons:

1. Usage: every source puts Maven at roughly two thirds or more of Java developers, and Quarkus's 2026 telemetry shows Maven's share rising (85%).
2. Readability without execution: `pom.xml` is data. The CLI can read root dependency names without running anything (trust model point 1). A `build.gradle.kts` is Kotlin code; the only safely readable Gradle file is `gradle/libs.versions.toml`, and a project isn't obliged to use one.
3. No binary in the project: the Maven Wrapper's default type has no jar. Gradle's wrapper needs `gradle/wrapper/gradle-wrapper.jar`.
4. Agent reliability: Maven's lifecycle is fixed (`validate`, `compile`, `test`, `package`, `verify`), so a Makefile target maps to one phase. Gradle's configuration cache, Kotlin DSL compile errors and plugin DSL churn cost agent loops.

Cost of the choice: Spring Initializr now defaults to Gradle, and Android/Kotlin developers expect Gradle. A Gradle variant stack would duplicate the whole recipe for one decision, so don't ship one; keep it as the decision line.

### Wrapper and Maven version

Don't ship `mvnw`, `mvnw.cmd` or `.mvn/wrapper/`. Setup runs `mvn -N wrapper:wrapper` (Homebrew's `maven` formula supplies `mvn`) to generate the `only-script` wrapper pinned to the installed Maven, and the project commits it. After that the Makefile only calls `./mvnw`. Reasoning: the properties file pins a Maven version (an "ages" fact, owned by the agent per the product's split), and generating it is exactly the kind of lockfile-like output the anatomy allows a generator for. The `install` target fails with a clear message if `./mvnw` is missing rather than falling back to `mvn`, so CI and fresh clones use the pinned Maven.

`tools:` lists `java`, `mvn`, `make`, `git` (plus `docker` where Testcontainers is used). `mvn` is needed only once for the wrapper; listing it costs nothing.

### Versions without literals

The shipped `pom.xml` must contain no version numbers. Two Maven facts make that possible:

- A `<parent>` element requires a literal version, so **don't use `spring-boot-starter-parent`**. Use Spring Boot's documented "without the parent POM" form: import `org.springframework.boot:spring-boot-dependencies` in `<dependencyManagement>` with `<version>${spring-boot.version}</version>`, and give `spring-boot-maven-plugin` the same property.
- Every other version (unmanaged plugins: Spotless, JaCoCo, Error Prone, NullAway, Enforcer, compiler, Surefire, Failsafe; unmanaged libraries such as ArchUnit or springdoc) is a `${name.version}` reference. The shipped POM has no `<properties>` values for them, so it fails to build until Setup writes them, which is the intent: an unconfigured project fails loudly.

Setup step text (proposed): "For each `${*.version}` property the POM references, read the current release from `https://repo.maven.apache.org/maven2/<group path>/<artifact>/maven-metadata.xml` (`<release>`) and write it into the `<properties>` block, then run `./mvnw versions:display-property-updates` and `versions:display-plugin-updates` and resolve anything newer. Write `java.version` (or `maven.compiler.release`) from the installed JDK's major." Later, `make deps-update` runs `./mvnw versions:update-properties` and the test suite.

Without the parent, the stack must declare what the parent did implicitly: `maven-compiler-plugin` with `<release>${java.version}</release>` and `-parameters`, UTF-8 source encoding, and the Surefire/Failsafe plugins with explicit versions. That is about 20 extra lines and makes every rule visible.

For a Gradle opt-in: versions go in `gradle/libs.versions.toml`, written by the agent; the shipped `build.gradle.kts` references `libs.*` only.

`core/validate/version-sensitive.ts` doesn't yet look at Java files. Add `pom.xml`, `build.gradle(.kts)`, `settings.gradle(.kts)`, `gradle/libs.versions.toml`, `.mvn/wrapper/maven-wrapper.properties`, `gradle/wrapper/gradle-wrapper.properties` and `.java-version` to `VERSION_SENSITIVE`. `PINNED` (`x.y.z`) already catches most literals, but `<release>25</release>`, `<java.version>25</java.version>` and `version = "4.1"` are two-part or bare-major values it misses; add an XML branch for `<(?:version|release|[\w.-]+\.version)>\s*\d` in shipped POMs.

### Lint, format and static analysis

| Tool | Layer | Default? | Notes |
| --- | --- | --- | --- |
| Spotless (`com.diffplug.spotless:spotless-maven-plugin`) with palantir-java-format | lint (`spotless:check`) | yes | Palantir is google-java-format's engine with 4-space indent and 120 columns, close to IntelliJ defaults and most Spring code. Decision line offers google-java-format (2-space, 100). Both are deterministic. Spotless also formats `pom.xml` (sortpom), Markdown and YAML if wanted; keep it to Java and POM |
| Error Prone (`com.google.errorprone:error_prone_core`) | typecheck (runs in `compile`) | yes | Compiler plugin; errors fail compilation. Needs the `--add-exports` flags on JDK 16+ |
| NullAway (`com.uber.nullaway:nullaway`) with JSpecify (`org.jspecify:jspecify`) | typecheck | yes | `@NullMarked` packages; Spring 7 and JUnit 6 are JSpecify-annotated, so nullness is checked across framework calls. The closest Java gets to "strict types" |
| Maven Enforcer (`org.apache.maven.plugins:maven-enforcer-plugin`) | lint | yes | `requireJavaVersion` from `java.version`, `requireMavenVersion`, `dependencyConvergence`, `banDuplicatePomDependencyVersions`, `requirePluginVersions` (proves Setup wrote every version) |
| ArchUnit (`com.tngtech.archunit:archunit-junit5`) | test | yes for apps | Encodes the layering rules (domain doesn't import web; only `config` reads env) as a test, which is what keeps an agent's later edits honest |
| JaCoCo (`org.jacoco:jacoco-maven-plugin`) | test | yes | `check` goal with a floor (default 70% line, decision line) |
| Checkstyle | — | no | Mostly style the formatter already decides; naming/Javadoc rules are noisy for agents |
| SpotBugs, PMD | — | no | Slow bytecode passes that overlap Error Prone; frequent false positives on Spring proxies. Optional `make spotbugs` only in `java-library` |
| OWASP dependency-check | — | no | Needs an NVD API key to be usable at speed; fails the no-credentials rule. Mention `make audit` via `osv-scanner` (brew) as optional |

### Tests

- JUnit Jupiter via `org.junit:junit-bom` (managed by the Spring Boot BOM in Spring stacks), AssertJ (`org.assertj:assertj-core`), Mockito (`org.mockito:mockito-core`, `mockito-junit-jupiter`) only for seams without a real fake.
- Spring: `spring-boot-starter-test` plus the modular `spring-boot-starter-webmvc-test`; `MockMvcTester` (AssertJ-style) for controller slices; `@SpringBootTest(webEnvironment = RANDOM_PORT)` with `RestTestClient` for the in-process HTTP integration test. No RestAssured in Spring stacks: Spring's own clients cover it with one less dependency.
- Surefire runs `*Test`, Failsafe runs `*IT` in `verify`, so `make test` and `make test-integration` map to separate verify steps, like `go-api`.
- Testcontainers (`org.testcontainers:testcontainers-junit-jupiter`, `testcontainers-postgresql`, plus `org.springframework.boot:spring-boot-testcontainers` for `@ServiceConnection`) only where a database is present.
- Surefire needs `-XX:+EnableDynamicAgentLoading` or Mockito's agent configured (`-javaagent` from the dependency path) to avoid the JDK 21+ dynamic-agent warning becoming an error in a future JDK; ship the `argLine` that loads Mockito as an agent.

### JDK policy

- Default: the current LTS (25 today). Decision line: "JDK: the newest LTS that the stack's framework supports (default). Record the major in `.java-version` and `java.version`; never pin an update release."
- Install: `brew install openjdk@25 maven` (and `brew install --cask docker` or OrbStack for Testcontainers stacks). `openjdk@25` is keg-only, so the Makefile resolves `JAVA_HOME` itself: if `JAVA_HOME` is unset and `/usr/libexec/java_home -v "$(cat .java-version)"` fails, try `$(brew --prefix openjdk@25)/libexec/openjdk.jdk/Contents/Home`, else fail with the brew command. Setup can instead run `sudo ln -sfn ... /Library/Java/JavaVirtualMachines/` but that needs a password, so the Makefile route is the agent-safe one.
- `.java-version` is read by `actions/setup-java` (`java-version-file`), jenv and asdf/mise, so CI and local agree.

### The `make` task runner

Each stack ships a `Makefile.tmpl` wrapping `./mvnw -B -ntp` (batch mode, no transfer progress, which keeps agent output short). It gives the fragments their `tag=make` branches, mirrors `go-api`/`python-api`, and gives the Claude settings stable `Bash(make test)` permissions. Targets: `install` (`./mvnw -q dependency:go-offline`, plus guarded `lefthook install`), `fmt`, `fmt-check`, `compile` (Error Prone + NullAway), `lint` (enforcer + spotless check), `test`, `test-integration`, `coverage`, `build` (`package -DskipTests`), `serve`, `deps-update`, `ci`, `clean`.

## P0: what must change before any Java stack

1. **Format** (`packages/format/src/allowlist.ts`): `Ecosystem = npm | pypi | go | crates | maven`. Names are `groupId:artifactId`. They can't collide with other ecosystems (npm names can't contain `:`), so `deps-ambiguous` stays quiet. Additive change per `.claude/rules/format/format.md`; `stacks-api` must accept the new key before the index publishes Java entries, so it ships via `bun run release:format` first.
2. **Reader** (`packages/cli/src/core/deps.ts`): add `readMaven`:
   - `pom.xml`: direct children of `/project/dependencies/dependency` (`groupId` + `artifactId`), ignoring `<dependencyManagement>` (imports, not dependencies) and plugins. Major: the literal `<version>` when present, `${prop}` resolved from the same POM's `<properties>`, else `null` (BOM-managed). Read `spring-boot-dependencies`'s imported version from `dependencyManagement` as that BOM's own major so Spring stats still get a Boot major. Multi-module: root POM only (matching the root-manifest rule elsewhere). No network, no `~/.m2` reads, no `mvn help:effective-pom`.
   - `gradle/libs.versions.toml` (TOML, already parsed by the existing `toml` helper): `[libraries]` entries as `module = "g:a"` or `group` + `name`; version from `version` or `version.ref` into `[versions]`. Never parse `build.gradle(.kts)`.
   - The CLI has no XML parser dependency. A POM subset parser is small but must handle comments, CDATA and namespaces; prefer an existing catalog dependency if one exists, else a scoped, tested reader. This is the largest P0 item.
3. **Allowlist** (`registry/allowlist.json`) gains `maven` names; `registry/deps/maven.json` dependency cards; `scripts/index/allowlist.ts` already fails on missing names.
4. **Validate** (`core/validate/version-sensitive.ts`): the Java files and XML literal pattern above.
5. **Fragments**:
   - `agent-ops`: `lint-on-write.sh` and `format-changed.sh` need a `*.java` branch. Running Maven per write is too slow (2 to 10 s JVM start); use the palantir/google-java-format CLI (brew `google-java-format` exists; palantir has no formula) only when installed, otherwise skip quietly and leave format to `make fmt` at stop. Recommendation: a format-on-stop hook that runs `./mvnw -q spotless:apply` once, not per write.
   - `ci-github`: `tag=java` branch: `actions/setup-java` with `distribution: temurin`, `java-version-file: .java-version`, `cache: maven`, then the make targets. Testcontainers works on `ubuntu-latest`'s Docker.
   - `git-hooks`: pre-commit `./mvnw -q spotless:apply -DspotlessFiles=<staged regex>` with stage-fixed, pre-push `make test`. JVM start makes this a few seconds; acceptable.
   - `docker-deploy`: `tag=java` branch: multi-stage `eclipse-temurin` JDK build, then extract layers with `java -Djarmode=tools -jar app.jar extract --layers --launcher` and run on a JRE (or distroless java) image as non-root; healthcheck needs a shell-free probe, so ship a tiny `--healthcheck` mode or use Actuator through `wget` in a JRE image that has it. Don't use `spring-boot:build-image` (Paketo buildpacks pull large builders; slow and network-heavy for a verify).
6. **Search vocabulary**: aliases for `spring`, `springboot`, `jvm`, `maven`, `quarkus`, `picocli`.

## Proposed stacks

### 1. `spring-boot-api` (P1)

**Name:** Spring Boot REST API (Java)

**Description:** A Java JSON API on Spring Boot with Spring MVC and Actuator, built with Maven and make. Problem Details errors, validated configuration properties and structured JSON logs, with Error Prone and NullAway at compile time and in-process HTTP tests.

**Why first:** the only Java framework with double-digit survey share (SO 2026 12.8%, JetBrains 2025 Spring 65% of Java developers), 81.7k stars, and the stack the deferred outline already sketched.

**Dependencies** (all `groupId:artifactId`):

- BOM: `org.springframework.boot:spring-boot-dependencies` (imported)
- runtime: `org.springframework.boot:spring-boot-starter-webmvc`, `org.springframework.boot:spring-boot-starter-validation`, `org.springframework.boot:spring-boot-starter-actuator`, `org.jspecify:jspecify`
- optional runtime (decision): `org.springdoc:springdoc-openapi-starter-webmvc-api` for the committed OpenAPI drift check, mirroring `python-api`'s `check-openapi`
- test: `org.springframework.boot:spring-boot-starter-test`, `org.springframework.boot:spring-boot-starter-webmvc-test`, `org.springframework.boot:spring-boot-resttestclient` (exact Boot 4 artifact of `RestTestClient` auto-config to confirm at authoring), `com.tngtech.archunit:archunit-junit5`
- plugin: `org.springframework.boot:spring-boot-maven-plugin`, `com.diffplug.spotless:spotless-maven-plugin`, `org.apache.maven.plugins:maven-compiler-plugin`, `org.apache.maven.plugins:maven-surefire-plugin`, `org.apache.maven.plugins:maven-failsafe-plugin`, `org.apache.maven.plugins:maven-enforcer-plugin`, `org.jacoco:jacoco-maven-plugin`, `org.codehaus.mojo:versions-maven-plugin`
- annotation processors / compiler plugins: `com.google.errorprone:error_prone_core`, `com.uber.nullaway:nullaway`, `org.springframework.boot:spring-boot-configuration-processor`

**Tools:** `java`, `mvn`, `make`, `git`, `jq`. Brew: `openjdk@25`, `maven`, `make` is in Xcode CLT.

**Proving slice** (`src/main/java/{{package}}/…`; the package is `{{project_slug}}`-derived, and since directory names can't be templated, ship under a fixed `app` package and have Setup rename it, or keep `app` as the documented default; recommend a fixed root package `app` with a decision to rename, which avoids a fragile rename step):

- `Application.java` (thin `main`), `config/AppProperties.java` (`@ConfigurationProperties` record with `@Validated` constraints and defaults; the only place env is read), `errors/AppException.java` + `errors/ErrorCode.java` (one enum table: HTTP status, fixed safe message, retryable), `web/ProblemDetailsHandler.java` (`@RestControllerAdvice` mapping `AppException`, validation, 404, 405 and unexpected errors to RFC 9457 Problem Details with a `code` and `requestId`), `web/RequestIdFilter.java` (validates or generates `X-Request-ID`, puts it in MDC), `notes/Note.java`, `notes/NoteStore.java` (interface), `notes/InMemoryNoteStore.java`, `notes/NotesController.java` (`POST /v1/notes`, `GET /v1/notes/{id}`, cursor-paginated `GET /v1/notes`).
- `src/main/resources/application.yaml`: `logging.structured.format.console: ecs` (Boot's built-in structured logging, since 3.4), Actuator exposing `health` only, `server.shutdown: graceful`, `spring.threads.virtual.enabled: true`, `server.port: ${PORT:8080}`, `server.address: ${HOST:127.0.0.1}`.
- Tests: `config/AppPropertiesTest` (binding and validation failure with `ApplicationContextRunner`), `notes/InMemoryNoteStoreTest`, `web/NotesControllerTest` (`@WebMvcTest` + `MockMvcTester`: success, 400 validation, 404, 405 with `Allow`, Problem Details shape, request id echo), `ArchitectureTest` (ArchUnit layering), `NotesApiIT` (`@SpringBootTest(RANDOM_PORT)` + `RestTestClient`: health, create-read-list round trip, structured log line contains the request id via `OutputCaptureExtension`).
- `pom.xml.tmpl`, `Makefile.tmpl`, `.mvn/jvm.config` (Error Prone exports), `.editorconfig`, `.gitignore`, `.env.example`, `README.md.tmpl`, `docs/{ARCHITECTURE,http-api,configuration,DEVELOPMENT}.md`.
- **The one payload:** `POST /v1/notes` then `GET /v1/notes/{id}` through the real filter chain, error advice and store, plus `/actuator/health` for the probe.

**Verify:**

```yaml
env: { PORT: "8080" }
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: lint, layer: lint, run: make lint }            # enforcer
  - { name: compile, layer: typecheck, run: make compile } # Error Prone + NullAway, main and test
  - { name: test, layer: test, run: make coverage }        # Surefire + JaCoCo floor
  - { name: test-integration, layer: test, run: make test-integration } # Failsafe
  - { name: build, layer: build, run: make build }         # executable jar
  - name: api
    phase: serve
    layer: serve
    run: make serve                                        # java -jar target/app.jar, foreground
    expect: { http: "http://127.0.0.1:${PORT}/actuator/health", within: 90s }
  - { name: readme-filled, layer: check, run: "test -s README.md && ! grep -n 'stacks:fill' README.md" }
```

`make serve` runs the built jar, not `spring-boot:run`, so the probed process is the production artifact and Ctrl+C/SIGTERM reach the JVM directly (`spring-boot:run` forks a child JVM by default, and a SIGTERM to Maven can leave it running).

**Agent-ops worth shipping:**

- `adapters/claude/.claude/settings.json` allowing `make fmt|fmt-check|lint|compile|test|test-integration|coverage|build|ci` and `./mvnw -q -Dtest=* test`.
- A `.claude/rules/java.md` (path-scoped to `src/**/*.java`) that holds the conventions an agent breaks: constructor injection only, no field `@Autowired`; records for DTOs and properties; no `@Value` (properties class only); no `catch (Exception)` that swallows; `@NullMarked` package-info in every new package; Jackson 3 imports are `tools.jackson.*`, not `com.fasterxml.jackson.databind.*` (annotations stay `com.fasterxml.jackson.annotation`); never add `spring-boot-starter-web` (Boot 3 name).
- A skill `spring-boot-testing` (short): which slice annotation for which test, `MockMvcTester` vs `RestTestClient`, `@MockitoBean` (Boot 3.4+ replacement for `@MockBean`), single-test command `./mvnw -q -Dtest=NotesControllerTest test`, `-Dit.test=` for Failsafe.
- No per-write lint hook (JVM start); format on stop through `agent-ops`'s Java branch.

**Fragments:** default `agent-ops`, `git-hooks`, `ci-github`, `rest-api`. Optional `docker-deploy` (after its Java branch), `rr`, `ce-plugin`, and new Java fragments below (`spring-data-postgres`, `spring-ai`, `spring-security-jwt`, `opentelemetry-java`).

**Proposed companion fragment `spring-data-postgres`** (P1, ships with or right after the stack): `org.springframework.boot:spring-boot-starter-data-jpa`, `org.springframework.boot:spring-boot-starter-flyway` (Boot 4 modular name; confirm), `org.flywaydb:flyway-database-postgresql`, `org.postgresql:postgresql`; test `org.springframework.boot:spring-boot-testcontainers`, `org.testcontainers:testcontainers-junit-jupiter`, `org.testcontainers:testcontainers-postgresql`; dev `org.springframework.boot:spring-boot-docker-compose` (Boot starts `compose.yaml` on `make serve`, so the serve probe has a database). A `JpaNoteStore` replaces the in-memory store behind `NoteStore`; `@ServiceConnection` Postgres container shared per JVM (static container + `@DynamicPropertySource` not needed); `spring.jpa.hibernate.ddl-auto=validate` so Flyway owns the schema; `spring.jpa.open-in-view=false`. Kept optional to match `go-api`/`python-api` and so the base verify needs no Docker.

**Gotchas for the body:**

- Boot 4 renamed starters; an agent's memory says `spring-boot-starter-web` and `TestRestTemplate`. Use the shipped names; `spring-boot-starter-classic` is a migration bridge, never a fix.
- Jackson 3 package names (`tools.jackson.databind.ObjectMapper`, now `JsonMapper` preferred).
- Error Prone on JDK 16+ needs the `.mvn/jvm.config` exports; keep them rather than disabling the plugin. NullAway errors are real; fix with `@Nullable` from `org.jspecify.annotations`, never `@SuppressWarnings("NullAway")` without a comment.
- `spring-boot-configuration-processor` must sit in `annotationProcessorPaths` next to Error Prone; once `annotationProcessorPaths` is set, the compiler stops discovering processors on the classpath.
- Serve probe: cold start of a Boot 4 MVC app is 1 to 3 s on Apple Silicon, but the first `make serve` after a clean includes the package step; 90 s covers it. Health returns 503 when a health indicator is down (for example the DB with `spring-data-postgres`), which fails the probe; that is correct behaviour.
- Port 8080 collides with many local tools; `PORT` overrides.
- Surefire's `argLine` must append `@{argLine}` so JaCoCo's agent survives.

### 2. `java-cli` (P1)

**Name:** Java CLI (picocli)

**Description:** A Java command-line tool on picocli, built with Maven and make into one runnable jar. Subcommands with typed options, exit codes from one error table, JSON or text output, and tests that run the packaged jar. GraalVM native image is an optional fragment.

**Why:** fills the third CLI language (`go-cli`, `typescript-cli` exist), costs little (no Docker, no server), and establishes the non-Spring Java toolchain the library stack reuses. picocli is the de facto choice (5.5k stars, used by Micronaut/Quarkus CLIs, JReleaser, Spring Shell alternatives).

**Dependencies:**

- runtime: `info.picocli:picocli`, `org.jspecify:jspecify`, `com.fasterxml.jackson.core:jackson-databind` or `tools.jackson.core:jackson-databind` (Jackson 3; pick 3, decision) for `--json` output, `org.slf4j:slf4j-api` + `org.slf4j:slf4j-simple` (logs to stderr only, off by default)
- annotation processor: `info.picocli:picocli-codegen` (compile-time validation of annotations; generates GraalVM reflection config, used by the native fragment)
- test: `org.junit.jupiter:junit-jupiter` (via `org.junit:junit-bom`), `org.assertj:assertj-core`
- plugin: `org.apache.maven.plugins:maven-shade-plugin` (or `maven-assembly-plugin`; shade, so `java -jar app.jar` works), compiler, surefire, failsafe, enforcer, `com.diffplug.spotless:spotless-maven-plugin`, `org.jacoco:jacoco-maven-plugin`, `org.codehaus.mojo:versions-maven-plugin`; Error Prone + NullAway as above

**Proving slice:** `Main.java` (builds `CommandLine`, sets `IExecutionExceptionHandler` and `IParameterExceptionHandler`, `System.exit` only here), `cli/RootCommand.java` (`--version` from the jar manifest via `IVersionProvider`, `--json`, `--verbose`), `cli/GreetCommand.java` (one real command, e.g. `notes add|list` against a file under `$XDG_DATA_HOME`, to prove config + file I/O), `config/Config.java` (env + defaults, validated), `errors/ExitCode.java` (usage 2, input 2, not-found 3, IO 4, internal 1), `errors/CliException.java`, `output/Output.java` (text vs JSON, stdout for results, stderr for diagnostics). Tests: `CommandTest` drives `CommandLine.execute` with captured `StringWriter`s (no `System.exit`), asserting exit codes and both streams; `JarSmokeIT` runs `java -jar target/<slug>.jar --help/--version/<command> --json` with `ProcessBuilder` and asserts output and exit codes.

**The one payload:** `<slug> notes add "x" --json` then `<slug> notes list --json` through the packaged jar.

**Verify:** install, fmt-check, lint, compile, test (coverage), test-integration (jar smoke via Failsafe after `package`), build, readme-filled. No serve.

**Agent-ops:** settings allow make targets; rule: stdout is for results only, never log to stdout; never call `System.exit` outside `Main`; new commands get a `CommandTest` case for success, usage error and runtime error.

**Fragments:** default `agent-ops`, `git-hooks`, `ci-github`. Optional `rr`, `ce-plugin`, new `graalvm-native` (P2: `org.graalvm.buildtools:native-maven-plugin`, brew cask `graalvm-jdk@25`? — GraalVM is distributed as a cask/tarball; `native-image` takes 1 to 3 min and about 2 GB RAM per build; verify step `make native-smoke` with a 10m timeout), new `jreleaser` (P3, release automation; needs credentials only at release).

**Gotchas:** shading breaks `META-INF/services` and signatures unless `ServicesResourceTransformer` is set and signature files excluded; picocli's `--version` must come from `Implementation-Version` in the manifest, not a literal; JVM start (about 100 to 300 ms) is visible to users, mention AppCDS (`-XX:+AutoCreateSharedArchive`) as a decision, not default; Windows line endings in `mvnw.cmd` must stay CRLF (`.gitattributes`).

### 3. `spring-boot-react` (P1)

**Name:** Spring Boot API + React SPA

**Description:** A full-stack app with a Java Spring Boot JSON API and a React single-page frontend on Vite, in one repo driven by make. The API serves Problem Details errors and an OpenAPI document the frontend's typed client is generated from, with browser tests over both.

**Why:** the common enterprise shape (Spring + React is the default JHipster pairing and the most common "Java full stack" job description), and the registry's precedent (`python-react`) shows fullstack is what time-pressed users ask for. Mixed ecosystems (`maven` + `npm`) are already supported once `maven` exists.

**Layout:** `api/` is the `spring-boot-api` slice (same code, trimmed docs); `web/` follows `python-react`'s frontend (React, Vite, React Router, TanStack Query, Vitest, Testing Library, Biome, Playwright) with Bun as package manager. Tags: `[java, typescript, react, web, api, fullstack, monorepo, make, bun, node]`.

**Dependencies:** `api` as stack 1 plus `org.springdoc:springdoc-openapi-starter-webmvc-api`; `web` npm deps as `python-react` (`react`, `react-dom`, `react-router`, `@tanstack/react-query`, `openapi-fetch`; dev `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@testing-library/react`, `@biomejs/biome`, `openapi-typescript`, `@playwright/test`).

**Proving slice:** notes create/list page calling the API through the generated client; Vite dev proxy `/api` to Boot's port; `make check-api` regenerates `openapi.json` from the running test context (springdoc's `/v3/api-docs` in an IT) and fails on drift; production build copies `web/dist` into `api` static resources? Decision: separate deploys (default) vs embedded (`frontend-maven-plugin` serving the SPA from the jar). Default separate, to keep Maven free of Node.

**Verify:** install (both), lint (both), typecheck (`make compile` + `tsc`), test (both), api-contract drift, build (jar + vite), e2e (Playwright against both dev servers), serve `api` (`/actuator/health`), serve `web` (Vite root), readme-filled.

**Fragments:** default `agent-ops`, `git-hooks`, `ci-github`. Optional `spring-data-postgres`, `docker-deploy`, `rr`, `ce-plugin`, `posthog` (frontend).

**Gotchas:** CORS isn't needed with the Vite proxy; don't add `@CrossOrigin`. Playwright browsers download about 500 MB on first install. Two serve probes start two processes; the API must bind before the web probe's first proxied call.

### 4. `spring-boot-web` (P2)

**Name:** Spring Boot web app (Thymeleaf + HTMX)

**Description:** A server-rendered Java web app on Spring Boot with Thymeleaf templates and HTMX for partial page updates, no JavaScript build. Forms validate on the server, errors render as pages, and tests drive the real HTML through MockMvc and HtmlUnit.

**Why:** a distinct product ("a web app without a SPA") that HTMX's popularity (49.6k stars) has revived; Spring's official guides lead with Thymeleaf. P2 because survey data doesn't separate server-rendered Spring from API Spring, and Thymeleaf's star count (3k) is modest. jte (1.1k stars, type-checked templates) is the decision alternative; Thymeleaf is the default because agents know it and Boot auto-configures it.

**Dependencies:**

- runtime: `org.springframework.boot:spring-boot-starter-webmvc`, `org.springframework.boot:spring-boot-starter-thymeleaf`, `org.springframework.boot:spring-boot-starter-validation`, `org.springframework.boot:spring-boot-starter-actuator`, `org.webjars.npm:htmx.org`, `org.webjars:webjars-locator-lite` (version-less `/webjars/htmx.org/dist/htmx.min.js` URLs, so templates carry no version), `io.github.wimdeblauwe:htmx-spring-boot-thymeleaf` (optional; `HX-Request` handling; decision, default off to keep deps small)
- test: `spring-boot-starter-test`, `spring-boot-starter-webmvc-test`, `org.htmlunit:htmlunit` (MockMvc HtmlUnit integration: real form submits without a browser), `org.jsoup:jsoup` (fragment assertions), `com.tngtech.archunit:archunit-junit5`
- plugins as stack 1

**Proving slice:** notes page: list, create form with server validation (field errors re-render the form fragment via HTMX `hx-post`/`hx-target`), a full-page fallback when HTMX is absent (progressive enhancement test), error page for 404/500 rendering the same `ErrorCode` table, CSRF not needed until security (decision, with a note to add it with `spring-security`). Tests: `@WebMvcTest` asserting fragment vs full page by `HX-Request` header; HtmlUnit submits the real form; `WebIT` boots the app and fetches `/` and the htmx webjar URL (proves the locator).

**Verify:** install, fmt-check, lint, compile, test, test-integration, build, serve (`/actuator/health`, plus root `/` answering 200 can be a second probe), readme-filled.

**Fragments:** default `agent-ops`, `git-hooks`, `ci-github`. Optional `spring-data-postgres`, `docker-deploy`, `rr`, `ce-plugin`, future `spring-security-login`.

**Gotchas:** Thymeleaf fragment syntax changed in 3.1 (`~{...}` required, `#request` removed from expressions); template errors surface only at render, so every template needs a test that renders it; `spring.thymeleaf.cache=false` only in a dev profile.

### 5. `quarkus-api` (P2)

**Name:** Quarkus REST API (Java)

**Description:** A Java JSON API on Quarkus with Quarkus REST and Jackson, built with Maven and make. Validated config mappings, one error mapper, JSON logs and `@QuarkusTest` HTTP tests, ready for a native build.

**Why:** the clear second Java framework by attention (16k stars, growing builds +26% per Quarkus telemetry), the one developers name for "Kubernetes-native" or "fast startup" Java. Low survey share (0.3% SO 2026) puts it at P2. Micronaut (6.4k, not in the survey) is rejected in its favour.

**Dependencies:**

- BOM: `io.quarkus.platform:quarkus-bom` (imported, `${quarkus.platform.version}`; the LTS line by decision)
- runtime: `io.quarkus:quarkus-rest`, `io.quarkus:quarkus-rest-jackson`, `io.quarkus:quarkus-hibernate-validator`, `io.quarkus:quarkus-smallrye-health`, `io.quarkus:quarkus-logging-json`, `io.quarkus:quarkus-arc`, `org.jspecify:jspecify`
- test: `io.quarkus:quarkus-junit5` (artifact name may follow JUnit 6 in newer lines; confirm), `io.rest-assured:rest-assured`, `org.assertj:assertj-core`
- plugin: `io.quarkus.platform:quarkus-maven-plugin`, compiler, surefire, failsafe, enforcer, spotless, jacoco (`io.quarkus:quarkus-jacoco` is Quarkus's own integration; prefer it), Error Prone + NullAway (NullAway with Quarkus's generated code needs `ExcludedClassAnnotations` for generated classes; verify at authoring, else keep Error Prone and drop NullAway with a recorded reason)

**Proving slice:** `NotesResource` (Jakarta REST), `@ConfigMapping` interface for config, `AppException` + `ExceptionMapper` producing Problem Details JSON, request-id `ContainerRequestFilter` with MDC, in-memory `NoteStore` as an `@ApplicationScoped` bean. Tests: `@QuarkusTest` + RestAssured for routes and errors, `@QuarkusIntegrationTest` running the packaged jar (Failsafe), unit tests for config and store.

**Verify:** install, fmt-check, lint, compile, test, test-integration (packaged jar), build, serve `make serve` (`java -jar target/quarkus-app/quarkus-run.jar`) probing `/q/health/live` within 60s, readme-filled.

**Fragments:** default `agent-ops`, `git-hooks`, `ci-github`, `rest-api`. Optional `docker-deploy`, `rr`, `ce-plugin`; a later `quarkus-postgres` (Hibernate ORM Panache + Flyway, Dev Services start Postgres automatically in tests and dev with Docker).

**Gotchas:** never use `quarkus:dev` as the serve step (it watches, prompts on the console, and holds the terminal); Dev Services start containers silently in `@QuarkusTest` whenever an extension needs one, so with Docker absent tests fail with a container error, not a config error; `quarkus.http.host` defaults to localhost in dev but 0.0.0.0 in prod; build-time vs runtime config properties (changing a build-time property needs a rebuild, a frequent agent loop); Quarkus Platform BOM, not `io.quarkus:quarkus-bom`, is the documented import.

### 6. `java-library` (P2)

**Name:** Java library (Maven Central-ready)

**Description:** A Java library built with Maven and make, with a JPMS module, JSpecify nullness, sources and Javadoc jars, API compatibility checks and a consumer project that compiles against the installed artifact. Publishing to Maven Central is an optional fragment.

**Why:** a distinct product (developers say "a Java library") with a different definition of done than an app: the published artifact, Javadoc, and binary compatibility. Mirrors the planned `typescript-library`/`python-library` P2 rows.

**Dependencies:**

- runtime: `org.jspecify:jspecify` (and nothing else)
- test: `org.junit:junit-bom` → `org.junit.jupiter:junit-jupiter`, `org.assertj:assertj-core`, `net.jqwik:jqwik` (property tests; decision)
- plugin: compiler, surefire, `org.apache.maven.plugins:maven-source-plugin`, `org.apache.maven.plugins:maven-javadoc-plugin` (with `-Xdoclint:all` failing on missing docs for public API), `org.apache.maven.plugins:maven-invoker-plugin` (runs `src/it/consumer` against the installed artifact), `com.github.siom79.japicmp:japicmp-maven-plugin` (fails on binary-incompatible changes after a first release; a no-op baseline before then), enforcer, spotless, jacoco, `com.github.spotbugs:spotbugs-maven-plugin` (optional `make spotbugs`), `org.codehaus.mojo:flatten-maven-plugin` (resolved POM for publishing); Error Prone + NullAway
- release fragment: `org.sonatype.central:central-publishing-maven-plugin` (Central Portal; OSSRH is retired), `org.apache.maven.plugins:maven-gpg-plugin`

**Proving slice:** `module-info.java` exporting one package, a small value API (e.g. a `Slug` parser with a sealed `Result`), package-info with `@NullMarked`, Javadoc on every public type, unit + property tests, `src/it/consumer/pom.xml` + `ConsumerTest.java` that depends on `{{project_slug}}` from the local repo and calls the API.

**Verify:** install, fmt-check, lint, compile, test, javadoc (`make docs`, layer `docs`), build (jar + sources + javadoc jars, checked by `jar tf`), consumer (`make test-consumer`, invoker against a project-local repo under `target/local-repo` so `~/.m2` stays clean), readme-filled.

**Fragments:** default `agent-ops`, `git-hooks`, `ci-github`. Optional `rr`, `ce-plugin`, new `maven-central-release` (P3; needs a Central account and GPG key only at release, never in verify).

**Gotchas:** group ids must be a domain or `io.github.<user>` the author controls (decision); Javadoc's doclint fails on HTML in comments; JPMS `requires static org.jspecify` (annotations aren't needed at runtime); japicmp needs the previous release coordinates, so it is skipped until a first version exists.

## Java fragments worth proposing (not stacks)

| Id | Applies to | Priority | Why a fragment |
| --- | --- | --- | --- |
| `spring-data-postgres` | spring-boot-api, spring-boot-web, spring-boot-react | P1 | Same role as `postgres`/`drizzle-postgres`; JPA + Flyway + Testcontainers `@ServiceConnection` + `spring-boot-docker-compose` |
| `spring-ai` | spring-boot-api, spring-boot-react | P2 | Spring AI 2.0 `ChatClient` with `spring-ai-starter-model-openai` pointed at OpenRouter's OpenAI-compatible endpoint (consistent with `openrouter-ai`), tested against a WireMock (`org.wiremock:wiremock-standalone`) stub, so no key is needed for verify; `spring-ai-starter-model-ollama` as a local decision. Azul: 62% of orgs build AI features in Java |
| `spring-kafka` | spring-boot-api | P3 | Consumer/producer with `org.springframework.kafka:spring-kafka`, `testcontainers-kafka`; a Spring app with another inbound adapter, not a new product |
| `spring-security-jwt` / `spring-security-login` | Spring stacks | P2 | Resource server JWT for APIs (tested with a local key, like `clerk`), form login for `spring-boot-web` |
| `opentelemetry-java` | Spring stacks | P3 | Boot 4's OTLP starter; parallels `effect-otlp` |
| `graalvm-native` | java-cli, quarkus-api, spring-boot-api | P2 | Native image is a build target, not a product; minutes-long builds belong behind a tag-filtered verify step |
| `maven-central-release`, `jreleaser` | java-library, java-cli | P3 | Credentials only at release |

## Rejected candidates

| Candidate | Why not |
| --- | --- |
| Micronaut API | Not in SO 2026's list, 6.4k stars against Quarkus's 16k; same product as `quarkus-api` (cloud-native compile-time DI). Revisit on demand |
| Javalin / Helidon minimal API | Javalin (8.4k stars) is a fine "no framework" choice, the Java analogue of `go-api`'s stdlib stance, but no survey signal and little agent value over Spring Boot. Helidon 3.8k. Revisit Javalin as P3 if requests come in |
| Spring AI app (as a stack) | An LLM feature on a Spring app; it composes, so it's the `spring-ai` fragment, mirroring `openrouter-ai`. A stack would duplicate `spring-boot-api` |
| Kafka / Spring Cloud Stream consumer | Same reasoning: an inbound adapter on a Spring app. Testcontainers Kafka makes it verifiable as a fragment. Spring Cloud Stream's binder abstraction adds churn without a distinct product |
| JavaFX desktop app | OpenJFX 3.3k stars; Tauri already covers desktop; UI tests (TestFX) need a display or Monocle headless, which is fragile on macOS and in CI; jpackage signing is out of scope for local verify |
| Gradle multi-module monorepo | A build layout, not a product. Multi-module belongs to a `monorepo` tag on a real product stack if ever needed; the build-tool choice is a decision line |
| Gradle variant of each stack | Doubles maintenance for one decision; see "Maven vs Gradle" |
| Spring Boot with Kotlin | A different language; same `maven` ecosystem, so a later `kotlin-*` family can reuse the P0 work. Ktor appears in JetBrains' chart; out of scope here |
| Jakarta EE / WildFly / Open Liberty | Real enterprise use, but developers starting new projects with an agent rarely pick an app server; Quarkus covers the Jakarta APIs |
| Vaadin | Commercial components for much of its value; niche |
| Android | Kotlin-first, needs the Android SDK and an emulator; Expo covers mobile |

## Open questions for the maintainer

1. Format change timing: `maven` in `Ecosystem` is a `@steamfield/stacks-format` release that `stacks-api` must accept first. Is that a decision for the plans README now, or after the existing Batch 2/3 work? (The plans say it needs a decision there.)
2. Root Java package: fixed `app` (no rename step, simplest for agents) or `{{project_slug}}`-derived with a Setup rename (more conventional `com.example.foo`)? Recommendation: fixed `app` with a decision line to rename, because directory names can't be templated and a rename across `src/main` and `src/test` is a common agent failure.
3. Formatter default: palantir-java-format (recommended, 4-space) vs google-java-format (more stars, 2-space). Taste call; either is deterministic.
4. Whether `spring-data-postgres` should be a default rather than optional fragment for `spring-boot-api`, given most Spring APIs have a database. Recommendation: optional, matching `go-api`/`python-api` and keeping the base verify Docker-free.
5. Format-on-write for Java in `agent-ops`: per-write formatting through Maven is too slow; accept format-on-stop only, or require the `google-java-format` brew CLI (which can't do palantir style)?

## Local prerequisites on macOS (Apple Silicon)

```sh
brew install openjdk@25 maven          # JDK (keg-only) and mvn for the one-time wrapper
brew install lefthook jq               # git-hooks fragment, Makefile helpers
# Docker already present (OrbStack or Docker Desktop) for Testcontainers fragments
# java-cli + graalvm-native only: brew install --cask graalvm-jdk@25 (confirm cask name at authoring)
```

No credentials or paid accounts are needed for any stack's verify. Testcontainers needs Docker running (`ensure-docker`); with Docker 29+, Testcontainers 2.0.2 or later.
