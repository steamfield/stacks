---
schema_version: 1
id: go-grpc
kind: stack
name: Go gRPC service (Connect)
description: A Go RPC service defined in Protocol Buffers and served with Connect, so one handler answers gRPC, gRPC-Web and JSON over plain HTTP. buf lints the schema and generates code, with server reflection, error-mapping interceptors and tests through a real client.
tags: [go, rpc, grpc, protobuf, make]
deps:
  rpc: [connectrpc.com/connect/v2, connectrpc.com/grpchealth/v2, connectrpc.com/grpcreflect/v2, google.golang.org/protobuf]
  test: [github.com/stretchr/testify]
tools: [go, make, git, golangci-lint, jq]
decisions:
  - "Module path: github.com/<owner>/<project-slug> (default), owner from `gh api user -q .login` or the git remote, never the author's display name. If neither exists, keep the bare `<project-slug>` the shipped imports and buf.gen.yaml use, and list the path under decisions to revisit."
  - "RPC library: Connect (default; standard net/http, gRPC, gRPC-Web and Connect JSON on one port). Use grpc-go only when the user needs its ecosystem (xDS, an existing grpc-go codebase); keep proto/, buf and the tests' shape, and record why in AGENTS.md."
  - "Proto package: notes.v1 under proto/notes/v1 (default). Before the first external client, rename it to <org>.<product>.v1 and move the directory to match."
  - "Listen address: HOST 127.0.0.1 and PORT 8080 (default); a container sets HOST=0.0.0.0. TLS terminates at a proxy or load balancer; the server speaks cleartext HTTP/2."
  - "Reflection: on (default) for grpcurl and buf curl; REFLECTION=false on a public endpoint."
  - "Proving service: notes (title, body) held in memory with CreateNote and GetNote (default), or the project's first real service with the same handler, error table and tests."
  - "Request validation: hand-written in the domain package (default). protovalidate needs a Buf Schema Registry dependency in buf.yaml and a validate interceptor; add it only when the user asks."
  - "Coverage floor: 60% (default), measured over hand-written packages only."
env:
  PORT: "8080"
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [docker-deploy, rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: generate-check, layer: check, run: make generate-check }
  - { name: buf-lint, layer: lint, run: make buf-lint }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: vet, layer: typecheck, run: make vet }
  - { name: lint, layer: lint, run: make lint }
  - { name: build, layer: build, run: make build }
  - { name: tidy, layer: check, run: make tidy-check }
  - { name: test, layer: test, run: make test }
  - { name: test-integration, layer: test, run: make test-integration }
  - name: server
    phase: serve
    layer: serve
    run: make serve
    expect: { http: "http://127.0.0.1:${PORT}/healthz", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Download modules and install dev tools that are missing
  generate: Regenerate gen/ from proto/ with buf and the go tool plugins
  generate-check: Fail if gen/ differs from what proto/ generates
  buf-lint: Lint the .proto files and fail if buf format would change them
  breaking: Fail on wire-breaking proto changes against main (BREAKING_AGAINST)
  build: Build bin/server with version info
  serve: Build, then run the server in the foreground until SIGINT or SIGTERM
  vet: Type-check every package, including tagged integration tests (go vet)
  lint: Run golangci-lint
  lint-fix: Run golangci-lint with --fix
  fmt: Format hand-written Go code and the .proto files
  fmt-check: Fail if gofmt or goimports would change any hand-written Go file
  tidy-check: Fail if go mod tidy would change go.mod or go.sum
  test: Unit and loopback RPC tests with the race detector
  test-integration: Build the binary, run it on a free port, call it over gRPC and Connect, stop it with signals
  coverage: Race-enabled tests with a coverage floor over hand-written packages
  vuln: Check dependencies and the standard library for known vulnerabilities (govulncheck)
  ci: "Everything CI runs (generate-check, buf-lint, fmt-check, tidy-check, lint, coverage, test-integration, vuln, build)"
  clean: Remove build and coverage output
---

# Go gRPC service (Connect)

## What stacks wrote

A working RPC service that passes every check once its modules resolve and `gen/` is generated. `proto/notes/v1/notes.proto` defines `NoteService` (`CreateNote`, `GetNote`); `buf.yaml` holds the lint and breaking rules and `buf.gen.yaml` runs protoc-gen-go and protoc-gen-connect-go through `go tool` into `gen/`. `cmd/server/main.go` serves HTTP/1.1 and cleartext HTTP/2 on one port, drains on SIGINT or SIGTERM, and has a `-healthcheck` flag that calls the gRPC health service. `internal/rpc` builds the Connect server: logging, panic-recovery and error-mapping interceptors, the notes handler, `grpc.health.v1`, server reflection, and `/healthz`, which asks the health service in process. `internal/notes`, `internal/config`, `internal/errors` and `internal/log` hold the domain and boundaries. Unit tests sit beside the code; `internal/rpc/server_test.go` calls a loopback server over gRPC, gRPC-Web and Connect, and `tests/integration` runs the built binary. The Makefile, `.golangci.yml`, `.env.example` and `docs/` (ARCHITECTURE, configuration, rpc-api, DEVELOPMENT) ship too. Read the code before extending it.

## Setup

The Go files import `<project-slug>/gen/...` and `<project-slug>/internal/...`; `gen/` doesn't exist until step 3.

1. `go mod init <project-slug>`, then `go get` each module in deps by its full path (the `/v2` suffixes are part of the import paths).
2. Add the generators as tools, in two commands: `go get -tool google.golang.org/protobuf/cmd/protoc-gen-go connectrpc.com/connect/v2/cmd/protoc-gen-connect-go`, then `go get -tool github.com/bufbuild/buf/cmd/buf`. buf may raise `google.golang.org/protobuf` to a pseudo-version it needs; keep it.
3. If the module-path decision chose a GitHub path, `go mod edit -module <module path>` and replace `<project-slug>/` with `<module path>/` in every `.go` file's imports and in `buf.gen.yaml`'s `go_package_prefix`. Then `make generate` and `go mod tidy`.
4. Read the generated `gen/notes/v1/notesv1connect/notes.connect.go`. The handler interface and `Register...` function must match `internal/rpc`; if the installed plugin changed them, update the shipped code, never `gen/`.
5. Keep go.mod's `go` directive at the installed toolchain. Write the installed golangci-lint version to `.golangci-lint-version`.
6. `make install`, then `make generate-check buf-lint fmt-check tidy-check vet lint build test test-integration coverage`. Where an installed release rejects shipped code or config, update it and keep every linter, buf rule and check; `buf config migrate` and `golangci-lint migrate` convert older config formats.
7. Fill the README's `stacks:fill` markers, record the toolchain and module versions in AGENTS.md, then run `stacks verify` until it passes. Commit `gen/` with the rest.

## Conventions

The shipped code follows these; new code keeps to them.

- **The schema is the contract.** Never renumber, retype or reuse a field; remove one with `reserved`. Each RPC has its own request and response messages. Read-only methods set `idempotency_level = NO_SIDE_EFFECTS`.
- **Generated code stays generated.** Change `proto/`, run `make generate`, commit both. `make fmt`, `fmt-check` and golangci-lint skip `gen/`.
- **Layers.** `internal/<domain>` holds validation and a context-aware `Store` interface and never imports protobuf or Connect; `internal/rpc` converts messages to domain types and back.
- **Errors.** Handlers return `internal/errors` values unchanged. `rpc.toStatus` and `errorTable` are the only mapping to status codes: client faults keep their domain message, server faults send a fixed message and log the cause. Never put a cause's text in a `connect.Error`; only a `*connect.Error` the handler returns itself passes through, so wrap a downstream call's error as a domain error.
- **Interceptors** are arguments to `connect.NewServer` in `rpc.New`, outermost first: `logCalls`, `recoverPanics`, `mapErrors`. A new one (auth, metrics) goes in that list, not in HTTP middleware.
- **Logging**: the `*slog.Logger` from `internal/log`, passed down; never the global logger. JSON on stdout, one `rpc` record per call with procedure, protocol, code and duration; health checks at debug; never request bodies.
- **Config** comes from env in `internal/config` only. A new setting updates its test, `.env.example` and `docs/configuration.md`.
- **Health.** A new service registers its name with the health checker in `rpc.New` and `Drain`.
- Keep `main` thin: `run` returns an error, only `main` calls `os.Exit`. Bind the listener before logging its address; keep the h2c protocols and bounded graceful shutdown.

## Testing

Unit tests are table-driven beside the code, with testify `require` for preconditions and `assert` for checks. `internal/rpc/server_test.go` is the main layer: it serves the real `rpc.New` handler on a loopback port and calls it through the generated client over every protocol. A new method adds its success and error cases to `TestNotesOverEveryProtocol`; a new domain error code adds a row to `TestErrorTable`. Server faults are tested with a failing store, asserting the caller sees only the fixed message and the log holds the cause.

Tagged integration tests build the binary once in TestMain, start it on PORT=0 and read the address from its `listening` record. Keep the cases for gRPC and Connect calls, `/healthz`, `-healthcheck` on every bind address, SIGINT and SIGTERM, NOT_SERVING during `DRAIN_DELAY`, and startup failures. Unit, integration and coverage commands all use `-race`.

## Commands

The shipped Makefile (`make help`) holds every declared command. Mirror them in AGENTS.md with a single-test command such as `go test -race -run TestNotesOverEveryProtocol/grpc ./internal/rpc/`. Run `make serve` in the background when needed and stop only the pid you started. `docs/rpc-api.md` has curl and `go tool buf curl` examples.

<!-- stacks:when with=agent-ops -->
The stack's Claude settings allow its non-destructive make targets, go test and `go tool buf lint|format|breaking`. `.claude/hooks/guard-grpc.sh` denies edits under `gen/`, `buf` or `protoc` run other than through `go tool` (wrappers, paths, npx and `go run` included), and Connect v1 module paths in `go get`, `go install` or `go mod edit`; without jq it blocks every call and names jq. Its tests in `tests/hooks` run with `make test`. `.claude/skills/add-rpc` walks through adding a method. List the hook and skill in `.claude/README.md`. Add allow rules only for new commands.
<!-- stacks:end -->

<!-- stacks:when with=git-hooks -->
The Makefile's install recipe runs `lefthook install` outside CI when lefthook.yml exists; write that config before installing. pre-commit formats staged Go files outside `gen/` with gofmt and goimports (exclude `gen/**`, or `generate-check` fails), runs `go tool buf format -w` on staged `.proto` files, re-stages, then runs `make lint buf-lint`; pre-push runs `make test generate-check`.
<!-- stacks:end -->

<!-- stacks:when with=ci-github -->
CI reads Go from go.mod and runs `make install`, `make generate-check`, `make buf-lint`, `make fmt-check`, `make tidy-check`, `make coverage`, `make test-integration`, `make vuln` and `make build`. Lint uses golangci-lint's official action with `version-file: .golangci-lint-version`. On pull requests, check out with full history and run `make breaking BREAKING_AGAINST='.git#branch=origin/<base branch>'`, taking the base from `github.base_ref`.
<!-- stacks:end -->

<!-- stacks:when with=docker-deploy -->
The distroless runtime has no shell, curl or grpc_health_probe. Use the shipped `server -healthcheck` in an exec-form HEALTHCHECK; it calls the gRPC health service on PORT and is covered by integration tests. Set HOST=0.0.0.0, REFLECTION=false (the reflection decision for a public endpoint) and DRAIN_DELAY=5s (above the orchestrator's probe interval) in the image. `gen/` is committed, so the build stage needs no buf; build only `./cmd/server`.
<!-- stacks:end -->

## Gotchas

- Connect v2 (`connectrpc.com/connect/v2`) differs from most examples online: handlers take and return plain messages (no `connect.Request[T]`), services register on a `connect.Server` and `connecthttp.Mount` puts them on a mux, and interceptors are `func(next ServerFunc) ServerFunc`. grpchealth and grpcreflect must be their `/v2` modules, and the plugin must come from the v2 module too.
- `go get -tool` with buf and protoc-gen-go in one command fails: buf requires a newer protobuf than the latest tag. Add the plugins first, then buf.
- The generators group imports differently from `goimports -local`. Running `gofmt -w .` or `goimports -w .` over the repository rewrites `gen/` and fails `generate-check`; format the hand-written directories only, as `make fmt` does.
- gRPC needs HTTP/2. Without TLS, a plain `http.Server` speaks only HTTP/1.1, so gRPC clients and reflection fail while Connect JSON works. Keep `SetUnencryptedHTTP2` on the server, and use an h2c-only client (`rpc.NewH2CClient`) for gRPC in tests.
- The health service's `Check` isn't marked side-effect free, so it can't be called with HTTP GET; `/healthz` exists for HTTP-only probes. Reflection lists only services registered with a schema, so `grpc.health.v1.Health` doesn't appear in `grpcurl list`; call it by name.
- Read and write timeouts on `http.Server` cut streaming RPCs, including reflection; callers set deadlines instead.
- An error that isn't a `*connect.Error` reaches the caller as `unknown` with no message. Return domain errors and let `mapErrors` translate them.
- `make breaking` fails on a repository with no `main` branch; that's why it isn't a verify step.
- Race checks need cgo and a C compiler. Fix the environment instead of dropping `-race`.
- `make vuln` can fail on a fresh project when the installed Go's standard library has a published advisory that the code reaches (net/http is the usual one). Set go.mod's `toolchain` directive to the patched release instead of raising `go`.
