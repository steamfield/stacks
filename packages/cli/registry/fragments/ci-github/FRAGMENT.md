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
  - "Runners: ubuntu-latest (default) or self-hosted labels (private repos only)."
  - "CI runs the coverage target instead of plain tests (default: yes, when the project has one)."
  - "Weekly grouped Dependabot updates per ecosystem and for actions (default: yes)."
verify:
  - name: ci-workflow
    layer: check
    run: "f=.github/workflows/ci.yml; test -f $f && grep -q '^jobs:' $f && grep -Eq '^[[:space:]]+ci-ok:' $f && ! grep -n 'stacks:fill' $f || { echo \"$f needs jobs:, a ci-ok job and no stacks:fill\" >&2; exit 1; }"
---

# GitHub Actions CI

Write `.github/workflows/ci.yml`, looking up each action's latest release first, never from memory.

<!-- stacks:when mode=add -->
If the repo already has workflows, fold the checks they run into `ci.yml` rather than running them twice; leave deploy and release workflows alone.
<!-- stacks:end -->

## What to add

- **Triggers**: `push` to the default branch (`git symbolic-ref --short refs/remotes/origin/HEAD` minus `origin/`; with no remote, the current branch), `pull_request`, `workflow_dispatch`; never `pull_request_target`.
- **Permissions**: top-level `contents: read`, more only at job level. `actions/checkout` gets `persist-credentials: false`.
- **Jobs call the project's make targets (or package scripts, without a Makefile)**, never re-implemented inline; a CI-only check gets a target or script first. Frozen-lockfile installs.
- **Runtimes**: official setup actions reading versions from project files (`packageManager`, `.node-version`, `go.mod`, `.python-version`); create a missing one from the installed version.
- Pass `${{ github.event.* }}` and `${{ github.head_ref }}` to `run:` through `env:`.
- **Generated-code drift**: if generated code is committed, regenerate and fail on `git diff --exit-code`.
- Pending user actions: require `ci-ok` in the branch ruleset.
<!-- stacks:when preset=default -->
- **Concurrency**: group per workflow and ref, `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
- **Pin actions by full commit SHA** with the exact tag in a comment (`# vX.Y.Z`), resolved with `git ls-remote --tags https://github.com/<owner>/<repo>` (annotated tags: the `^{}` line). Never invent one; if you can't resolve it, list it under Pending user actions. `timeout-minutes` on every job.
- **Dependabot** (if chosen): `.github/dependabot.yml`, one `updates` entry for `github-actions` and one per ecosystem at its manifest's directory, weekly, `cooldown: { default-days: 7 }`, one group with `patterns: ["*"]`.
<!-- stacks:end -->
<!-- stacks:when preset=sandbox -->

Sandbox: a minimal workflow with `timeout-minutes` per job. Major-tag action refs are fine (where an action publishes none, its latest release tag; zizmor will flag them); list SHA pinning and Dependabot under Deferred.
<!-- stacks:end -->

<!-- stacks:when tag=monorepo -->
**Monorepo.** A `changes` job (paths-filter action, `permissions: { contents: read, pull-requests: read }`, checkout first) outputs one boolean per area; each filter covers the area's directory, shared lockfiles and config, the Makefile, and `.github/workflows/**`, and the frontend's also covers the backend's API and schema paths. One job per area gated on its output. A final `ci-ok` job (`needs:` all, `if: always()`) fails if any needed job failed or was cancelled; make it the required check, or path-skipped jobs block merges forever.
<!-- stacks:end -->
<!-- stacks:when tag!=monorepo -->
One sequential `ci-ok` job, unless the stack's CI notes split the work behind a final `ci-ok` (`needs:` all, `if: always()`).
<!-- stacks:end -->
<!-- stacks:when tag=make -->
Call the Makefile's existing aggregate target, or its lint, test (coverage when chosen) and build targets; a setup action may install a binary, but the targets stay the contract.
<!-- stacks:end -->
<!-- stacks:when tag=scripts -->
Call the package scripts: frozen install, lint, typecheck, coverage or test, then the remaining check and build steps.
<!-- stacks:end -->
<!-- stacks:when tag=bun -->
Bun's setup action takes `bun-version-file: package.json`.
<!-- stacks:end -->
<!-- stacks:when tag=go -->
If `make lint` runs golangci-lint, install it with its official action and `version-file: .golangci-lint-version` (create the file from the installed version).
<!-- stacks:end -->
<!-- stacks:when tag=rust -->
Rust: the runner's rustup installs the toolchain, components and targets `rust-toolchain.toml` records, so don't pass a toolchain action input that overrides the file. Cache `~/.cargo` and `target/` with a Cargo cache action keyed on `Cargo.lock`. A cargo subcommand a target needs (cargo-deny, say) comes from a prebuilt-binary installer action, not a `cargo install` that compiles it on every run.
<!-- stacks:end -->
<!-- stacks:when tag=java -->
Java: `actions/setup-java` with `distribution: temurin`, `java-version-file: .java-version` and `cache: maven`, which sets `JAVA_HOME`, so the Makefile uses that JDK. Call the make targets, which run the committed `./mvnw`; never install Maven or call `mvn`. Maven runs in batch mode without transfer progress (`-B -ntp`, as the Makefile passes) so the log stays readable.
<!-- stacks:end -->
<!-- stacks:when tag=python -->
Set up uv with its cache on.
<!-- stacks:end -->

## Verify

`ci-workflow` checks `ci.yml` has `jobs:`, a `ci-ok` job and no `stacks:fill`. Also run each command the workflow calls, then `actionlint` and `zizmor --offline .github` if installed.

## AGENTS.md

A short **CI** section: workflow path, what each job runs, the required check, and how pinned actions move (Dependabot, or `git ls-remote`).
