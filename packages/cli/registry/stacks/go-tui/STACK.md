---
schema_version: 1
id: go-tui
kind: stack
name: Go terminal UI (Bubble Tea)
description: A full-screen Go terminal app on Bubble Tea, with Bubbles components and Lip Gloss styles, an Elm-style model tested by sending key messages and comparing rendered frames to saved golden frames, a text and JSON fallback when there's no terminal, and one static binary.
tags: [go, tui, make]
deps:
  tui: [charm.land/bubbletea/v2, charm.land/bubbles/v2, charm.land/lipgloss/v2, golang.org/x/term]
  test: [github.com/stretchr/testify, github.com/charmbracelet/x/exp/teatest/v2]
tools: [go, make, git, golangci-lint, jq]
decisions:
  - "Module path: github.com/<owner>/<project-slug> (default), owner from `gh api user -q .login` or the git remote, never the author's display name. If neither exists, keep the bare `<project-slug>` the shipped imports use and list the path under decisions to revisit."
  - "Binary name: the project slug (default; the Makefile's BIN)."
  - "Proving payload: the task list, from the built-in sample or a JSON file (default), or the project's first real data behind the same LoadFunc, keeping the list and detail screens and their tests."
  - "Without a terminal: print the list as text, or JSON with --json (default). If the product has nothing useful to print, exit 2 with a message saying to run it in a terminal; keep the integration case for it."
  - "Coverage floor: 70% (default)."
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
  build: Build the binary into bin/ with version info
  vet: Type-check every package, including tagged integration tests (go vet)
  lint: Run golangci-lint
  lint-fix: Run golangci-lint with --fix
  fmt: Format code
  fmt-check: Fail if gofmt or goimports would change any file
  tidy-check: Fail if go mod tidy would change go.mod or go.sum
  test: Unit, golden-frame and headless program tests with the race detector
  test-integration: Build the binary and run it without a terminal (flags, text, JSON, exit codes)
  coverage: Race-enabled tests with a coverage floor
  golden: Rewrite the golden frames after a deliberate view change
  vuln: Check dependencies and the standard library for known vulnerabilities (govulncheck)
  smoke: Run the binary's --help and --version, and its text fallback with no terminal
  ci: "Everything CI runs (fmt-check, tidy-check, lint, coverage, test-integration, vuln, build)"
  clean: Remove build and coverage output
---

# Go terminal UI (Bubble Tea)

## What stacks wrote

A working terminal app that passes every check once its modules resolve. `main.go` sits at the root (version, commit and date set by ldflags) and calls `internal/app`, which loads config, opens the logger and either starts the Bubble Tea program or, without a terminal on stdin and stdout, prints through `internal/output`. `internal/ui` holds the root model (loading, list, detail and error screens), its key map and views; `internal/theme` every Lip Gloss style; `internal/tasks` the payload's data and loader; `internal/config`, `internal/errors` and `internal/log` the boundaries. The payload is a task list loaded in a `tea.Cmd`, filterable, opened into a detail view, with `q` to quit. Unit tests sit beside the code, golden frames live in `internal/ui/testdata`, a teatest test runs the program headless, and `tests/integration` runs the built binary with no terminal. The Makefile, `.golangci.yml` and `docs/` (ARCHITECTURE, configuration, DEVELOPMENT) ship too. Read the code before extending it.

## Setup

No generator. The Go files import `<project-slug>/internal/...`.

1. `go mod init <project-slug>`, then `go get` every module in deps by its full path (the `/v2` suffix is part of the import path), then `go mod tidy`. teatest has no tagged releases, so `go get` records a pseudo-version; that's expected.
2. If the module-path decision chose a GitHub path, `go mod edit -module <module path>` and replace `<project-slug>/internal/` with `<module path>/internal/` in every `.go` file.
3. Keep go.mod's `go` directive at the installed toolchain. Write the installed golangci-lint version to `.golangci-lint-version`.
4. `make install`, then `make fmt-check vet lint build tidy-check test test-integration smoke coverage`. Where an installed release rejects shipped code or config (a renamed API, a dropped linter setting), update it and keep every linter and check; `golangci-lint migrate` converts an older config.
5. If `TestFrames` fails only because the installed Bubbles or Lip Gloss renders default styles differently, run `make golden`, read the diff, and keep it only when the change is styling. A missing line or wrong text is a bug to fix.
6. Fill the README's `stacks:fill` markers, record the toolchain and module versions in AGENTS.md, then run `stacks verify` until it passes.

## Conventions

The shipped code follows these; new code keeps to them.

- **Two front ends, one decision.** `app.Run` starts the UI only when neither `--no-tui` nor `--json` is set and stdin and stdout are both terminals. Every new feature that shows data also prints it through `internal/output` in text and JSON.
- **Update and View do no I/O.** Loading, saving, network calls and timers run in a `tea.Cmd` that returns a message. Inject what the command needs (as `ui.New` takes a `LoadFunc`) so tests pass a fake.
- **Keys.** Every binding the model handles is in `keys.go` with `key.WithHelp` and shows in its screen's help. While the list is filtering, keys go to the list; only ctrl+c stops the program.
- **Styles** come from `internal/theme`, built for a dark or light background from Bubble Tea's `BackgroundColorMsg`. No colors inline, no `NO_COLOR` checks: the renderer downsamples to the terminal's profile and honors `NO_COLOR`.
- **Logging**: the `*slog.Logger` from `internal/log`, passed down. It writes JSON to `--log-file` or nowhere; never stdout or stderr, which belong to the UI.
- **Errors**: return `internal/errors` values with an UPPER_SNAKE code and a suggestion. `ExitCode` is the one mapping (usage 2, interrupted 130, everything else 1); only `main` calls `os.Exit`. A load failure shown on screen still exits 1 through `Model.Err()`.
- **Config**: flags over `<PREFIX>_*` environment variables over defaults, all in `internal/config`. A new setting gets a default, validation, a precedence test row and a line in `docs/configuration.md`.
- **Imports** are `charm.land/bubbletea/v2`, `charm.land/bubbles/v2/...` and `charm.land/lipgloss/v2`, all from the same major.

## Testing

Test the model as a state machine: build it with `New`, send `tea.WindowSizeMsg` and key messages to `Update`, assert on fields and returned commands. Run a command by calling it, and feed its message back in, as `ready` does with `Init`. Each screen has a frame in `TestFrames` compared to `testdata/TestFrames/<screen>.golden` at a fixed 60x16 size; a new screen adds one. `program_test.go` runs the real program loop through teatest; it waits for output before sending keys, because keys sent while loading reach the loading screen. A new flag or output mode gets a case in `tests/integration`, which runs the built binary with stdin from `/dev/null`. Tests, integration tests and coverage use `-race`. Keep `.golangci.yml`'s linters when adapting it.

## Commands

The shipped Makefile (`make help`) has install, build, vet, lint, lint-fix, fmt, fmt-check, tidy-check, test, test-integration, coverage, golden, vuln, smoke, ci, clean. Adapt recipes, keep the names, mirror them in AGENTS.md with a single-test command such as `go test -race -run TestFrames/detail ./internal/ui/`. No target starts the UI.

<!-- stacks:when with=agent-ops -->
The stack's Claude settings allow its non-destructive make checks and go test, and `.claude/hooks/guard-tui.sh` denies hand edits to golden files and running anything under `script`, `unbuffer`, `tmux`, `screen`, `expect` or Python's `pty` module, however the command is quoted, prefixed or wrapped in `sh -c`. It needs jq and denies every call without it. Its tests in `tests/hooks` run with `make test` and fail without jq. List the hook in `.claude/README.md`. Add allow rules only for new commands.
<!-- stacks:end -->

<!-- stacks:when with=git-hooks -->
The Makefile's install recipe runs `lefthook install` outside CI when lefthook.yml exists; write that config before installing. pre-commit formats staged Go files with gofmt and goimports, re-stages them, then runs `make lint`; pre-push runs `make test`.
<!-- stacks:end -->

<!-- stacks:when with=ci-github -->
CI reads Go from go.mod and runs `make install`, `make fmt-check`, `make tidy-check`, `make coverage`, `make test-integration`, `make vuln` and `make build`. Lint uses golangci-lint's official action with `version-file: .golangci-lint-version`. CI has no terminal, which is what the tests expect: teatest and the integration tests need none.
<!-- stacks:end -->

## Gotchas

- Bubble Tea opens `/dev/tty` when stdin isn't a terminal, so `app < file` or a pipe still takes over the terminal and hangs an agent's shell. The terminal check in `app.Run` must stay before `tea.NewProgram`.
- Never run the UI under `script`, `unbuffer`, `tmux`, `screen`, `expect` or `pty.spawn` to "see" it; the session hangs waiting for keys. Use the tests, `--no-tui` or `--json`, or ask the user.
- ctrl+c returns `tea.Interrupt`, not `tea.Quit`, so `Run` reports `tea.ErrInterrupted` and the app exits 130; `q` is the normal quit with 0.
- `make vuln` can fail on a fresh project when the installed Go's standard library has a published advisory that the app reaches. Set go.mod's `toolchain` directive to the patched release instead of raising `go`.
- Most examples online are v1 (`github.com/charmbracelet/bubbletea`, `View() string`, `tea.KeyMsg` with `msg.Type`). v2 returns `tea.View`, sends `tea.KeyPressMsg`, and sets the alternate screen with `View.AltScreen`. Mixing v1 and v2 imports compiles into two incompatible APIs.
- Lip Gloss v2 renders full ANSI styles regardless of the terminal; the program's renderer downsamples them. Golden frames therefore hold escape codes, compared escaped, and are the same on every machine.
- `golden.RequireEqual` (through `teatest.RequireEqualOutput`) registers the `-update` flag. Don't define another `-update` flag in a package that imports teatest; the test binary panics.
- `list.Model` handles `q` as quit unless `DisableQuitKeybindings` is called. The shipped model disables it and owns quitting, so `q` typed into a filter stays in the filter.
- Race checks need cgo and a C compiler. Fix the environment instead of dropping `-race`.
