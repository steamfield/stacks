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
    tags: [hygiene]
    run: "f=.github/workflows/ci.yml; test -f $f && grep -q '^jobs:' $f && grep -Eq '^[[:space:]]+ci-ok:' $f && ! grep -n 'stacks:fill' $f || { echo \"$f needs jobs:, a ci-ok job and no stacks:fill\" >&2; exit 1; }"
---

# GitHub Actions CI

Write `.github/workflows/ci.yml`. Look up each action's latest release; never write a ref from memory.

<!-- stacks:when mode=add -->
If the repo already has workflows, fold the checks they run into `ci.yml` rather than running them twice; leave deploy and release workflows alone.
<!-- stacks:end -->

## What to add

- Triggers: `push` to the default branch (`git symbolic-ref --short refs/remotes/origin/HEAD` minus `origin/`; with no remote, the current branch), `pull_request` and `workflow_dispatch`. Never `pull_request_target`.
- Permissions: top-level `contents: read`, more only at job level. `actions/checkout` gets `persist-credentials: false`.
- Steps call the project's commands after a frozen-lockfile install and never reimplement them inline. A CI-only check becomes a command first.
- Runtimes come from official setup actions reading the project's version files (`packageManager`, `.node-version`, `go.mod`, `.python-version`, `.java-version`); create a missing one from the installed version.
- Pass `${{ github.event.* }}` and `${{ github.head_ref }}` to `run:` through `env:`.
- If generated code is committed, regenerate it and fail on `git diff --exit-code`.
- `timeout-minutes` on every job.
- Pending user actions: require `ci-ok` in the branch ruleset.
<!-- stacks:when preset=default -->
- Concurrency: one group per workflow and ref, `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
- Pin each action by full commit SHA with its exact tag in a comment (`# vX.Y.Z`), resolved with `git ls-remote --tags https://github.com/<owner>/<repo>` (for an annotated tag, the `^{}` line). If you can't resolve one, list it under Pending user actions; never invent one.
- Dependabot, if chosen: `.github/dependabot.yml` with one `updates` entry for `github-actions` and one per ecosystem at its manifest's directory, weekly, `cooldown: { default-days: 7 }`, one group with `patterns: ["*"]`.
<!-- stacks:end -->
<!-- stacks:when preset=sandbox -->

Sandbox: a minimal workflow. Major-tag action refs are fine (where an action publishes none, its latest release tag; zizmor will flag them); list SHA pinning and Dependabot under Deferred.
<!-- stacks:end -->

<!-- stacks:when tag=monorepo -->
**Monorepo.** A `changes` job (paths-filter action, `permissions: { contents: read, pull-requests: read }`, checkout first) outputs one boolean per area; each filter covers the area's directory, shared lockfiles and config, the Makefile, and `.github/workflows/**`, and the frontend's also covers the backend's API and schema paths. One job per area gated on its output. A final `ci-ok` job (`needs:` all, `if: always()`) fails if any needed job failed or was cancelled; make it the required check, or path-skipped jobs block merges forever.
<!-- stacks:end -->
<!-- stacks:when tag!=monorepo -->
One sequential `ci-ok` job, unless the stack's CI notes split the work behind a final `ci-ok` (`needs:` all, `if: always()`).
<!-- stacks:end -->
Each job first installs what its commands need (browsers with system dependencies, services, linter actions, platform packages). Where the stack's CI notes split jobs or name steps, each job runs what its note names; the note wins. Otherwise CI runs the aggregate below, and with coverage chosen the aggregate runs coverage in place of plain tests; declined, leave it as it is.
<!-- stacks:when tag=make -->
The aggregate is `make ci` (in a monorepo, each area's). If it's missing, add it running these targets in order: format check, lint, typecheck, coverage (or test), generated-code and drift checks, build. None may write files or need a secret. The targets stay the contract, though a setup action may install a binary they expect.
<!-- stacks:end -->
<!-- stacks:when tag=scripts -->
The aggregate is a frozen install, then the `check` script (in a monorepo, each area's). If `check` is missing, add it running these scripts in order: format check, lint, typecheck, coverage (or test), generated-code and drift checks, build. None may write files or need a secret.
<!-- stacks:end -->
<!-- stacks:when tag=bun -->
Bun's setup action takes `bun-version-file: package.json`.
<!-- stacks:end -->
<!-- stacks:when tag=go -->
If `make lint` runs golangci-lint, install it with its official action and `version-file: .golangci-lint-version` (create the file from the installed version).
<!-- stacks:end -->
<!-- stacks:when tag=rust -->
Rust: rustup on the runner installs the toolchain, components and targets `rust-toolchain.toml` records, so pass no toolchain input that overrides the file. Cache `~/.cargo` and `target/` with a Cargo cache action keyed on `Cargo.lock`. Install a cargo subcommand a target needs (cargo-deny, say) with a prebuilt-binary installer action, not a `cargo install` that compiles it on every run.
<!-- stacks:end -->
<!-- stacks:when tag=java -->
Java: `actions/setup-java` with `distribution: temurin`, `java-version-file: .java-version` and `cache: maven`. It sets `JAVA_HOME`, which the Makefile's `./mvnw` uses; never install Maven or call `mvn`. Keep the `-B -ntp` the Makefile passes, so the log has no transfer progress.
<!-- stacks:end -->
<!-- stacks:when tag=python -->
Set up uv with its cache on.
<!-- stacks:end -->

## Verify

`ci-workflow` checks only the workflow's shape. Run each command the workflow calls, then `actionlint` and `zizmor --offline .github` if installed.

## AGENTS.md

A short **CI** section: workflow path, what each job runs, the required check, and how pinned actions move (Dependabot, or `git ls-remote`).
