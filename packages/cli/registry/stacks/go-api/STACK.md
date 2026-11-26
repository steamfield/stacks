---
schema_version: 1
id: go-api
kind: stack
name: Go HTTP API
description: A Go HTTP API on the standard library (net/http, slog) with no web framework. JSON resources share one error envelope and request logging, the server shuts down cleanly on SIGINT and SIGTERM, and race-enabled tests run against the built binary.
tags: [go, api, make]
deps:
  test: [github.com/stretchr/testify]
tools: [go, make, git, golangci-lint]
decisions:
  - "Module path: github.com/<owner>/<project-slug> (default), owner from `gh api user -q .login` or the git remote, never the author's display name. If neither exists, use the bare `<project-slug>` and list the path under decisions to revisit."
  - "Router: the standard library's ServeMux with method patterns (default). Add a third-party router only when the user asks for one, and record why in AGENTS.md."
  - "Listen address: HOST 127.0.0.1 and PORT 8080 (default); a container sets HOST=0.0.0.0."
  - "Proving resource: notes (title, body) held in memory (default), or the project's first real resource with the same routes and tests."
  - "Persistence: none (default). A database replaces the in-memory store behind the same interface."
  - "Coverage floor: 60% (default)."
env:
  PORT: "8080"
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github, rest-api]
  optional: [docker-deploy, rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: vet, layer: typecheck, run: make vet }
  - { name: lint, layer: lint, run: make lint }
  - { name: build, layer: build, run: make build }
  - { name: test, layer: test, run: make test }
  - { name: test-integration, layer: test, run: make test-integration }
  - { name: dev-cycle, layer: test, timeout: 3m, run: make dev-bg && make dev-stop }
  - name: api
    phase: serve
    layer: serve
    run: make serve
    expect: { http: "http://127.0.0.1:${PORT}/healthz", within: 60s }
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Download modules and install dev tools that are missing
  build: Build bin/server with version info
  serve: Build, then run the server in the foreground until SIGINT or SIGTERM
  dev-bg: Build, then start bin/server in the background (or reuse a healthy one), logging to logs/dev.log
  dev-stop: Stop the process group dev-bg started
  vet: Type-check every package, including tagged integration tests (go vet)
  lint: Run golangci-lint
  lint-fix: Run golangci-lint with --fix
  fmt: Format code
  fmt-check: Fail if gofmt or goimports would change any file
  test: Unit and handler tests with the race detector
  test-integration: Build the binary, run it on a free port, test it over HTTP and stop it with signals
  coverage: Race-enabled tests with a coverage floor
  vuln: Check dependencies and the standard library for known vulnerabilities (govulncheck)
  ci: "Everything CI runs (fmt-check, lint, coverage, test-integration, vuln, build)"
  clean: Remove build and coverage output
---

# Go HTTP API

## What stacks wrote

A standard-library HTTP server with `cmd/server/main.go`, env config, typed errors, JSON slog logging, a race-safe in-memory notes store and the HTTP boundary in `internal/httpapi`. Create, read and paginated list routes under `/v1/notes` exercise validation, the error envelope and request middleware; `/healthz` proves liveness. Unit and real-HTTP handler tests sit beside the code, and `tests/integration` builds the binary and checks HTTP, healthchecks and signal shutdown. `scripts/dev-bg.sh` runs the server in the background. The Makefile, golangci config, env example and reference docs under `docs/` ship too; read the code before extending it.

## Setup

No generator. Go imports use `<project-slug>/internal/...`.

1. `go mod init <project-slug>`, `go get github.com/stretchr/testify`, then `go mod tidy`.
2. If the module-path decision chose a GitHub path, run `go mod edit -module <module path>` and replace `<project-slug>/internal/` with `<module path>/internal/` in every Go file.
3. Set go.mod's Go directive to the installed toolchain and write the installed golangci-lint version to `.golangci-lint-version`, before any check: the directive selects the mux's routing behavior.
4. `make install`, then `make fmt-check vet lint build test test-integration coverage`. Update shipped code or config the installed release rejects, keeping every linter and check. `golangci-lint migrate` can convert an older config format.
5. Fill README's `stacks:fill` markers and the selected fragments' agent guidance, then run `stacks verify` until green.

## Conventions

- New resources live in `internal/<resource>` with validation and a context-aware Store interface; handlers go in `internal/httpapi`. Domain packages never import httpapi.
- Env reads stay in `internal/config`. A new setting updates its tests, `.env.example` and `docs/configuration.md`.
- Handlers return typed `internal/errors` values. Statuses, safe messages and retryability come only from the table in `httpapi/response.go`; causes go to logs, never to responses.
- Every route goes through the shipped request-id, access-log and recovery middleware and the strict, size-capped JSON decoder.
- Pass the `*slog.Logger` from `internal/log`; never set the global logger. Request logs carry route patterns and ids, never bodies or query values.
- `run` returns an error and only `main` calls os.Exit. Keep the server timeouts and bounded graceful shutdown.

## Testing

Add each new route's success and error cases to the handler tests, which run through a real `httptest` listener with the real store and assert status, headers, body and logs. Unit tests stay table-driven, with testify require for preconditions and assert for checks, and t.Setenv for env.

Keep the integration tests for SIGINT, SIGTERM, exit status, the stopped record and the `-healthcheck` flag. Every test command uses `-race`. When adapting `.golangci.yml`, keep its linters, including bodyclose, and the integration build tag.

## Commands

`make help` lists every declared command; mirror them in AGENTS.md. Run one test with `go test -race -run TestRequestFailures ./internal/httpapi/`.

To keep a server running while you work, use `make dev-bg` and read `logs/dev.log`; stop it with `make dev-stop`. Don't background `make serve` or kill server processes by name: dev-stop signals only the process group it recorded. Stop it before `stacks verify`, whose serve step needs the port.

<!-- stacks:when with=agent-ops -->
The stack's Claude settings already allow its make targets except `clean`, plus go test, vet and build and curl to 127.0.0.1. Add rules only for new commands.
<!-- stacks:end -->

<!-- stacks:when with=git-hooks -->
pre-commit formats staged Go files with gofmt and goimports, re-stages the fixes, then runs `make lint`; pre-push runs `make test`. `make install` already runs `lefthook install`.
<!-- stacks:end -->

<!-- stacks:when with=rest-api -->
The shipped notes resource follows the REST rule. Record /v1, the shared envelope, cursor pagination (default 20, max 100) and 405 with Allow in AGENTS.md's API conventions, with notes as the example.
<!-- stacks:end -->

<!-- stacks:when with=docker-deploy -->
The integration tests cover `server -healthcheck`, the image's HEALTHCHECK; keep it working when /healthz or PORT handling changes.
<!-- stacks:end -->

## Gotchas

- Method patterns follow go.mod's Go directive. An old directive selects the legacy mux and routes return 404; use the installed toolchain's directive.
- GET also matches HEAD. Read a path parameter with r.PathValue; it matches one segment.
- The mux records its pattern on the request it receives. Middleware between the access logger and mux must not swap it for a copy with r.WithContext.
- Keep draining a child server's stdout after the listening record, or a full pipe blocks requests.
- Decode and validate before writing headers. A later failure cannot change an already-written status; recovery aborts that connection.
- Replacing the mux's plain-text 404 or 405 body must keep its status and Allow header.
- Race checks need cgo and a C compiler. Fix the environment instead of dropping -race.
- A standard-library advisory reached by net/http can fail make vuln. Select a patched toolchain in go.mod instead of weakening the check.
