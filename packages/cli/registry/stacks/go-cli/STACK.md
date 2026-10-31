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
  - "Module path: github.com/<owner>/<project-slug> (default), owner from `gh api user -q .login` or the git remote, never the author's display name. If neither exists, use the bare `<project-slug>` (it builds and installs locally) and list the path under decisions to revisit."
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

## Layout

```
cmd/<bin>/main.go      version/commit/date vars (ldflags), calls cli.Execute(version, commit, date)
internal/cli/          root.go (persistent flags --config --json --verbose --no-color, Execute()),
                       version.go, one <command>.go + _test.go per command
internal/config/       typed Config, Load() via a fresh viper instance, Validate()
internal/errors/       structured Error, codes, exit-code mapping
internal/log/          log/slog logger on stderr, level from --verbose or <BIN>_DEBUG
internal/output/       human vs JSON rendering, TTY and NO_COLOR detection
tests/integration/     black-box tests of the built binary (build tag: integration)
docs/                  ARCHITECTURE.md, configuration.md (every key/env/flag), DEVELOPMENT.md
```

## Setup

No generator; write the code by hand at the root.

1. `go mod init <module path>`, `go get` cobra, viper, testify, `golang.org/x/term`, `go mod tidy`.
2. Write errors, log, output, config, `cli/root.go` + `version.go`, then `main.go`. `BIN` in the Makefile must match the `cmd/` directory.
3. Add one real command (for example `config show`) that exercises config, output modes, and errors end to end.
4. Write `.golangci.yml` for the installed golangci-lint and its version to `.golangci-lint-version`.
5. Tests per Testing; short docs skeletons; fill the README's `stacks:fill` markers (`readme-filled` checks).
6. Run `stacks verify` until it passes.

## Conventions

- **Thin main**: declares `var version, commit, date = "dev", "none", "unknown"` and calls `cli.Execute(version, commit, date)`. Only `Execute` calls `os.Exit`.
- **Commands**: constructors (`newFooCmd() *cobra.Command`), never package-level vars with `init()`, so tests get a fresh tree. `RunE`, cobra `Args` validators, including on the root: without one, an unknown subcommand is cobra's plain error (exit 1), not an `INVALID_INPUT` usage error (exit 2). Root sets `SilenceUsage`/`SilenceErrors`; `Execute()` prints each error once and builds the context with `signal.NotifyContext`.
- **I/O**: `cmd.OutOrStdout()`/`cmd.ErrOrStderr()`, never `fmt.Println`. Results to stdout, everything else to stderr.
- **Config**: `config.Load(flags)` uses `viper.New()` (never the global). Defaults, then the config file if present (missing is fine, malformed is an error), `SetEnvPrefix(<BIN upper>)`, `AutomaticEnv()`, a key replacer mapping `.` and `-` to `_`, bound persistent flags. Unmarshal into `Config`, call `Validate()`. Commands receive `Config`, never read viper.
- **Errors**: `internal/errors` has `type Error struct { Code, Message, Suggestion string; Cause error }`, `New`, `Wrap`, `Unwrap()`, and UPPER_SNAKE codes (`CONFIG`, `CONFIG_NOT_FOUND`, `INVALID_INPUT`, `NOT_FOUND`, `IO`, `INTERNAL`). Human rendering: what failed, why, how to fix. Every user-reachable error has a suggestion; non-`*Error`s are wrapped as `INTERNAL` at the top.
- **Exit codes**: 0 success, 1 runtime, 2 usage, mapped in one function.
- **Output**: `--json` makes every command emit one JSON document on stdout and errors as `{"error":{"code","message","suggestion"}}` on stderr. Color only on a TTY (`term.IsTerminal` from `golang.org/x/term`) with `NO_COLOR` unset. All of this lives in `internal/output`.
- **Logging**: `internal/log` builds one `*slog.Logger` writing to stderr: warnings by default, debug with `--verbose` or `<BIN>_DEBUG=1`, a JSON handler under `--json` so stderr stays parseable. `Execute` builds it and passes it down; no `slog.SetDefault`, no logging to stdout.
- **Packages**: `internal/` unless the user wants a public API. Domain packages never import `cli`. A changed flag, key, or env var updates `docs/configuration.md`.

## Tool configuration

`.golangci.yml`, written for the installed version (its schema changed between majors):

- **Linters**: govet, errcheck, staticcheck, unused, ineffassign, gocritic (diagnostic + performance; disable hugeParam, appendCombine, ifElseChain, wrapperFunc), gocyclo (min 30), misspell, unconvert, unparam, gosec, revive, nolintlint (require explanation and specific linter).
- **revive**: blank-imports, context-as-argument, context-keys-type, dot-imports, error-return, error-strings, error-naming, increment-decrement, var-declaration, range, receiver-naming, time-naming, unexported-return, indent-error-flow, errorf, empty-block, superfluous-else, unreachable-code, redefines-builtin-id. Disable `exported`, `package-comments`, and `var-naming` if the errors package shadows the stdlib name.
- **errcheck**: exclude `fmt.Fprint`, `fmt.Fprintf`, `fmt.Fprintln`, `(io.Closer).Close`, and `os.Setenv`/`os.Unsetenv` (`exclude-functions` takes exact names, no globs).
- **gosec**: on; exclude only rules that fire on the tool's intended behavior, each with a comment.
- **Formatters**: gofmt, goimports. **Exclusions**: generated files; relax gocyclo, gosec, errcheck, unparam in tests. Enable the `integration` build tag.
- **Version**: write the installed version (for example `2.x.y`) to `.golangci-lint-version`. `make lint` warns when the local binary differs, and CI reads the same file.

## Testing

- Unit tests next to code, table-driven with `t.Run`, testify `require` for preconditions and `assert` for checks.
- Command tests build the tree via the constructor, capture output with `SetOut`/`SetErr`, and assert on output, error code, and that a suggestion exists. `t.TempDir()` for config files, `t.Setenv` for env (never `os.Setenv`).
- A config precedence table test: default < file < env < flag.
- Integration tests (`//go:build integration`): `TestMain` builds the binary once into a temp dir; tests run it with `os/exec` and assert exit codes and output.
- `make coverage` runs with `-race` and the agreed floor, through gotestsum so a failing run ends with a list of the failed tests. `make test` skips `-race` (it needs cgo).

## Commands

The shipped Makefile (`make help`) has install, build, vet, lint, lint-fix, fmt, fmt-check (gofmt and goimports), tidy-check, test, test-integration, coverage, vuln (govulncheck), smoke, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md.
<!-- stacks:when with=ci-github -->

**CI.** Go's setup action with the version read from `go.mod`. Steps: `make install`, `make fmt-check`, `make tidy-check`, lint, `make coverage` (`make test` if the coverage decision is no), `make test-integration`, `make vuln`, `make build`. Lint is the one sanctioned exception to calling make targets: use golangci-lint's official action with its `version-file` input pointed at `.golangci-lint-version` (the file `make lint` checks against; the action accepts only that name or `.tool-versions`), because the action installs and caches that exact binary.
<!-- stacks:end -->

## Gotchas

- viper lowercases keys and treats dots as nesting. Decode sections whose keys are user data (env var names, hostnames) with `go.yaml.in/yaml/v3` into your own types; `gopkg.in/yaml.v3` is archived.
- cobra already prints `<name> version <v>` for `--version` when `root.Version` is set. Set it to the bare version string; don't prefix the name or "version" again. Without ldflags it prints `dev`.
- Files behind a build tag are invisible to `go vet`, gopls, and golangci-lint unless the tag is configured.
- `go install ...@latest` lands in `$(go env GOPATH)/bin`, which may not be on PATH; the Makefile falls back to it.
- `make vuln` can fail on a fresh project when the installed Go's standard library has a published advisory that the CLI reaches (net/http is the usual one). Set go.mod's `toolchain` directive to the patched release instead of raising `go`, and `go get -u` the indirect `golang.org/x/...` modules viper pins.
