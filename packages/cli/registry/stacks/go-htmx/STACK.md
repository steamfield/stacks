---
schema_version: 1
id: go-htmx
kind: stack
name: Go web app (templ + htmx)
description: A server-rendered Go web app on the standard library, with type-checked templ components and htmx for partial page updates without a JavaScript build. Forms validate on the server and re-render with inline errors, and tests assert the rendered HTML.
tags: [go, web, make]
deps:
  web: [github.com/a-h/templ]
  test: [github.com/stretchr/testify, github.com/PuerkitoBio/goquery]
tools: [go, make, git, golangci-lint, curl]
decisions:
  - "Module path: github.com/<owner>/<project-slug> (default), owner from `gh api user -q .login` or the git remote, never the author's display name. If neither exists, keep the bare `<project-slug>` the shipped imports use and list the path under decisions to revisit."
  - "htmx: the release npm tags `latest`, downloaded by `make htmx` into static/vendor/ and committed (default). Never the `next` tag; a new major changes the response-handling config the layout sets. A CDN script tag instead only when the user asks, and then the content security policy must allow that host."
  - "Styling: plain CSS in static/app.css (default). Tailwind only when the user asks, through its standalone CLI as a build step, never a Node toolchain."
  - "Listen address: HOST 127.0.0.1 and PORT 8080 (default); a container sets HOST=0.0.0.0."
  - "Proving page: notes (title, body) held in memory, with the add-note form (default), or the project's first real page with the same handler shape, form errors and tests."
  - "Persistence: none (default). A database replaces the in-memory store behind the same interface."
  - "Coverage floor: 60% (default)."
env:
  PORT: "8080"
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [docker-deploy, rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: generate-check, layer: check, run: make generate-check }
  - { name: templ-fmt, layer: lint, run: make templ-fmt-check }
  - { name: htmx-vendored, layer: check, run: make htmx-check }
  - { name: fmt-check, layer: lint, run: make fmt-check }
  - { name: vet, layer: typecheck, run: make vet }
  - { name: lint, layer: lint, run: make lint }
  - { name: build, layer: build, run: make build }
  - { name: tidy, layer: check, run: make tidy-check }
  - { name: test, layer: test, run: make test }
  - { name: test-integration, layer: test, run: make test-integration }
  - name: web
    phase: serve
    layer: serve
    run: make serve
    expect: { http: "http://127.0.0.1:${PORT}/healthz", within: 60s }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Download modules and install dev tools that are missing
  generate: Regenerate the *_templ.go files from the .templ components
  generate-check: Fail if a *_templ.go file is missing or differs from its .templ source
  templ-fmt-check: Fail if templ fmt would change any .templ file
  htmx: Download htmx (npm's latest release unless HTMX_VERSION is set) into static/vendor/
  htmx-check: Fail unless the vendored htmx file is present
  build: Build bin/server with templates and static files embedded
  serve: Build, then run the server in the foreground until SIGINT or SIGTERM
  vet: Type-check every package, including tagged integration tests (go vet)
  lint: Run golangci-lint
  lint-fix: Run golangci-lint with --fix
  fmt: Format .templ files and hand-written Go code
  fmt-check: Fail if gofmt or goimports would change any hand-written Go file
  tidy-check: Fail if go mod tidy would change go.mod or go.sum
  test: Unit, component and handler tests with the race detector
  test-integration: Build the binary, run it on a free port, load pages and post forms both ways, stop it with signals
  coverage: Race-enabled tests with a coverage floor
  vuln: Check dependencies and the standard library for known vulnerabilities (govulncheck)
  ci: "Everything CI runs (generate-check, templ-fmt-check, htmx-check, fmt-check, tidy-check, lint, coverage, test-integration, vuln, build)"
  clean: Remove build and coverage output
---

# Go web app (templ + htmx)

## What stacks wrote

A working server-rendered web app that passes every check once its modules resolve, htmx is downloaded and the components are generated. `cmd/server/main.go` binds the listener, drains on SIGINT or SIGTERM and has a `-healthcheck` flag. `internal/views` holds the templ components (layout, notes page, note form, list item, error page) and the plain view types they take; `internal/web` holds the routes, middleware (request id, access log, panic recovery, security headers, cross-origin protection), form handling, the error table and the buffered `render`. `static/` embeds `app.css` and the vendored `htmx.min.js` into the binary. The payload is a notes page whose form posts with htmx: a valid post returns the new list item and an out-of-band empty form, an invalid one returns 422 with the form and its field errors, and the same form works as a plain post without JavaScript. `internal/notes`, `internal/config`, `internal/errors` and `internal/log` hold the domain and boundaries. Component and handler tests sit beside the code and assert on the rendered HTML with goquery; `tests/integration` runs the built binary. The Makefile, `.golangci.yml`, `.env.example` and `docs/` (ARCHITECTURE, pages, configuration, DEVELOPMENT) ship too. Read the code before extending it.

## Setup

The Go files import `<project-slug>/internal/...` and `<project-slug>/static`; the `*_templ.go` files and `static/vendor/htmx.min.js` don't exist until step 3.

1. `go mod init <project-slug>`, then `go get` each module in deps.
2. `go get -tool github.com/a-h/templ/cmd/templ`, so `go tool templ` runs the CLI at the runtime library's version.
3. `make htmx` downloads the release npm tags `latest` into `static/vendor/` (the htmx decision). Then `make generate` and `go mod tidy`.
4. If the module-path decision chose a GitHub path, `go mod edit -module <module path>` and replace `<project-slug>/` with `<module path>/` in every `.go` file's imports.
5. Keep go.mod's `go` directive at the installed toolchain: method patterns and `http.CrossOriginProtection` need a current one. Write the installed golangci-lint version to `.golangci-lint-version`.
6. `make install`, then `make generate-check templ-fmt-check htmx-check fmt-check tidy-check vet lint build test test-integration coverage`. Where an installed release rejects shipped code or config, update it and keep every linter and check; `golangci-lint migrate` converts an older config format.
7. Fill the README's `stacks:fill` markers, record the Go, templ and htmx versions in AGENTS.md, then run `stacks verify` until it passes. Commit the `*_templ.go` files and `static/vendor/htmx.min.js` with the rest.

## Conventions

The shipped code follows these; new code keeps to them. `docs/pages.md` is the page and htmx contract.

- **Generated code stays generated.** Edit `.templ`, run `make generate`, commit both. `make fmt`, `fmt-check` and golangci-lint skip `*_templ.go`.
- **Components are pure.** They take the types in `internal/views/models.go`, never import a domain package or call a store. Handlers load data, convert it (`viewNote`) and call `render`.
- **Every htmx endpoint works without htmx.** Forms keep `action` and `method` beside `hx-post`. `isHTMX(r)` chooses a fragment over a page and nothing else: a plain valid post answers 303, an htmx one answers 200 with fragments.
- **Validation is 422** with the form re-rendered, submitted values kept and one message per field from `apperrors.Validation`. htmx gets the form with `HX-Retarget` and `HX-Reswap`; a plain post gets the whole page. `views.HTMXConfig` is what makes htmx swap a 422; a new swapping status goes there before the `[45]..` rule.
- **Errors.** Handlers return `internal/errors` values from an `endpoint`. `renderError` and `errorTable` are the only mapping to a status and page text; server faults log the cause and never show it.
- **Same-origin only.** The content security policy allows no inline script or style and the htmx config turns off eval, so no `<script>` or `<style>` in components, no `style=` and no `hx-on`. Cross-site posts get 403 from `http.CrossOriginProtection`.
- **Logging**: the `*slog.Logger` from `internal/log`, passed down; JSON on stdout, one `request` record per request with route, status and an `htmx` flag; health and static files at debug; never form values.
- **Config** comes from env in `internal/config` only. A new setting updates its test, `.env.example` and `docs/configuration.md`.
- Keep `main` thin: `run` returns an error, only `main` calls `os.Exit`. Bind the listener before logging its address; keep server timeouts and bounded graceful shutdown.

## Testing

Component tests in `internal/views/views_test.go` render a component into a buffer and query it with goquery: structure, attributes the htmx flow depends on (`hx-target`, `hx-swap-oob`, `aria-invalid`), escaping and the htmx config. Handler tests in `internal/web/handler_test.go` run the real handler under `httptest.NewServer` with redirects disabled and assert status, `HX-*` and security headers and the HTML for the page, both post paths, both error paths, cross-origin posts, mux misses, oversized forms, store failures and panics. A new page or form adds its cases to both files.

Tagged integration tests build the binary once in TestMain, start it on PORT=0 and read the address from its `listening` record. Keep the cases for the page, the vendored htmx asset, both post paths, the cross-origin block, `-healthcheck` on every bind address, SIGINT and SIGTERM, and startup failures. Unit, integration and coverage commands all use `-race`. There is no browser test: the HTML and headers are the contract, and htmx's behavior on them is htmx's.

## Commands

The shipped Makefile (`make help`) holds every declared command. Mirror them in AGENTS.md with a single-test command such as `go test -race -run TestHTMXPostWithErrorsRetargetsTheForm ./internal/web/`. Run `make serve` in the background when needed and stop only the pid you started.

<!-- stacks:when with=agent-ops -->
The stack's Claude settings allow its non-destructive make targets, go test and `go tool templ generate|fmt`. `.claude/hooks/guard-htmx.sh` denies edits to `*_templ.go` and `static/vendor/`, a bare `templ` command and a global `go install` of templ; `.claude/hooks/templ-generate.sh` regenerates a component after each `.templ` write and reports syntax errors. Their tests in `tests/hooks` run with `make test`. `.claude/skills/add-page` walks through adding a page or form. List both hooks and the skill in `.claude/README.md`. Add allow rules only for new commands.
<!-- stacks:end -->

<!-- stacks:when with=git-hooks -->
The Makefile's install recipe runs `lefthook install` outside CI when lefthook.yml exists; write that config before installing. pre-commit formats staged `.templ` files with `go tool templ fmt` and staged Go files other than `*_templ.go` with gofmt and goimports, re-stages, then runs `make generate-check lint`; pre-push runs `make test`.
<!-- stacks:end -->

<!-- stacks:when with=ci-github -->
CI reads Go from go.mod and runs `make install`, `make generate-check`, `make templ-fmt-check`, `make htmx-check`, `make fmt-check`, `make tidy-check`, `make coverage`, `make test-integration`, `make vuln` and `make build`. Lint uses golangci-lint's official action with `version-file: .golangci-lint-version`. CI never runs `make htmx`; the committed file is what ships.
<!-- stacks:end -->

<!-- stacks:when with=docker-deploy -->
Templates and static files are embedded, so the runtime image needs only the binary. The distroless runtime has no shell or curl: use the shipped `server -healthcheck` in an exec-form HEALTHCHECK; it fetches /healthz on PORT and is covered by integration tests. Set HOST=0.0.0.0 in the image. The `*_templ.go` files and htmx are committed, so the build stage runs no generator and no download; build only `./cmd/server`.
<!-- stacks:end -->

## Gotchas

- A `.templ` edit without `make generate` compiles the old component silently. The hook regenerates on save; `generate-check` catches the rest.
- templ's CLI and runtime must match. A global `go install` of templ drifts from go.mod; `go tool templ` doesn't.
- htmx doesn't swap 4xx by default, so a 422 form re-render shows nothing until `HTMXConfig` allows it. Keep the meta tag in the layout.
- An htmx request answered with a 303 follows the redirect and swaps the whole page into the target. Answer htmx with fragments, or `HX-Redirect` with a 200.
- `HX-Retarget` and other response headers are ignored on 3xx responses.
- `templ fmt` formats `<script>` and `<style>` blocks with prettier when it's on PATH, so output differs between machines. The policy bans inline blocks anyway.
- htmx's `next` npm tag is a new major with different configuration; `make htmx` reads `latest`.
- The embed directive names `vendor/htmx.min.js`, so build, vet and lint fail with "pattern ... no matching files" until `make htmx` has run.
- `http.CrossOriginProtection` allows requests without `Sec-Fetch-Site` or `Origin`, so curl and tests pass without headers; test the block with `Sec-Fetch-Site: cross-site`.
- Race checks need cgo and a C compiler. Fix the environment instead of dropping `-race`.
