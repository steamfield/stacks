---
schema_version: 1
id: go-mcp
kind: stack
name: Go MCP server
description: A Model Context Protocol server in Go on the official MCP Go SDK, giving Claude Code and other agent hosts typed tools over stdio, with input schemas derived from Go structs, tool errors the model can read, logs kept off stdout and protocol tests.
tags: [go, mcp, make]
deps:
  mcp: [github.com/modelcontextprotocol/go-sdk]
  test: [github.com/stretchr/testify]
tools: [go, make, git, golangci-lint, jq]
decisions:
  - "Module path: github.com/<owner>/<project-slug> (default), owner from `gh api user -q .login` or the git remote, never the author's display name. If neither exists, keep the bare `<project-slug>` the shipped imports use and list the path under decisions to revisit."
  - "Server name: the project slug (default; `config.Binary`, which is also the binary under bin/ and the name hosts show)."
  - "SDK: the official github.com/modelcontextprotocol/go-sdk (default). Use mark3labs/mcp-go only when the user asks; then rewrite internal/server and the tests' client against it, keep the error policy and tests, and record why in AGENTS.md."
  - "Transport: stdio (default), for a server a host starts per user. Add Streamable HTTP only when the user asks for a remote or shared server: serve `mcp.NewStreamableHTTPHandler` on HOST (default 127.0.0.1) and PORT from internal/config beside stdio, add a /healthz route, a serve verify step probing it and integration tests over the SDK's Streamable client transport."
  - "Proving tool: convert_units, a pure unit conversion (default), or the project's first real tool through the same addTool, error table and tests. Remove convert_units and internal/convert once a real tool covers every path they test."
  - "Coverage floor: 80% (default), not counting the cmd/mcpcall dev client."
env: {}
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [goreleaser, rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: vet, layer: typecheck, run: make vet }
  - { name: lint, layer: lint, run: make lint }
  - { name: build, layer: build, run: make build }
  - { name: tidy, layer: check, run: make tidy-check }
  - { name: test, layer: test, run: make test }
  - { name: test-integration, layer: test, run: make test-integration }
  - { name: smoke, layer: test, run: make smoke }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Download modules and install dev tools that are missing
  build: Build the server into bin/ with version info
  vet: Type-check every package, including tagged integration tests (go vet)
  lint: Run golangci-lint, whose forbidigo rule keeps prints off stdout
  lint-fix: Run golangci-lint with --fix
  fmt: Format code
  fmt-check: Fail if gofmt or goimports would change any file
  tidy-check: Fail if go mod tidy would change go.mod or go.sum
  test: Unit and in-memory protocol tests with the race detector
  test-integration: Build the server and drive it over stdio as a host would (tools, errors, stdout, exit)
  coverage: Race-enabled tests with a coverage floor
  vuln: Check dependencies and the standard library for known vulnerabilities (govulncheck)
  smoke: Run --version, then start bin/ over stdio and list its tools
  call: List the tools, or call TOOL with ARGS (JSON), over stdio
  ci: "Everything CI runs (fmt-check, tidy-check, lint, coverage, test-integration, vuln, build, smoke)"
  clean: Remove build and coverage output
---

# Go MCP server

## What stacks wrote

A working MCP server that passes every check once its modules resolve. `main.go` sits at the root (version, commit and date set by ldflags) and calls `internal/app`, which loads config, answers `--help` and `--version`, logs JSON to stderr and runs the server on the stdio transport until stdin closes or a signal arrives. `internal/server` builds the `mcp.Server`, logs each request through receiving middleware and registers tools through `addTool`, the one place a returned error or a panic becomes a tool error result. The payload is `convert_units`: typed input and output structs whose JSON Schemas the SDK derives, a description written for a model, and domain errors (`internal/convert`) the model reads and can correct. `internal/config`, `internal/errors` (one table from code to client message and exit status) and `internal/log` hold the boundaries. `cmd/mcpcall` is a dev client that starts the binary like a host and lists or calls tools. Unit tests sit beside the code; `server_test.go` drives the server over in-memory transports, and `tests/integration` drives the built binary over stdio and checks stdout held only JSON-RPC. The Makefile, `.golangci.yml`, `.env.example` and `docs/` (ARCHITECTURE, configuration, hosts, DEVELOPMENT) ship too. Read the code before extending it.

## Setup

No generator. The Go files import `<project-slug>/internal/...`.

1. `go mod init <project-slug>`, then `go get` every module in deps, then `go mod tidy`.
2. If the module-path decision chose a GitHub path, `go mod edit -module <module path>` and replace `<project-slug>/internal/` with `<module path>/internal/` in every `.go` file.
3. Keep go.mod's `go` directive at the installed toolchain. Write the installed golangci-lint version to `.golangci-lint-version`.
4. Read `go doc github.com/modelcontextprotocol/go-sdk/mcp` for the installed release. The shipped code uses `NewServer`, `ServerOptions`, `AddTool`, `ToolHandlerFor`, `AddReceivingMiddleware`, `StdioTransport`, `IOTransport`, `CommandTransport` and `NewInMemoryTransports`. Where a release renamed or changed one, update the shipped code and keep `addTool`'s error policy and every test.
5. `make install`, then `make fmt-check vet lint build tidy-check test test-integration smoke coverage`. Where an installed release rejects shipped code or config, update it and keep every linter and check; `golangci-lint migrate` converts an older config.
6. Fill the README's `stacks:fill` markers, record the toolchain and module versions in AGENTS.md, then run `stacks verify` until it passes.

## Conventions

The shipped code follows these; new code keeps to them.

- **Stdout is the transport.** Nothing in the server prints. forbidigo in `.golangci.yml` rejects `fmt.Print*`, `println`, `os.Stdout` and the standard `log` printers outside `cmd/mcpcall`; keep the rule. Only `--help` and `--version` write to `Env.Stdout`, before the transport starts.
- **Tools.** One file per tool in `internal/server` with `<Tool>Input` and `<Tool>Output` structs, registered from `New` through `addTool`, never `mcp.AddTool` directly. Every field has a `json` tag and a `jsonschema` description; a field is optional only with `omitempty`. Names are snake_case; annotations say whether the tool reads, writes or reaches outside the machine.
- **Descriptions are prompts.** Say when to call the tool, what it needs, what it returns and give one example call. Error messages for caller mistakes say how to fix the call.
- **Errors.** Domain packages return `internal/errors` values and never import the SDK. `InvalidInput` reaches the model as written; everything else, and any panic, reaches it as `InternalMessage` with the cause logged. A tool failure is a result with `isError`, never a protocol error.
- **Logging**: the `*slog.Logger` from `internal/app`, passed down, never `slog.SetDefault`. One `request` record per call; never log arguments or results. The SDK gets `log.Floor(logger, slog.LevelWarn)`.
- **Config**: flags over `<PREFIX>_*` environment variables over defaults, all in `internal/config`. Hosts pass settings as environment variables, so every flag has one. A new setting gets a default, validation, test rows and a line in `docs/configuration.md`.
- **Lifecycle.** The server exits 0 when stdin closes or on SIGINT or SIGTERM; only `main` calls `os.Exit`.

## Testing

`internal/server/server_test.go` is the main layer: `connect` serves the real `New` on one end of `mcp.NewInMemoryTransports` and returns a client session on the other. A new tool adds a list assertion (name, required properties, descriptions) and call cases for success, decoding `StructuredContent` into its output struct, and for each error path, asserting `IsError` and the message. `TestServerFaultsStayPrivate` covers the error policy for every tool. `internal/app/app_test.go` runs the whole app over pipes. Tagged integration tests build the binary once with `-race` and drive it with the SDK client over its stdin and stdout; keep the cases for tools, a tool error, protocol-only stdout, JSON-only stderr, exit on closed stdin and on SIGINT and SIGTERM, and flags. Unit, integration and coverage commands use `-race`.

## Commands

The shipped Makefile (`make help`) has install, build, vet, lint, lint-fix, fmt, fmt-check, tidy-check, test, test-integration, coverage, vuln, smoke, call, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md with a single-test command such as `go test -race -run TestConvertUnitsToolErrors ./internal/server/`. Try the built server with `make call TOOL=convert_units ARGS='{"value": 5, "from": "km", "to": "mi"}'`. `docs/hosts.md` shows how to add it to Claude Code and other hosts; ask the user before changing their host config.

<!-- stacks:when with=agent-ops -->
The stack's Claude settings allow its non-destructive make targets, `make call` without arguments and go test; `make call TOOL=...` and `go run ./cmd/mcpcall` ask first, because make arguments can override any variable and mcpcall runs whatever program it is given. `.claude/hooks/guard-mcp.sh` denies feeding stdin (a pipe, a file redirect or a heredoc) to the built server or `go run .`, the MCP Inspector without `--cli`, and adding a second Go MCP library; it blocks every command when jq is missing, and its tests in `tests/hooks` run with `make test`. `.claude/skills/add-tool` walks through adding a tool. List the hook and skill in `.claude/README.md`. Add allow rules only for new commands.
<!-- stacks:end -->

<!-- stacks:when with=git-hooks -->
The Makefile's install recipe runs `lefthook install` outside CI when lefthook.yml exists; write that config before installing. pre-commit formats staged Go files with gofmt and goimports, re-stages them, then runs `make lint`; pre-push runs `make test`.
<!-- stacks:end -->

<!-- stacks:when with=ci-github -->
CI reads Go from go.mod and runs `make install`, `make fmt-check`, `make tidy-check`, `make coverage`, `make test-integration`, `make vuln`, `make build` and `make smoke`. Lint uses golangci-lint's official action with `version-file: .golangci-lint-version`. The tests need no host, network or terminal.
<!-- stacks:end -->

## Gotchas

- Piping JSON-RPC into the binary (`echo ... | ./bin/<slug>`) prints nothing: the server stops when stdin reaches EOF, before it answers. Use `make call` or a test. Hand-written frames also have to track protocol revisions (the newest replaced the `initialize` handshake with per-request metadata); the SDK client negotiates for you.
- Most Go MCP examples online are mark3labs/mcp-go (`server.NewMCPServer`, `mcp.NewTool` with `mcp.WithString`) or the official SDK before v1. Read the installed package's `go doc`.
- The `jsonschema` struct tag is only a description, and must not start with `WORD=`; the `jsonschema:"required,description=..."` form other libraries use breaks inference. Required comes from the absence of `omitempty` or `omitzero`, and struct schemas reject unknown properties.
- Arguments that fail the derived schema never reach the handler; the SDK returns a tool error naming the field. An unknown tool name is a protocol error.
- The SDK doesn't recover panics in tool handlers; without `addTool`'s recover, one panic ends the process and the host's session.
- A nil `ServerOptions.Capabilities` advertises the deprecated logging capability; `New` passes an empty struct so only tools are advertised.
- `make vuln` can fail on a fresh project when the installed Go's standard library has a published advisory that the code reaches. Set go.mod's `toolchain` directive to the patched release instead of raising `go`.
- Race-enabled binaries sleep about a second on exit (the race detector's `atexit_sleep_ms`), so integration cases take a second each; that isn't a hang. Race checks need cgo and a C compiler; fix the environment instead of dropping `-race`.
