---
schema_version: 1
id: ci-github
kind: fragment
needs_own_repo: true
category: ci
name: GitHub Actions CI
description: A GitHub Actions workflow that runs the project's own make targets or package scripts on every push and pull request, with SHA-pinned actions in the default preset, least-privilege permissions, and path-filtered jobs for monorepos.
tags: [ci, github]
applies_to: []
tools: [git]
decisions:
  - "Runners: ubuntu-latest (default) or self-hosted labels."
  - "Required check: one aggregate ci-ok job (default)."
  - "CI runs the coverage target instead of plain tests (default: yes)."
  - "Weekly grouped Dependabot updates per ecosystem and for actions (default: yes)."
---

# GitHub Actions CI

Write `.github/workflows/ci.yml`. Check each action's latest major tag before writing the workflow; versions written from memory run two majors behind.

## What to add

- **Triggers**: `push` to the repo's current branch (`git branch --show-current`; `new` keeps git's default name), `pull_request`, `workflow_dispatch`; never `pull_request_target`. **Permissions**: top-level `contents: read`, more only at job level.
- **Jobs call the project's make targets (or package.json scripts, where the stack has no Makefile)**, never re-implemented inline; a CI-only check gets a target or script first. Official setup actions, versions read from the project, frozen-lockfile installs.
- **Generated-code drift**: if generated code is committed, regenerate and fail on `git diff --exit-code`.
<!-- stacks:when preset=default -->
- **Concurrency**: group per workflow and ref, `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` (cancelling on the default branch can let an untested commit reach deploy).
- **Pin actions by full commit SHA** with the tag in a comment, resolved with `git ls-remote --tags https://github.com/<owner>/<repo>` (dereference annotated tags). Never invent one; if you can't resolve it, list it under Pending user actions. `timeout-minutes` on every job.
<!-- stacks:end -->
<!-- stacks:when preset=sandbox -->

Sandbox: keep the workflow minimal, with `timeout-minutes` per job. Major-tag action refs are fine (where an action publishes none, pin its latest release tag); list SHA pinning under Deferred.
<!-- stacks:end -->

<!-- stacks:when tag=monorepo -->
**Monorepo.** A `changes` job (paths-filter action) outputs one boolean per area; each filter covers the area's directory, shared lockfiles and config, the Makefile, and `.github/workflows/**`, and the frontend's also covers the backend's API and schema paths. One job per area gated on its output. A final `ci-ok` job (`needs:` all, `if: always()`) fails if any needed job failed or was cancelled; make it the required check, or path-skipped jobs block merges forever.
<!-- stacks:end -->
<!-- stacks:when tag!=monorepo -->
Use one sequential job named ci-ok for this project, unless the stack's CI notes split the work into jobs; then a final `ci-ok` job (`needs:` all, `if: always()`) is the required check.
<!-- stacks:end -->
<!-- stacks:when tag=make -->
Call the project's Makefile targets, including its full check command and the selected coverage/build targets. Read runtime versions from the project. A tool-specific setup action may install/cache a required binary, but the project's targets remain the behavior contract.
<!-- stacks:end -->
<!-- stacks:when tag=scripts -->
Call the project's package scripts: frozen install, lint, typecheck, coverage or test, and its remaining check/build steps. Use the declared commands instead of copying runner details into CI.
<!-- stacks:end -->
<!-- stacks:when tag=bun -->
Use Bun's setup action with the packageManager version from package.json.
<!-- stacks:end -->
<!-- stacks:when tag=node -->
Set up Node from .node-version where present, or the project's documented runtime version.
<!-- stacks:end -->
<!-- stacks:when tag=go -->
Set up Go from go.mod. Use golangci-lint's official action with the version declared by the project for installation/cache, then its documented checks.
<!-- stacks:end -->
<!-- stacks:when tag=rust -->
Rust: the runner's rustup installs the toolchain, components and targets `rust-toolchain.toml` records, so don't pass a toolchain action input that overrides the file. Cache `~/.cargo` and `target/` with a Cargo cache action keyed on `Cargo.lock`. A cargo subcommand a target needs (cargo-deny, say) comes from a prebuilt-binary installer action, not a `cargo install` that compiles it on every run.
<!-- stacks:end -->
<!-- stacks:when tag=java -->
Java: `actions/setup-java` with `distribution: temurin`, `java-version-file: .java-version` and `cache: maven`, which sets `JAVA_HOME`, so the Makefile uses that JDK. Call the make targets, which run the committed `./mvnw`; never install Maven or call `mvn`. Maven runs in batch mode without transfer progress (`-B -ntp`, as the Makefile passes) so the log stays readable.
<!-- stacks:end -->
<!-- stacks:when tag=python -->
Set up uv with cache and the project's .python-version. Invoke the relevant install/check/coverage targets for each filtered part.
<!-- stacks:end -->

Before finishing, run `actionlint` if installed and make sure every command the workflow calls passes locally.

## AGENTS.md

A short **CI** section: workflow path, what each job runs, the required check, and how to bump pinned actions.
