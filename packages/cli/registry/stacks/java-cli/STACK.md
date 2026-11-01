---
schema_version: 1
id: java-cli
kind: stack
name: Java CLI (picocli)
description: A Java command-line tool on picocli, built with Maven and make into one runnable jar. Layered TOML config (file, env, flags), one error table mapped to exit codes, text or JSON output, Logback logs to stderr, Error Prone and NullAway, and tests that run the packaged jar.
tags: [java, cli, make]
tools: [java, mvn, make, git]
decisions:
  - "JDK: the newest Java LTS release (default). Its major goes in `.java-version` and pom.xml's `<java.version>`; never an update release."
  - "Build tool: Maven through the committed wrapper (default). Gradle with the Kotlin DSL and a version catalog only when the user asks; then translate each Makefile target one for one and keep every check."
  - "Command name: the project slug (default; `AppInfo.NAME`, the jar name and the config paths). Renaming it renames the config file paths and the environment prefix (`AppInfo.ENV_PREFIX`)."
  - "Root package: `app` (default), fixed so the shipped sources need no rename. To rename it, move `src/main/java/app` and `src/test/java/app`, change every `package app` and `import app.` line, the ArchitectureTest package names, `mainClass` in pom.xml and the Logback services file in one change, then run `make compile test`."
  - "Distribution: the runnable jar, run with `java -jar` (default). A GraalVM native image only when the user asks for a single native binary; then add the native-maven-plugin in a profile, keep the jar and every check, and give the native build its own make target outside verify."
  - "Config: TOML at $XDG_CONFIG_HOME/<name>/config.toml (or ~/.config/...) plus an optional ./<name>.toml (default), or environment and flags only."
  - "Formatter: palantir-java-format through Spotless (default; 4 spaces, 120 columns), or google-java-format (`<googleJavaFormat/>`) when the user prefers 2 spaces."
  - "Coverage floor: 70% of lines from unit tests (default; `coverage.minimum` in pom.xml)."
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
  - { name: test-integration, layer: test, run: make test-integration }
  - { name: build, layer: build, run: make build }
  - { name: smoke, layer: test, run: make smoke }
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
  test: Unit tests (*Test), in process
  coverage: Unit tests with the JaCoCo line-coverage floor
  test-integration: Integration tests (*IT) that run the packaged jar
  build: Runnable jar with every dependency inside, at target/<name>.jar
  smoke: Run the built jar's --help, --version and config show --json
  ci: "Everything CI runs (fmt-check, enforcer, every test, coverage, the jar, smoke)"
  clean: Remove build output
---

# Java CLI (picocli)

A command-line tool on the JVM: picocli commands, typed config layered from defaults, TOML files, environment and flags, one error table with exit statuses and suggestions, results as text or one JSON document, and Logback logs on stderr. Maven builds one shaded jar through its wrapper, and the `Makefile` is the entry point for every task.

## What stacks wrote

A working slice that passes every check once Setup fills the versions. `pom.xml` imports the Jackson, SLF4J and JUnit BOMs and names every other library and plugin version as an empty property; `.mvn/jvm.config` opens the javac internals Error Prone needs. `src/main/java/app/`: `Main` captures the process and exits with what `App.run` returns; `App` parses with picocli, answers `--help` and `--version` without reading config, loads the config, starts logging and runs the command; `AppInfo` holds the command name, the environment prefix and the version from the jar manifest. `cli/` has `RootCommand` (global options), `Action` (the interface a working command implements) and `config show`; `config/` has `Config`, `ConfigLoader` (Jackson's TOML reader), `Env` and `Flags`; `errors/` has `ErrorCode` and `CliException`; `output/Output` writes every result and error; `log/` sets up Logback, which starts silent through `QuietStart` and a `META-INF/services` file. Unit tests sit beside each package, `AppTest` runs whole invocations in memory, `ArchitectureTest` (ArchUnit) holds the layering, and `JarIT` runs the shaded jar with `java -jar`. `docs/` has ARCHITECTURE (packages and the exit-status table), configuration and `guidance/java.md`, the Java rules every agent follows. The `greeting` setting is the payload that proves the wiring. Read the code before extending it.

## Setup

No generator; nothing comes from a picocli or Maven archetype.

1. **JDK.** Write the major of the newest Java LTS release to `.java-version` (the major only, one line) and to `<java.version>` in `pom.xml`. On macOS install it with `brew install openjdk@<major>`; it is keg-only and the Makefile finds it, so don't link it or rely on `mvn`'s JDK: Homebrew's `maven` depends on the newest `openjdk`, which is usually not an LTS.
2. **Versions.** For every other empty `<*.version>` property, read the newest release from `https://repo.maven.apache.org/maven2/<groupId as a path>/<artifactId>/maven-metadata.xml`. Its `<release>` can be a milestone or release candidate (`-M1`, `-RC1`), so take the highest plain numeric version: `curl -s <url> | grep -o '<version>[0-9.]*</version>' | sort -V | tail -1`. The coordinates are in `pom.xml`. A BOM's property is the BOM's own version: `jackson.version` is `tools.jackson:jackson-bom`'s, `slf4j.version` is `org.slf4j:slf4j-bom`'s, `junit.version` is `org.junit:junit-bom`'s; Error Prone's is `com.google.errorprone:error_prone_core`'s.
3. **Wrapper.** Run `mvn -N wrapper:wrapper -Dtype=only-script` once (the `mvn` from Homebrew's `maven`). It writes `mvnw`, `mvnw.cmd` and `.mvn/wrapper/maven-wrapper.properties` pinned to that Maven; commit them. From then on only `./mvnw` runs Maven.
4. `make install`, then `make fmt-check lint compile coverage test-integration smoke`. Where an installed release rejects shipped code (a renamed Jackson or Logback API, a new Error Prone or NullAway finding), fix the code. Keep every compiler flag, Enforcer rule, the shade transformers and the coverage floor; a check that is wrong for one place gets `@SuppressWarnings("<check>")` on that member with a comment saying why, as `Main.terminal` does. Run `make fmt` after editing.
5. Fill the README's `stacks:fill` markers (`readme-filled` checks), link `docs/guidance/java.md` from AGENTS.md, then run `stacks verify` until it passes.

## Conventions

`docs/guidance/java.md` holds the Java rules (build, nullness, structure, output, logs, testing); the shipped code follows each one. For this tool:

- **Commands**: one class per command in `app.cli`, listed in its parent's `subcommands`. A command that does work implements `Action.run(Config, Output)`; a group only holds subcommands, and running it bare is a usage error. Global options live on `RootCommand` with `scope = INHERIT`. The `add-command` skill walks through a new one.
- **I/O**: stdout carries the result only, written once through `Output.result`; `--json` makes it one JSON document on one line. Errors go to stderr once, from `App`: `error[CODE]: message` and a suggestion line, or `{"error":{"code","message","suggestion"}}` under `--json`.
- **Exit status**: 0 success, 1 runtime failure, 2 invalid invocation, 3 invalid configuration, all in `ErrorCode`. A new failure is a new constant with its status and suggestion, and a row in `docs/ARCHITECTURE.md`. Never rename a code.
- **Config**: commands receive the typed `Config`. A new setting gets a default, the file and environment layers, a `validate` rule if it can be wrong, a precedence test and a row in `docs/configuration.md`. Unknown keys in a config file are an error.
- **Process state**: only `Main` reads the environment, system properties or the standard streams, or calls `System.exit`; `ArchitectureTest` enforces it. `--help` and `--version` never read config files.
- **Packages**: every package has a `package-info.java` with `@NullMarked`.

## Testing

Unit tests (`*Test`, Surefire) sit beside each package: config precedence and validation with `@TempDir` files and a built `Env`, the error table, both output modes and a failing stream, Logback's text and JSON lines. `AppTest` runs whole invocations through `App.run` with in-memory streams and asserts exit status, stdout and stderr for help, version, `config show`, usage and config failures. `JarIT` (`*IT`, Failsafe, after `package`) runs `java -jar` on the shaded jar with a cleared environment: help, the manifest version, a config file, JSON logs on stderr and each failure's exit status. A new command gets `AppTest` cases for both output modes and each failure, and a `JarIT` case per new exit path.

## Commands

The shipped Makefile (`make help`) has env, install, fmt, fmt-check, lint, compile, test, coverage, test-integration, build, smoke, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md with single-test commands: `./mvnw -q test -Dtest=AppTest` and `./mvnw -q verify -DskipUTs=true -Dit.test=JarIT`. Run the tool with `java -jar target/<name>.jar` after `make build`.
<!-- stacks:when with=ci-github -->

**CI.** One `ubuntu-latest` job: setup-java from `.java-version`, then `make install` and `make ci`. Record in AGENTS.md that CI never runs `mvn`.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

**Git hooks.** The shipped `make install` runs `lefthook install` outside CI once `lefthook.yml` exists, so write that file first. pre-commit runs `make fmt` on `*.java` with `stage_fixed: true`, so formatting fixes are restaged; pre-push runs `make lint test`. Compiling checks the whole project, so it stays out of pre-commit.
<!-- stacks:end -->

## Gotchas

- Jackson 3 is `tools.jackson.*` (`JsonMapper`, `TomlMapper`, unchecked `JacksonException`); only the annotations stay in `com.fasterxml.jackson.annotation`. Jackson 3 ignores unknown properties by default, so `ConfigLoader` turns `FAIL_ON_UNKNOWN_PROPERTIES` back on; keep it.
- Shading keeps one copy of a resource that several jars ship unless a transformer merges it. `ServicesResourceTransformer` merges `META-INF/services` (jackson-core and the TOML module both register a `TokenStreamFactory`; SLF4J finds Logback, and Logback finds `QuietStart`, the same way). Keep it when adding dependencies; the unit tests run from classes and only `JarIT` sees the jar.
- Logback with no configuration logs debug lines to stdout. `QuietStart` stops that until `Logging.start`; don't add a `logback.xml`, which is parsed on every start.
- `<annotationProcessorPaths>` turns off processor discovery on the classpath, so picocli-codegen, Error Prone and NullAway are all listed there. A new processor goes there too. Don't pass picocli's `-Aproject` option: the test compile has no picocli annotations, javac warns that no processor recognized it, and `failOnWarning` fails the build.
- `make compile` runs Maven without `-q`, because under `-q` javac's warnings are hidden and only "warnings found and -Werror specified" is left.
- Error Prone flags `System.console() != null` (never null since JDK 22) while NullAway's JDK model still says it can be; `Main.terminal` suppresses the Error Prone check with a comment.
- Error Prone needs `.mvn/jvm.config`'s exports on every JDK this project supports; keep the file.
- picocli's `--version` comes from `Implementation-Version`, which the shade plugin's manifest transformer writes from the POM's version. Run from classes (unit tests), it is `dev`.
- JVM start costs a few hundred milliseconds per invocation. Class Data Sharing (`-XX:+AutoCreateSharedArchive`) or a native image are decisions for the user, not defaults.
- The agent-ops format hook runs `./mvnw spotless:apply` on the session's Java files at Stop; it needs the wrapper and finds the JDK from `.java-version` like the Makefile.
