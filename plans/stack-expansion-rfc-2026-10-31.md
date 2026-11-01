# RFC: 27 new bundled stacks across TypeScript, Python, Go, Rust and Java

Status: EXECUTED 2026-11-01. All 27 stacks landed with a fresh-scaffold proof (green `verify` and
`verify --all`), adapters and drafted search cards. Review fixes are partial: Go and Python mostly
applied, TypeScript and Java only the first fixes, Rust unreviewed. Pending maintainer steps:
card approval, allowlist and dependency-card review, golden judgments and a bench run per stack.
Approved 2026-10-31 after one devils-advocate review (corrections listed at the end).

The bundled registry has 14 stacks: 11 TypeScript (counting `python-react`'s frontend and
`tauri-react`'s), 2 Python, 2 Go, 1 Rust and no Java. This RFC adds 27, taking TypeScript to 17,
Python to 8, Go to 7, Rust to 6 and Java to 5. Every new stack meets the bar `go-cli` and
`typescript-api` set: a working proving slice in `files/`, agent-ops adapters, every lint, format,
typecheck and test config the checks use, a drafted search card, and a fresh scaffold taken to a
green `stacks verify` (and `verify --all`) by following only the brief.

It supersedes the "Deferred" Java line and part of the Batch 2 to 4 ordering in
[registry-expansion.md](registry-expansion.md). That plan's authoring contract, service lifecycle
rule and verification levels still apply and are not repeated here.

## Research

One research agent per language read the registry, the authoring references and current sources
(Stack Overflow 2026, State of JS 2025, JetBrains surveys, State of Rust 2025, the Go developer
survey, registry download counts and GitHub stars). Each report gives, per candidate, the
dependencies by role, tooling, proving slice, verify steps, agent-ops, fragment fit, gotchas and
sources, plus rejected candidates. They are part of this plan:

| Language | Report |
| --- | --- |
| TypeScript | [stack-expansion-typescript-2026-10-31.md](research/stack-expansion-typescript-2026-10-31.md) |
| Python | [stack-expansion-python-2026-10-31.md](research/stack-expansion-python-2026-10-31.md) |
| Go | [stack-expansion-go-2026-10-31.md](research/stack-expansion-go-2026-10-31.md) |
| Rust | [stack-expansion-rust-2026-10-31.md](research/stack-expansion-rust-2026-10-31.md) |
| Java | [stack-expansion-java-2026-10-31.md](research/stack-expansion-java-2026-10-31.md) |

None of the researched recipes has been built. Each stack's author prototypes it against current
releases and corrects the report where reality differs. Where this RFC and a report disagree, this
RFC wins.

## Selection

A stack is in when it is a product a developer asks for by name, can reach green locally on macOS
with no credentials, paid account, GPU or hardware, and isn't a variant of an existing stack. A
variant is the same language, product kind and programming model with a different router or
library: Gin beside `go-api`, Express or Fastify beside `hono-api`, Ninja beside `django-api`. A
framework earns its own stack when it decides the project's architecture rather than only its
routing (NestJS's modules and dependency injection, Django's apps and ORM, Spring), or when it
changes the product kind (`react-vite` is a browser-only SPA; TanStack Start is server-rendered
React, which `react-router` and `nextjs` already cover). `hono-api` is the plain-TypeScript API
beside the Effect-based `typescript-api`.

Order within a language is the build order.

| Language | New stacks (build order) | Left out, and why |
| --- | --- | --- |
| TypeScript | `react-vite`, `hono-api`, `typescript-library`, `typescript-mcp`, `nuxt`, `nestjs-api` | `angular`, `electron-react`, `wxt-extension` (next batch), TanStack Start (server-rendered React exists twice), Express/Fastify (variants of `hono-api`), bots and VS Code extensions (can't verify without a token or a window) |
| Python | `python-cli`, `python-library`, `django`, `django-api`, `python-data`, `streamlit` | `pydantic-ai-agent` (next batch), Flask (falling usage, covered by `django` and `python-api`), Litestar/Ninja (variants), Celery (a fragment) |
| Go | `go-tui`, `go-grpc`, `go-htmx`, `go-mcp`, `go-library` | `go-gin` (variant of `go-api`), `go-operator` (heaviest setup, next batch), sqlc/pgx (a `go-postgres` fragment) |
| Rust | `rust-cli`, `rust-api`, `rust-library`, `rust-tui`, `rust-wasm` | `rust-python`, `leptos`, `rust-grpc` (next batch), Actix/Rocket (variants of `rust-api`), Bevy/embedded/egui (need a GPU or hardware) |
| Java | `spring-boot-api`, `java-cli`, `java-library`, `spring-boot-web`, `quarkus-api` | `spring-boot-react` (next batch, after `spring-boot-api` is proven), Micronaut, Javalin, JavaFX, Gradle multi-module |

Ids follow the existing families: `<language>-<kind>` where the language is the identity
(`rust-api`, `go-tui`), the framework name where the framework is (`django`, `nuxt`,
`spring-boot-api`). An id is permanent once a release ships it.

New fragments the reports call for (`django-postgres`, `go-postgres`, `sqlx-postgres`,
`spring-data-postgres`, `cargo-dist`, `release-plz`, `pypi-release`, a shared `rust` guidance
fragment) are out of scope. Each new stack composes with the fragments that exist today.

## Decisions

1. Java builds with Maven, not Gradle. `pom.xml` is data the CLI can read without running
   anything (trust model point 1), Maven holds about two thirds of Java usage, and its wrapper
   has no binary. A decision line offers Gradle with a version catalog on request.
2. Java stacks declare no frontmatter `deps`. The shipped `pom.xml` already lists every
   dependency and plugin by `groupId:artifactId` with `${...}` versions, so it is the install
   list; Setup fills the `<properties>` block from Maven Central. Making `maven` a format
   `Ecosystem` breaks the frozen telemetry v2/v3 schemas and allowlist decoding (see the review),
   so Maven dependency telemetry is a follow-up with its own telemetry event version, not part
   of this RFC.
3. Java ships no Maven wrapper and no Spring Boot parent POM. Setup runs `mvn -N wrapper:wrapper`
   (the `only-script` type) and commits the result. The POM imports the framework BOM in
   `<dependencyManagement>`; plugins the BOM doesn't manage (compiler, Surefire, Failsafe,
   Spotless, the framework's plugin, Error Prone in `annotationProcessorPaths`) each get their own
   `${...}` property, and `.mvn/jvm.config` carries Error Prone's `--add-exports` flags. The JDK is
   the current LTS, recorded in `.java-version`; when `JAVA_HOME` is unset the Makefile derives it
   from `.java-version` (`/usr/libexec/java_home -v`, then `brew --prefix openjdk@<that major>`),
   never a literal. Homebrew's `maven` pulls the newest non-LTS JDK, so the Makefile must not rely
   on `mvn`'s default JDK. Formatting is Spotless with palantir-java-format; static analysis is
   Error Prone with NullAway and JSpecify; tests are JUnit, AssertJ and the framework's own test
   client. The root package is a fixed `app`, with a decision line to rename it. Servers read their
   port from the stack's env variable (`server.port=${PORT:8080}` in Spring).
4. Packaged Python stacks ship `pyproject.toml` without `[build-system]` or `requires-python`;
   Setup adds both, since each carries a version range.
5. Rust stacks put one package at the repository root (`[package]` and `[workspace]` in the same
   root `Cargo.toml`, with `[workspace.lints]`), so `cargo add` lands in the root manifest that
   `core/deps.ts::cargoNames` reads. Shipped manifests carry no `[dependencies]` and no
   `rust-version` (Setup lists the `cargo add` lines with features), `rust-toolchain.toml` uses
   `channel = "stable"`, `thiserror` in library code and `anyhow` only at the binary edge,
   `tracing` to stderr. `cargo deny` is a `make audit` target, not a verify step, because it
   fetches the advisory database (as `go-api`'s `vuln` is not a verify step).
6. Go stacks copy `go-api`'s skeleton and Makefile target names. Code generators are `go tool`
   dependencies; generated code is committed and checked by a `generate-check` verify step.
   Go `deps` keep the full module path the code imports (`charm.land/bubbletea/v2`), because
   `deps` is the brief's install list. The allowlist and `deps/go.json` key by the path with the
   `/vN` suffix stripped, matching what `core/deps.ts::goEntry` reports (Phase 0.2).
7. TypeScript stacks follow `nextjs` and `sveltekit`: Bun installs and runs scripts, Node runs
   servers and Vitest, `claude-harness` is required, agent-neutral guidance lives under
   `files/docs/guidance/<id>/` and Claude rules point at it, and a `guard-<id>-commands.ts` hook
   denies the wrong commands with the fix.
8. Every stack ships agent-ops for its framework: a path-scoped Claude rule, `.claude/settings.json`
   allow rules for its non-destructive commands (listed in `merge`), and a guard hook where there
   is a generated artifact or a known wrong command to stop. Python, Go, Rust and Java stacks use
   `make` (tag `make`), so `ci-github`'s and `docker-deploy`'s `tag=make` branches apply.
9. A new `deps` name gets an allowlist row (key as in decision 6 for Go) and a drafted dependency
   card (`reviewedAt: null`) in the same change, so `build:index` doesn't fail on it. Both are
   reviewed by the maintainer: the allowlist decides which dependency names leave users' machines.
10. Tags decide fragment fit. A stack is tagged `api` only when it serves JSON over HTTP, so
    `go-grpc` and `typescript-mcp` stay off `rest-api`. A stack joins `docker-deploy`'s
    `applies_to` only with a branch that is right for it: the `tag=python` branch assumes uvicorn,
    so `django`, `django-api` and `streamlit` each add a `stack=` branch first.

## Phase 0: shared changes before the stacks

On `feat/stack-expansion`, before the lanes start (0.3's Rust and Java parts run as the first task
of their lanes).

0.1 Search vocabulary (`registry/search/vocabulary.json`): add language `java` (aliases java, jvm,
spring boot, springboot, maven, quarkus) and product kind `library` (aliases library, npm package,
python package, crate, sdk). No bare "package" or "module": both are common words in other
requests. Lanes report other vocabulary needs instead of editing the file.

0.2 CLI fixes (one delegate contract, each with a failing regression test first):

- Go `/vN` keys. Export the suffix strip from `core/deps.ts` and apply it wherever stack `deps`
  are compared with the allowlist (`core/validate/deps.ts::missingFindings`,
  `scripts/index/allowlist.ts::readAllowlist`). Rekey `go.yaml.in/yaml/v3` to `go.yaml.in/yaml` in
  `allowlist.json` and `deps/go.json`; `go-cli`'s `deps` keeps `go.yaml.in/yaml/v3`.
- Go parenthesized blocks. `core/deps.ts::parseGoLine` treats `)` outside a `require` block as an
  error, so a `go.mod` with a `tool ( ... )` block (written by `go get -tool` with two or more
  tools) reports no Go dependencies at all. Skip `tool`, `replace`, `exclude`, `retract` and
  `godebug` blocks.
- Java version literals. Add `pom.xml`, `build.gradle`, `build.gradle.kts`, `settings.gradle`,
  `settings.gradle.kts`, `gradle/libs.versions.toml`, `.mvn/wrapper/maven-wrapper.properties` and
  `gradle/wrapper/gradle-wrapper.properties` to `core/validate/version-sensitive.ts`, with an XML
  rule that flags a digit-led value in `<version>` (except the project's own), `<release>`,
  `<maven.compiler.release>` and any `<*.version>` property, and exempts `<modelVersion>` and the
  POM namespace and schema URLs.

0.3 Fragment branches.

- `agent-ops`: replace the `stacks:when stack=astro-blog,go-cli,mobile-expo,python-react` branch
  with one unconditional sentence (a stack whose `.claude/settings.json` already allows its
  commands needs rules only for commands you add). It fixes `python-api` and `go-api`, which ship
  allow rules and were missing, and removes the per-stack list every lane would edit.
- Rust (lane D, first task): `format-changed.sh` formats `*.rs` with `rustfmt --edition` read from
  the nearest `Cargo.toml` (`package.edition` or `workspace.package.edition`), so no
  `rustfmt.toml` repeats the edition; `lint-on-write.sh` skips `*.rs` (clippy per write is too
  slow). `ci-github` and `docker-deploy` gain `tag=rust` branches. Compose `tauri-react` (tagged
  `rust`, `ci-github` default) and read its brief: the branch must read correctly for a
  Tauri project too, or exclude it with `tag!=tauri`.
- Java (lane C, before `spring-boot-api`): `format-changed.sh` formats the session's `*.java`
  files once at Stop with `./mvnw -q spotless:apply -DspotlessFiles=<regex of those files>`,
  within its existing timeout, and stays quiet when `./mvnw` is absent. `ci-github` and
  `docker-deploy` gain `tag=java` branches (setup-java from `.java-version` with the Maven cache;
  Temurin JDK build stage, JRE runtime, non-root, a health probe that needs no curl).
- Hook changes get tests beside the existing agent-ops hook tests.

0.4 Local toolchains: done on 2026-10-31 (`openjdk@25`, `maven`, `wasm-pack`, the
`wasm32-unknown-unknown` target). Lanes install what else they need.

## Execution

Four lanes run at once, each in its own worktree branched from `feat/stack-expansion` after
Phase 0.1 to 0.3's agent-ops sentence land, so a half-written stack in one lane never breaks
another's scoped tests:

| Lane | Port base | Queue |
| --- | --- | --- |
| A | 8100 | TypeScript, then `quarkus-api` |
| B | 8200 | Python, then `spring-boot-web` |
| C | 8300 | Go, then the Java 0.3 branches, `spring-boot-api`, `java-cli`, `java-library` |
| D | 8400 | Rust 0.3 branches, then Rust |

Java's first stack sets its conventions. Lanes A and B start their Java stack only after
`spring-boot-api` is merged into `feat/stack-expansion` and they have merged that branch in.

Each stack is one `stack-creator` (Opus) dispatch, told to proceed without questions using this
RFC and its language report. It works only in its lane's worktree, follows the stack-authoring
skill end to end including the fresh-scaffold proof, and writes its hand-back to the scratchpad.
The orchestrator reads the hand-back, checks the claimed results, commits the stack on the lane
branch, then dispatches the next one.

Lane rules:

- Serve probes take their port from the environment (`core/verify/run.ts` lets the process
  environment override manifest `env`). A lane sets the stack's port variable from its own base
  (`PORT=8101 node .../stacks verify`), so lanes never collide.
- Lanes edit shared files only by adding their own stack's rows: `allowlist.json` and
  `deps/*.json`, a fragment's `applies_to` and `stack=` branch, `packages/cli/biome.json`,
  `tsconfig.registry.json`, the package README's bundled-stacks table. The orchestrator resolves
  merge conflicts in those files. `vocabulary.json` and `tests/fixtures/bundled-brief-digests.ts`
  are the orchestrator's.
- Lanes never run the gate or a whole suite; they run the scoped tests the skill names.
- Because `bundled-registry.test.ts` goes red with the first drafted card, each author also checks
  that `bun run dev validate --json` has no findings other than `search-unreviewed`,
  `search-stale`, `deps-unreviewed` and `deps-missing`, so a real warning can't hide behind the
  expected ones.

After each lane merges into `feat/stack-expansion`, the orchestrator runs the search tests
(`search-golden`, `search-metadata-holdout`, `search-golden-coverage`) there, since a new card can
take another entry's first-result query once all lanes' cards share one index.

## Verification

Per stack (by its author): validate as above, `validate --brief <id> --sandbox` alone and with each
default and optional fragment under budget, `bun run test:unit tests/bundled-registry.test.ts
tests/registry.test.ts` and the search tests, and the fresh-scaffold proof: `verify` green and
`verify --all` green, each step recorded.

Per branch (orchestrator): brief digests regenerated once after the last merge, one `code-reviewer`
pass per lane's commits with every finding fixed, then `rr check` once at the end. Expected red until
a maintainer acts, and nothing else: `search-unreviewed`/`search-stale` and `deps-unreviewed`
warnings for the new cards, `bundled-registry.test.ts` failing on those warnings, and
`search-golden-coverage.test.ts` on the new ids' missing golden judgments. The branch merges to
`main` locally in that state, as earlier registry batches did, and nothing is pushed; CI's `ci-ok`
stays red until the cards are approved.

## Pending maintainer actions

In order, after merge:

1. Read and approve each new search card (`bun run decorate --approve <id>` from `packages/cli`),
   each new allowlist row, and each drafted dependency card (set `reviewedAt` after reading it).
2. Add golden judgments for each new stack (two first-result queries each; the hand-backs propose
   candidates), keeping `search-golden-coverage.test.ts`'s holdout share between 25% and 40%.
3. Bench each new stack: `bun run bench <id> --agent claude`.
4. Re-bench every existing stack. Phase 0.3 changes `agent-ops`, which is in every default
   composition, and `ci-github`, so every existing stack's fingerprint changes and
   `scripts/index/proof.ts::proveRecord` stops publishing it until a fresh proof lands.

## Follow-ups

Maven dependency telemetry: a `maven` ecosystem needs a new telemetry event version (the v2 and v3
JSON Schemas embed the `Ecosystem` enum and are frozen), an optional `maven` key in
`DependencyAllowlist.names` (a required key makes a new CLI reject today's served allowlist),
`DependencyCards`, `StackDependency` and `readDependencies` support, and a stacks-api release
before any CLI sends it. The new fragments under "Selection", and the next-batch stacks.

## What this plan may get wrong

Twenty-seven stacks is more than the registry has shipped in total. The constraint is the
maintainer's review and bench capacity, not authoring. If review lags, the next batch waits.
Brief budgets are tight on hosts with many optional fragments; a stack whose pairs overrun moves
detail into `files/docs/guidance/` rather than dropping a check. Java's no-literal POM is untested;
`spring-boot-api` is its prototype, and if Setup can't fill the properties reliably the fallback is
a decision recorded in the stack and here, not a pinned version.

## Review

A devils-advocate pass on 2026-10-31 checked the draft against the code. Its corrections, applied
above: dropping `/vN` from Go `deps` would have told the agent to `go get` a path the code doesn't
import; adding `maven` to `Ecosystem` was not additive (frozen telemetry schemas, a required
allowlist key, hard-coded card and stats structs), so Java ships without `deps`; `parseGoLine`
drops every Go dependency when `go.mod` has a `tool` block; the no-parent POM needs per-plugin
properties and Error Prone JVM flags; the proposed version-sensitive rules would have flagged every
POM's `modelVersion`; a hard-coded `openjdk@25` path is a version literal; agent-ops and ci-github
edits stale every existing stack's proof; the expected-red bundled test hides real warnings; Stop
formatting must stay scoped to the session's files and rustfmt needs the manifest's edition;
`docker-deploy`'s Python branch is uvicorn-specific; `git-hooks` has no tag branches; `free-port`
can hand two lanes the same port; and the allowlist rows need review. The selection rule was made
explicit.
