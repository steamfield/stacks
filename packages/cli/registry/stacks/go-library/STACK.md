---
schema_version: 1
id: go-library
kind: stack
name: Go library module
description: A reusable Go module with no binary, for other Go code to import. A small documented API with sentinel and typed errors for errors.Is and errors.As, runnable examples, fuzzing, a consumer module that imports it from outside, and an apidiff check against the last release.
tags: [go, library, make]
tools: [go, make, git, golangci-lint]
decisions:
  - "Module path: github.com/<owner>/<project-slug> (default), owner from `gh api user -q .login` or the git remote, never the author's display name. A library is imported by this path, so settle it before the first release. If neither exists, keep the bare `<project-slug>` the shipped imports use and list the path under decisions to revisit."
  - "Package name: the module path's last element, lowercase, with a `go-` prefix or `-go` suffix dropped and any other `-` removed (default; `go-durations` is `durations`). It replaces the shipped `libname`."
  - "Proving API: Parse and Format for durations with days and weeks (default), or the project's first real API through the same error, option, example, fuzz and consumer patterns. Remove the duration code once the real API covers every path its tests cover."
  - "Tests: the standard testing package only (default), so the module has no requirements at all. Add testify only when the user asks; it becomes a requirement every importer's build list carries."
  - "License: MIT with the author and year (default). For another, replace LICENSE; pkg.go.dev shows docs only for a license it recognizes."
  - "Coverage floor: 80% (default)."
env: {}
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: vet, layer: typecheck, run: make vet }
  - { name: lint, layer: lint, run: make lint }
  - { name: tidy, layer: check, run: make tidy-check }
  - { name: test, layer: test, run: make test }
  - { name: fuzz, layer: test, run: make fuzz }
  - { name: consumer, layer: test, run: make consumer }
  - { name: api-check, layer: check, run: make api-check }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Download modules and the tools.mod dev tools, and install goimports when missing
  vet: Type-check every package, tests and examples included (go vet)
  lint: Run golangci-lint, which also requires a doc comment on every exported name
  lint-fix: Run golangci-lint with --fix
  fmt: Format code
  fmt-check: Fail if gofmt or goimports would change any file
  tidy-check: Fail if go mod tidy would change go.mod or go.sum
  test: Unit tests, Example tests and fuzz seeds with the race detector
  fuzz: Run each fuzz target for FUZZTIME (10s by default)
  consumer: Test tests/consumer from a throwaway module that requires this one, as an importer would
  api-check: Fail on an incompatible change to the exported API since api/baseline.export (apidiff)
  api-baseline: Record the exported API as the baseline (first setup, then a person at each release)
  coverage: Race-enabled tests with a coverage floor
  doc: Print the package documentation as pkg.go.dev shows it
  vuln: Check dependencies and the standard library for known vulnerabilities (govulncheck)
  ci: "Everything CI runs (fmt-check, tidy-check, vet, lint, coverage, fuzz, consumer, api-check, vuln)"
  clean: Remove coverage output
---

# Go library module

A module whose product is its exported API: no `main`, no binary, no config files or logging setup. Callers get documented names, errors they can test with `errors.Is` and `errors.As`, and examples that run as tests. The `Makefile` is the entry point for every task.

## What stacks wrote

A working library that passes every check once its module and tools file exist. The root package (`libname` until Setup renames it) is the API: `doc.go` holds the package comment pkg.go.dev shows first; `duration.go` has `Parse` and `Format` for durations with days and weeks, and `New` with the `WithMax` option for a configured `Parser`; `errors.go` has the sentinels `ErrSyntax`, `ErrRange` and `ErrInvalidOption` and `ParseError`, the typed error that wraps them and carries the input and byte offset. `internal/lex` is the grammar, which no other module can import. Tests: tables beside the code, `example_test.go` (the documentation examples, checked against their `// Output:` comments), `fuzz_test.go` (any input parses or fails with a known error, and accepted input round-trips) and `tests/consumer`, which `make consumer` runs from a separate module. Parsing `1d12h` is the payload that proves the wiring. The Makefile, `.golangci.yml`, LICENSE and `docs/` (public-api, releasing, DEVELOPMENT) ship too. Read the code before extending it.

## Setup

No generator. The Go files import `<project-slug>` and `<project-slug>/internal/lex`.

1. `go mod init <project-slug>`. If the module-path decision chose a GitHub path, `go mod edit -module <module path>` and replace the `"<project-slug>` import prefix with `"<module path>` in every `.go` file and the README.
2. Rename the package: replace `libname` with the package name in every file `grep -rl libname --exclude-dir=.git .` lists (package clauses, `libname_test`, qualified names, error prefixes, docs).
3. Create the tools file and add the API checker to it, so it stays out of `go.mod`: `go mod init -modfile=tools.mod "$(go list -m)"`, then `go get -modfile=tools.mod -tool golang.org/x/exp/cmd/apidiff`. Keep `go.mod`'s and `tools.mod`'s `go` directives at the installed toolchain. Write the installed golangci-lint version to `.golangci-lint-version`.
4. `make install fmt` (goimports names the root package's import wherever the package name differs from the path's last element), then `make fmt-check vet lint tidy-check test fuzz consumer coverage`. Where an installed release rejects shipped code or config, update it and keep every linter and check; `golangci-lint migrate` converts an older config.
5. Record the first API baseline: `make api-baseline`, then `make api-check`. Commit `api/baseline.export` with the rest.
6. Fill the README's `stacks:fill` marker, record the Go, golangci-lint and apidiff versions in AGENTS.md, link `docs/public-api.md` and `docs/releasing.md` from it, then run `stacks verify` until it passes.

## Conventions

The shipped code follows these; new code keeps to them. `docs/public-api.md` lists the exports and what counts as breaking.

- **API**: everything exported lives in the root package; helpers go in `internal/`. Name the compatibility effect of a change before writing it. A breaking change needs the user's agreement and, from v1, a `/v2` module path; never run `make api-baseline` to quiet `make api-check`. The `add-export` skill walks through an addition.
- **Docs**: every exported name has a doc comment starting with its name (revive's `exported` and `package-comments` rules, run by `make lint`). Each entry point has an `Example` with an `// Output:` comment.
- **Errors**: exported sentinels for the kinds, wrapped by an exported error type whose fields carry the details. No string matching, no panics on bad input. Wrap with `%w` or an `Unwrap` method, and keep what an error wraps stable: changing it breaks callers' `errors.Is`.
- **Settings** are functional options validated by `New`, never new parameters on existing functions.
- **No side effects**: library code doesn't print, use the global `log` or `slog` loggers, read the environment, exit, use `init()` or keep mutable package variables (forbidigo, gochecknoinits and gochecknoglobals in `.golangci.yml`). Accept a `*slog.Logger` option only if the user asks for logs.
- **Dependencies**: the standard library first; a requirement in `go.mod` reaches every importer's build. Dev tools live in `tools.mod` and run as `go tool -modfile=tools.mod <name>`.

## Testing

Table tests sit beside the code and cover every path, asserting each error with `errors.Is` and `errors.As` and its exact message. Examples are tests: `go test` compares their output, so an example without an `// Output:` comment only compiles. A parser or encoder gets a fuzz property in `fuzz_test.go`; `make test` runs the seeds and `make fuzz` searches for FUZZTIME per target. A failing input lands in `testdata/fuzz/<Target>/`; commit it as a regression case. A new export gets a call in `tests/consumer/consumer_test.go`, which `make consumer` copies into a throwaway module requiring this one, so `internal/` and unexported names fail to compile there. `make test` and `make coverage` use `-race`.

## Commands

The shipped Makefile (`make help`) has install, vet, lint, lint-fix, fmt, fmt-check, tidy-check, test, fuzz, consumer, api-check, api-baseline, coverage, doc, vuln, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md with a single-test command such as `go test -race -run 'TestParseErrors/1y' .`. `make doc` prints the docs as pkg.go.dev will show them. Releasing is a person's step: `docs/releasing.md`.

<!-- stacks:when with=agent-ops -->
The stack's Claude settings allow its non-destructive make targets (not `api-baseline`), go test, go vet and go doc. `.claude/hooks/guard-library.sh` denies `go test -fuzz` without `-fuzztime`, `go get -tool` without `-modfile=tools.mod`, and rewriting an existing API baseline; its tests in `tests/hooks` run with `make test`. `.claude/skills/add-export` walks through adding an exported name. List the hook and skill in `.claude/README.md`. Add allow rules only for new commands.
<!-- stacks:end -->

<!-- stacks:when with=git-hooks -->
The Makefile's install recipe runs `lefthook install` outside CI when lefthook.yml exists; write that config before installing. pre-commit formats staged Go files with gofmt and goimports, re-stages them, then runs `make lint`; pre-push runs `make test consumer api-check`.
<!-- stacks:end -->

<!-- stacks:when with=ci-github -->
CI reads Go from go.mod and runs `make install`, `make fmt-check`, `make tidy-check`, `make vet`, `make coverage`, `make fuzz`, `make consumer`, `make api-check` and `make vuln`. Lint uses golangci-lint's official action with `version-file: .golangci-lint-version`. There is no build or release job: a release is a tag a person pushes.
<!-- stacks:end -->

## Gotchas

- `go get -tool` writes to `go.mod` by default, and a library's requirements, tools included, join the build list of every module that imports it. Pass `-modfile=tools.mod` to every `go get -tool` and `go tool` call; the Claude hook denies the bare form.
- `go test -fuzz` runs one target in one package per invocation and, without `-fuzztime`, until it finds a failure. `make fuzz` loops over the targets with a time limit.
- apidiff (`golang.org/x/exp`) exits 0 even when it finds incompatible changes; `make api-check` fails on its output instead. It compares only non-internal packages, and the baseline is written with `-trimpath`, so it holds no local paths and doesn't change between machines.
- A module path without a dot in its first element works locally but can't be fetched by anyone else; set the real path before the first tag.
- Race checks need cgo and a C compiler; fix the environment instead of dropping `-race`.
