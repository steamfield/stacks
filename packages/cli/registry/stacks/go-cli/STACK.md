---
schema_version: 1
id: go-cli
kind: stack
name: Go CLI
description: A Go command-line tool with cobra commands, viper config (file, env, flags), structured errors with actionable suggestions, human and JSON output, testify tests with race detection and a coverage floor, and golangci-lint.
tags: [go, cli, make]
deps:
  cli: [github.com/spf13/cobra, github.com/spf13/viper, golang.org/x/term, go.yaml.in/yaml/v3]
  test: [github.com/stretchr/testify]
tools: [go, make, git, golangci-lint]
decisions:
  - "Module path: github.com/<owner>/<project-slug> (default), owner from `gh api user -q .login` or the git remote, never the author's display name. If neither exists, keep the bare `<project-slug>` the shipped imports use (it builds and installs locally) and list the path under decisions to revisit."
  - "Binary name: the project slug (default; the Makefile's BIN)."
  - "Config: YAML at ~/.config/<binary>/config.yaml plus an optional project-local file (default), or env and flags only."
  - "Output: human with --json (default), or JSON with --pretty."
  - "Coverage floor: 50% (default)."
env: {}
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [goreleaser, rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: build, layer: build, run: make build }
  - { name: vet, layer: typecheck, run: make vet }
  - { name: tidy, layer: check, run: make tidy-check }
  - { name: lint, layer: lint, run: make lint }
  - { name: test, layer: test, run: make test }
  - { name: test-integration, layer: test, run: make test-integration }
  - { name: smoke, layer: test, run: make smoke }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Download modules and install dev tools that are missing
  build: Build the binary into bin/ with version info
  vet: Type-check every package, including tagged integration tests (go vet)
  lint: Run golangci-lint
  lint-fix: Run golangci-lint with --fix
  fmt: Format code
  fmt-check: Fail if gofmt or goimports would change any file
  tidy-check: Fail if go mod tidy would change go.mod or go.sum
  test: Unit tests
  test-integration: Integration tests (build and run the binary)
  coverage: Race-enabled tests with a coverage floor and a failure summary (gotestsum)
  vuln: Check dependencies for known vulnerabilities (govulncheck)
  smoke: Build and run the binary's --help and --version
  ci: "Everything CI runs (fmt-check, tidy-check, lint, coverage, test-integration, vuln, build): the full check"
  clean: Remove build and coverage output
---

# Go CLI

A single-binary CLI: cobra commands, viper config (defaults < file < env < flags), structured errors with fix suggestions, and the `Makefile` as the entry point for every task.

## What stacks wrote

A working slice that already passes every check once its modules are resolved: `main.go` at the root (version, commit and date set by ldflags), `internal/cli` (root with `--config --json --verbose --no-color --version`, and `config show`, which loads config, logs and renders both output modes), `internal/config`, `internal/errors`, `internal/log`, `internal/output`, their unit tests, black-box tests in `tests/integration`, `.golangci.yml`, and `docs/` (ARCHITECTURE, configuration, DEVELOPMENT). The `greeting` setting is the hello-world payload. Read the code before extending it; it is the reference for every convention below.

## Setup

No generator. The Go files import `<project-slug>/internal/...`.

1. `go mod init <project-slug>`, `go get` every module in deps, `go mod tidy`.
2. If the module-path decision chose a GitHub path, `go mod edit -module <module path>` and replace `<project-slug>/internal/` with `<module path>/internal/` in every `.go` file.
3. `make install`, then `make build vet lint test test-integration`. Where the installed releases reject shipped code or config (a renamed API, a linter setting golangci-lint dropped), update it to the installed version; keep every linter and check. `golangci-lint migrate` converts a config from an older format.
4. Write the installed golangci-lint version to `.golangci-lint-version`.
5. Fill the README's `stacks:fill` markers (`readme-filled` checks), then run `stacks verify` until it passes.

## Conventions

The shipped code follows these; new code keeps to them.

- **Commands**: one constructor per command (`newFooCmd() *cobra.Command`), never `init()` registration, so tests get a fresh tree. `RunE` and an `Args` validator on every command, root included, so an unknown subcommand is an `INVALID_INPUT` usage error (exit 2). Only `Execute` calls `os.Exit`.
- **I/O**: `cmd.OutOrStdout()`/`cmd.ErrOrStderr()`, never `fmt.Println`. Results go to stdout through `internal/output`, everything else to stderr. Under `--json` every command writes one JSON document, and errors are `{"error":{"code","message","suggestion"}}` on stderr.
- **Config**: commands receive the typed `Config` from `config.Load`, never viper. A new setting gets a default, a `Validate` rule if it can be wrong, a precedence test row and a line in `docs/configuration.md`.
- **Errors**: return `internal/errors` values with an UPPER_SNAKE code and a suggestion saying how to fix it; anything else surfaces as `INTERNAL`. Exit codes stay mapped in the one function.
- **Logging**: the `*slog.Logger` from `internal/log`, passed down; no `slog.SetDefault`, nothing logged to stdout.
- **Packages**: `internal/` unless the user wants a public API. Domain packages never import `cli`.

## Testing

Unit tests sit next to the code, table-driven, with testify `require` for preconditions and `assert` for checks. Command tests build the tree through its constructor and assert on output, error code and suggestion; `t.TempDir()` for files, `t.Setenv` for env. A new command gets an integration case in `tests/integration` (`//go:build integration`; `TestMain` builds the binary once). `make coverage` runs with `-race` and the agreed floor; `make test` skips `-race` because it needs cgo. Keep `.golangci.yml`'s linters when adapting it; `make lint` warns when the local golangci-lint differs from `.golangci-lint-version`, which CI also reads.

## Commands

The shipped Makefile (`make help`) has install, build, vet, lint, lint-fix, fmt, fmt-check (gofmt and goimports), tidy-check, test, test-integration, coverage, vuln (govulncheck), smoke, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md.
<!-- stacks:when with=ci-github -->

**CI.** Go's setup action with the version read from `go.mod`. Steps: `make install`, `make fmt-check`, `make tidy-check`, lint, `make coverage` (`make test` if the coverage decision is no), `make test-integration`, `make vuln`, `make build`. Lint is the one sanctioned exception to calling make targets: use golangci-lint's official action with its `version-file` input pointed at `.golangci-lint-version` (the file `make lint` checks against; the action accepts only that name or `.tool-versions`), because the action installs and caches that exact binary.
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

If `make install` already runs `lefthook install`, don't add another install step. pre-commit formats staged Go files with gofmt and goimports, re-staging fixes, then runs `make lint`; pre-push runs `make test`.
<!-- stacks:end -->

## Gotchas

- viper lowercases keys and treats dots as nesting. Decode sections whose keys are user data (env var names, hostnames) with `go.yaml.in/yaml/v3` into your own types; `gopkg.in/yaml.v3` is archived.
- `--version` is the shipped flag rather than cobra's `root.Version`, so it honors `--json`. Without ldflags it prints `dev`.
- Files behind a build tag are invisible to `go vet`, gopls, and golangci-lint unless the tag is configured.
- `go install ...@latest` lands in `$(go env GOPATH)/bin`, which may not be on PATH; the Makefile falls back to it.
- `make vuln` can fail on a fresh project when the installed Go's standard library has a published advisory that the CLI reaches (net/http is the usual one). Set go.mod's `toolchain` directive to the patched release instead of raising `go`, and `go get -u` the indirect `golang.org/x/...` modules viper pins.
