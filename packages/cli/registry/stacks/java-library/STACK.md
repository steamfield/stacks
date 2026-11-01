---
schema_version: 1
id: java-library
kind: stack
name: Java library (Maven Central-ready)
description: A Java library for other JVM code to depend on, built with Maven and make. A JPMS module exporting one package, JSpecify nullness checked by NullAway, Javadoc with doclint and examples that run as tests, generated-input property tests, a consumer project built against the installed jar, a japicmp API check and the sources and Javadoc jars Maven Central requires.
tags: [java, library, make]
tools: [java, mvn, make, git]
decisions:
  - "JDK: the newest Java LTS release (default). Its major goes in `.java-version` and pom.xml's `<java.version>`, which is also the oldest Java callers can run the library on; never an update release."
  - "Build tool: Maven through the committed wrapper (default). Gradle with the Kotlin DSL and a version catalog only when the user asks; then translate each Makefile target one for one and keep every check."
  - "Group id: `io.github.<owner>` (default), owner from `gh api user -q .login` or the git remote, or a reversed domain the user owns. Maven Central publishes only under a namespace the publisher has verified, so settle it before the first release; if neither exists keep `app` and list it under decisions to revisit."
  - "Root package and module: `app` (default), fixed so the shipped sources need no rename. Rename both to match the group id before the first release (`docs/releasing.md` lists every place); after a release a rename breaks every caller."
  - "Proving API: `Slug` parsing with `SlugRules` and the sealed `SlugError` (default), or the project's first real API through the same module, Javadoc, example, property, consumer and API-check patterns. Remove the slug code once the real API covers every path its tests cover."
  - "Runtime dependencies: none beyond JSpecify, which callers need only to compile (default). Each new one joins every caller's build; add it only when the user agrees."
  - "Property tests: plain JUnit loops over seeded generated input (default), so JUnit is the only test engine. jqwik only when the user asks and its engine supports the JUnit Platform the BOM brings."
  - "License: MIT with the author and year (default). For another, replace LICENSE and pom.xml's `<licenses>`."
  - "Coverage floor: 80% of lines from unit tests (default; `coverage.minimum` in pom.xml)."
  - "Publishing: build and check locally; the user publishes to Maven Central with their own Portal token and GPG key (default). A release workflow is deferred unless asked."
env: {}
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
  - { name: docs, layer: docs, run: make docs }
  - { name: build, layer: build, run: make build }
  - { name: consumer, layer: test, run: make test-consumer }
  - { name: api-check, layer: check, run: make api-check }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  env: Check the JDK, the Maven wrapper, every pom.xml version property and the description
  install: Check the toolchain and download dependencies and plugins
  fmt: Format Java sources with Spotless (palantir-java-format)
  fmt-check: Fail if Spotless would change any Java source
  lint: "Maven Enforcer: JDK version, dependency convergence, duplicate declarations"
  compile: Compile main and test code with Error Prone and NullAway
  test: Unit, property and example tests
  coverage: Unit tests with the JaCoCo line-coverage floor
  docs: Javadoc for the exported API, every doclint warning an error
  build: The jar, sources jar and Javadoc jar, then check the module descriptor and contents
  jar-check: Check the built jars' module descriptor, exports and contents without rebuilding
  test-consumer: Build src/it/consumer on the module path against the installed jar
  api-check: Fail on an incompatible change to the exported API since api/baseline.jar (japicmp)
  api-baseline: Record the API as api/baseline.jar (first setup, then a person at each release)
  ci: "Everything CI runs (fmt-check, enforcer, tests, coverage, Javadoc, jars, consumer, API check)"
  clean: Remove build output
---

# Java library (Maven Central-ready)

A library whose product is its public API: one exported package in a JPMS module, every public member documented with an example that runs, failures callers can `switch` over, and the three jars Maven Central asks for. No `main`, no logging setup, no config files. The `Makefile` is the entry point for every task.

## What stacks wrote

A working library that passes every check once Setup fills the versions. `pom.xml` imports the JUnit BOM, names every other library and plugin version as an empty property, and carries the Central metadata (name, description, licenses, developers); `.mvn/jvm.config` opens the javac internals Error Prone needs. `src/main/java/module-info.java` declares module `app`, exporting `app` and requiring JSpecify only at compile time. `app` is the API: `Slug` (a validated value with `parse`), `SlugRules` (the settings, with `defaults`, `withMaxLength`, `check` and `parse`), the sealed `SlugError` with one record per broken rule, and `SlugException`, which carries it. `app.internal.SlugScanner` does the checking and isn't exported. Tests sit beside the code: `SlugRulesTest`, `SlugTest`, `SlugErrorTest`, `SlugPropertiesTest` (seeded generated input), `ArchitectureTest` (ArchUnit) and `ExamplesTest`, whose regions the Javadoc shows through `{@snippet}`. `src/it/consumer` is a separate Maven project on the module path that depends on the installed jar. `docs/` has `public-api.md` (exports and compatibility rules), `releasing.md` (the Central checklist) and `guidance/java.md`. Parsing `release-notes` is the payload that proves the wiring. Read the code before extending it.

## Setup

No generator; nothing comes from a Maven archetype.

1. **JDK.** Write the major of the newest Java LTS release to `.java-version` (the major only, one line) and to `<java.version>` in `pom.xml`. On macOS install it with `brew install openjdk@<major>`; it is keg-only and the Makefile finds it, so don't link it or rely on `mvn`'s JDK: Homebrew's `maven` depends on the newest `openjdk`, which is usually not an LTS.
2. **Coordinates.** Set `<groupId>` per the group id decision and replace the `stacks:fill` in `<description>` with one sentence (`make env` refuses it).
3. **Versions.** For every other empty `<*.version>` property, read the newest release from `https://repo.maven.apache.org/maven2/<groupId as a path>/<artifactId>/maven-metadata.xml`. Its `<release>` can be a milestone or release candidate (`-M1`, `-RC1`), so take the highest plain numeric version: `curl -s <url> | grep -o '<version>[0-9.]*</version>' | sort -V | tail -1`. The coordinates are in `pom.xml`; `junit.version` is `org.junit:junit-bom`'s, `error-prone.version` is `com.google.errorprone:error_prone_core`'s. The consumer project reads the same properties.
4. **Wrapper.** Run `mvn -N wrapper:wrapper -Dtype=only-script` once (the `mvn` from Homebrew's `maven`). It writes `mvnw`, `mvnw.cmd` and `.mvn/wrapper/maven-wrapper.properties` pinned to that Maven; commit them. From then on only `./mvnw` runs Maven.
5. `make install`, then `make fmt-check lint compile coverage docs build test-consumer`. Where an installed release rejects shipped code (a new Error Prone, NullAway or doclint finding), fix the code. Keep every compiler flag, Enforcer rule, doclint level, the coverage floor and the module's exports; a check that is wrong for one place gets `@SuppressWarnings("<check>")` on that member with a comment saying why. Run `make fmt` after editing.
6. **API baseline.** `make api-baseline`, then `make api-check`. Commit `api/baseline.jar`; from now on it moves only at a release.
7. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/java.md`, `docs/public-api.md` and `docs/releasing.md` from AGENTS.md, then run `stacks verify` until it passes.

## Conventions

`docs/guidance/java.md` holds the Java rules (build, dependencies, modules, nullness, Javadoc, testing) and `docs/public-api.md` the export list and compatibility rules; the shipped code follows both. For this library:

- **Public API**: everything public lives in `app`, the only exported package; helpers go in `app.internal` and never appear in a public signature. Name a change's compatibility effect before writing it. A breaking change needs the user's agreement; never run `make api-baseline` to quiet `make api-check`. The `add-public-api` skill walks through an addition.
- **Javadoc**: every public member has a comment with `@param`, `@return` and `@throws`; examples are `{@snippet file=... region=...}` regions of `ExamplesTest`, never code typed into a comment.
- **Errors**: unchecked exceptions carrying a record of what broke (`SlugException.error()`), never a message to parse. Argument checks throw `IllegalArgumentException`.
- **No side effects**: library code doesn't print, read the environment or system properties, exit or configure logging (`ArchitectureTest`).
- **Nullness**: every package has `@NullMarked` in `package-info.java`; absence is `Optional`.
- **Publishing**: a person deploys to Central; agents stop at `make ci` and the checklist in `docs/releasing.md`.

## Testing

Unit tests sit beside each class and cover every rule with its error record and message. `SlugPropertiesTest` checks properties over a few thousand inputs from a fixed seed, so a failure names its input and reproduces: any string parses or fails with the error `check` reports, and words joined by hyphens always parse. `ExamplesTest` runs every Javadoc example. `make test-consumer` installs the jar into `target/local-repo` and builds `src/it/consumer` as a named module that `requires app`, so a missing export or an `app.internal` type in the API fails to compile there; `NamesTest` asserts the module exports only `app`. A new public member gets unit cases, an example region, a property for a parser or conversion, and a call in the consumer.

## Commands

The shipped Makefile (`make help`) has env, install, fmt, fmt-check, lint, compile, test, coverage, docs, build, jar-check, test-consumer, api-check, api-baseline, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md with single-test commands: `./mvnw -q test -Dtest=SlugRulesTest` and `./mvnw -q test -Dtest='SlugRulesTest#reportsTheFirstRuleBroken'`. `make docs` writes the Javadoc to `target/reports/apidocs/`.
<!-- stacks:when with=ci-github -->

**CI.** One `ubuntu-latest` job: setup-java from `.java-version`, then `make install` and `make ci`. No publish job: releases stay a person's step (`docs/releasing.md`). Record in AGENTS.md that CI never runs `mvn`.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make install` runs `lefthook install` outside CI once `lefthook.yml` exists, so write that file first. pre-commit runs `make fmt` on `*.java` with `stage_fixed: true`, so formatting fixes are restaged; pre-push runs `make lint test api-check`. Compiling and Javadoc check the whole project, so they stay out of pre-commit.
<!-- stacks:end -->

## Gotchas

- palantir-java-format can't parse unnamed variables (`_`) in record patterns, so `make fmt` fails on `case SlugError.TooLong(_, var max)`. Name every binding and use it.
- Calling `./mvnw` directly, outside make, skips the Makefile's `JAVA_HOME` lookup and runs on whatever `java` is on PATH, if any. Use the make targets, or export `JAVA_HOME` first.
- `{@snippet file=...}` resolves against `--snippet-path`, set to `src/test/java` in the javadoc plugin; a renamed region or file breaks `make docs`, not `make test`.
- The invoker filters `@name@` in `src/it/consumer/pom.xml` from this project's properties and coordinates. A new consumer dependency needs its version property in the main `pom.xml`.
- japicmp compares jars, so `api/baseline.jar` is a binary in git; it changes only at a release. Its `app.internal` exclude keeps internal changes out of the report.
- Adding a record to the sealed `SlugError` is source-incompatible for callers with an exhaustive `switch`, but japicmp reports it as compatible: name it as breaking yourself (`docs/public-api.md`).
- `make compile` and `make docs` run Maven without `-q`, because under `-q` the warnings are hidden and only "warnings found and -Werror specified" is left.
- Error Prone needs `.mvn/jvm.config`'s exports on every JDK this project supports; keep the file.
- The agent-ops format hook runs `./mvnw spotless:apply` on the session's Java files at Stop; it needs the wrapper and finds the JDK from `.java-version` like the Makefile.
