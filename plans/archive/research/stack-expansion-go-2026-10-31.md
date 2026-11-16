# Go stack expansion research (2026-10-31)

Read-only research. Proposes seven new Go stacks for the bundled registry, ranked, plus rejected candidates and the fragment changes they need. Nothing here has been prototyped. These are recipes to prove from an empty directory, not claims that they already reach a green verify.

## Summary: ranked list

| Rank | Id | Name | Priority | Why it earns a slot |
| --- | --- | --- | --- | --- |
| 1 | `go-grpc` | Go gRPC service (Connect) | P1 | API/RPC services are the #1 thing Go developers build (75%). gRPC is the default for Go service-to-service work. Protobuf-first codegen with buf is exactly where agents go wrong without a target |
| 2 | `go-htmx` | Go web app with templ and HTMX | P1 | The only server-rendered web product in Go. templ is 10.6k stars and 7.6k importers, htmx 49.6k stars. Distinct deliverable: HTML pages and forms, not JSON |
| 3 | `go-tui` | Go terminal UI with Bubble Tea | P1 | Bubble Tea is 45.6k stars and 15k importers. A full-screen interactive program is a different product from a cobra CLI, with a test model (Update/View, golden frames) the agent doesn't know by default |
| 4 | `go-gin` | Go API with Gin | P2 | Gin is the most-used Go web framework by a wide margin (48% of Go devs in JetBrains 2025, 191k importers). Same product as `go-api` but asked for by name. See the "variant" caveat below |
| 5 | `go-mcp` | Go MCP server | P2 | Official Go MCP SDK is v1 and stable. Stdio server, no Docker, no network. Directly on the product's audience (developers working with agents) |
| 6 | `go-operator` | Kubernetes operator in Go | P2 | controller-runtime has 26k importers. "Cloud infrastructure tooling" is a new >1/3 category in the 2025 Go survey. Envtest makes it verifiable without a cluster, but setup is the heaviest of the set |
| 7 | `go-library` | Go library module | P2 (lowest) | A reusable module with no `main` is a distinct deliverable (public API, Example tests, godoc). Cheap to maintain. Weakest popularity evidence because nobody surveys it as a framework |

With these, Go goes from 2 to 9 stacks. If the maintainers want 6 total instead of 9, ship ranks 1 to 4. A Postgres capability (sqlc + pgx + goose) is proposed as a **fragment**, not a stack (see "Rejected" and "Fragment work").

## Evidence

Sources consulted (access dates 2026-10-31):

- [Go Developer Survey 2025 results](https://go.dev/blog/survey2025) (published 2026-01-21, 5,379 respondents): CLIs and API services remain the top two use cases, unchanged from 2024; 55% build both; "cloud infrastructure tooling" (new option) over one third; ML models, tools or agents 11%; Linux/containers 96% of deployments; macOS 60% as a development platform. 26% find it hard to identify trustworthy third-party modules. No framework breakdown.
- [Go Developer Survey 2024 H2](https://go.dev/blog/survey2024-h2-results): API/RPC services 75%, command-line tools 62%; AWS EKS 41% and GKE 29% of cloud services used (Kubernetes is the deploy target for a large share).
- [JetBrains, The Go Ecosystem in 2025](https://blog.jetbrains.com/go/2025/11/10/go-language-trends-ecosystem-2025/) and [JetBrains, Popular Go Web Frameworks (2026-04-28)](https://blog.jetbrains.com/go/2026/04/28/popular-golang-web-frameworks/): Gin 48% (up from 41% in 2020), Gorilla 17%, Echo 16%, chi ~12%, Fiber 11%, net/http ~32% and flat; pgx described as the first-class Postgres choice. (Pages returned 403 to direct fetch; figures are from search-result excerpts of those pages, so recheck before quoting them externally.)
- GitHub stars and last push, via `gh api repos/<repo>` on 2026-10-31.
- pkg.go.dev "Imported by" counts, fetched from each package page on 2026-10-31. Importer counts include forks and vendored copies and inflate for modules that Kubernetes and cloud SDKs pull in transitively (grpc, controller-runtime), so treat them as order-of-magnitude.

| Project | Stars | pkg.go.dev importers | Latest release seen |
| --- | --- | --- | --- |
| gin-gonic/gin | 89,459 | 191,418 | active |
| spf13/cobra (go-cli, for scale) | 44,733 | 195,884 | |
| google.golang.org/grpc | 23,097 | 270,134 | |
| connectrpc.com/connect | 4,136 | 6,964 (v1 path) | v2.0.2, 2026-10-21 (v2 stable, new `/v2` path) |
| bufbuild/buf | 11,512 | n/a (tool) | |
| gorm.io/gorm | 39,987 | 86,926 | |
| labstack/echo | 32,787 | 32,160 (v4) / 1,564 (v5) | v5.4.4 |
| gofiber/fiber | 40,238 | 30,850 (v2) / 1,480 (v3) | v3.6.1 |
| sigs.k8s.io/controller-runtime | 2,982 | 26,454 | |
| kubebuilder | 9,358 | n/a (tool) | v4.16.0, 2026-09-10 |
| go-chi/chi | 23,034 | 17,309 | |
| charmbracelet/bubbletea | 45,574 | 14,989 (v1 path) / 961 (`charm.land/bubbletea/v2`) | v2.1.1, 2026-10-28 |
| jackc/pgx | 14,370 | 12,050 (v5) | |
| a-h/templ | 10,594 | 7,591 | v0.3.1100, 2026-10-26 |
| bigskysoftware/htmx | 49,575 | n/a (JS) | |
| 99designs/gqlgen | 10,773 | 5,624 | v0.17.98 |
| golang-migrate/migrate | 18,998 | 5,219 | |
| sqlc-dev/sqlc | 18,428 | n/a (tool) | v1.31.1, 2026-04-22 |
| hibiken/asynq (Redis) | 13,807 | 2,309 | |
| mark3labs/mcp-go | 9,210 | 1,880 | |
| modelcontextprotocol/go-sdk | 5,291 | 1,443 | v1.8.0, 2026-09-14 |
| pressly/goose | 11,644 | 1,725 | |
| testcontainers-go | 5,019 | 1,755 | |
| danielgtaylor/huma | 4,508 | 854 | |
| wailsapp/wails | 36,868 | 571 (v2) | v3.0.0 GA 2026-10-26 (5 days old) |
| riverqueue/river | 5,844 | 269 | v0.50.0 |

Local toolchain: `go1.27.1` installed, `go1.27.3` current per go.dev.

## Cross-cutting decisions for every new Go stack

These follow from reading `go-cli`, `go-api`, the anatomy reference and the code; each new stack should copy them rather than reinvent them.

1. **Copy `go-api`'s skeleton.** `internal/config`, `internal/errors` (one code-to-status/exit table), `internal/log` (slog passed down, never `SetDefault`), thin `main` with `run() error`, the same `Makefile` target names (install, build, vet, lint, lint-fix, fmt, fmt-check, test, test-integration, coverage, vuln, ci, clean), the same `.golangci.yml` linter set, `tests/integration` with `//go:build integration` and a guard against an empty suite, `.golangci-lint-version`, `-race` everywhere. Same module-path decision text. Agents trained on one Go stack then read the others for free.
2. **Generators as `go tool` deps.** Go 1.24+ tracks tools in go.mod (`go get -tool <pkg>`), so the version is the agent's (resolved at setup) and nothing in `files/` pins one. Every stack with codegen ships a `generate` target and a `generate-check` verify step (`layer: check`) that regenerates and fails on `git diff --exit-code` over the generated tree (or a temp-dir compare, since a fresh scaffold may not have a commit yet; see gotchas). Generated code is committed, excluded from lint by `exclusions.generated: strict`, and never hand-edited (an agent-ops hook can deny Edit/Write on the generated paths).
3. **`deps` names drop the major suffix.** `core/deps.ts::goEntry` strips a trailing `/vN` before matching the allowlist, so the allowlist and `deps` must say `connectrpc.com/connect`, `charm.land/bubbletea`, `github.com/labstack/echo`, not the `/v2` paths. The body says which major path to import. Side finding: `go-cli` declares `go.yaml.in/yaml/v3` and `registry/allowlist.json` lists it with the suffix, so it never matches a go.mod line after stripping. Worth a one-line fix in a separate change.
4. **Tags.** Every stack: `go`, `make`, plus the product tag. Tag `api` only on stacks whose deliverable is a JSON/HTTP API, because `rest-api` admits on `api` and the anatomy requires a serve step for `api`/`web`.
5. **Fragments that need touching** (detail in "Fragment work"): `agent-ops`'s `stack=astro-blog,go-cli,...` branch list, `docker-deploy`'s `applies_to` id list (its body already has a `tag=go` branch), `goreleaser`'s `applies_to` and its `main.go`-at-root assumption.

---

## 1. `go-grpc` (P1)

- **Name:** Go gRPC service (Connect)
- **Description:** A Go RPC service defined in Protocol Buffers, served with Connect over net/http so one handler answers gRPC, gRPC-Web and JSON, with buf for lint, breaking-change checks and code generation, health checks, and tests through a real client.
- **Why distinct:** the contract is a `.proto` schema and generated code, not hand-written JSON handlers. Different toolchain (buf, protoc plugins), different error model (Connect/gRPC codes, not HTTP statuses), different tests (generated client against `httptest`), different review rules (field numbering, breaking changes). `go-api` has none of that.
- **Evidence:** API/RPC services 75% of Go developers ([survey 2024 H2](https://go.dev/blog/survey2024-h2-results)); grpc-go 23k stars and 270k importers; connect-go 4.1k stars, 7k importers, v2 stable as of 2026-10; buf 11.5k stars.
- **Decision to put to the user:** "RPC library: connect-go (default; standard net/http handlers, serves gRPC, gRPC-Web and Connect JSON, testable with httptest), or grpc-go when the user needs grpc-go's interceptors, xDS or an existing grpc-go codebase." The id says gRPC because that is what people ask for; Connect serves real gRPC, so the id doesn't over-promise. Rejected alternative: a separate `go-connect` id (nobody types it).
- **Modules:**
  - runtime: `connectrpc.com/connect`, `google.golang.org/protobuf`, `connectrpc.com/grpchealth`, `connectrpc.com/grpcreflect`, `golang.org/x/net` (h2c for cleartext HTTP/2; check whether the installed Go's `http.Server.Protocols` with unencrypted HTTP/2 makes it unnecessary, and drop it if so)
  - test: `github.com/stretchr/testify`
  - tool (`go tool`): `github.com/bufbuild/buf/cmd/buf`, `google.golang.org/protobuf/cmd/protoc-gen-go`, `connectrpc.com/connect/cmd/protoc-gen-connect-go`
- **Tools on PATH:** go, make, git, golangci-lint.
- **Lint/format/vet/test:** golangci-lint (go-api config), gofmt/goimports, `go vet -tags integration`, `buf lint`, `buf format -d --exit-code`, `buf breaking` (CI only, see gotchas), `go test -race`.
- **Proving slice:** `proto/<slug>/v1/notes.proto` (a `NoteService` with `CreateNote`, `GetNote`, `ListNotes` with page token), `buf.yaml` (STANDARD lint, FILE breaking), `buf.gen.yaml` with **local** plugins run through `go tool` (no BSR remote plugins, so generation is offline and needs no account), committed `gen/` tree, `cmd/server/main.go`, `internal/notes` (store behind an interface, validation), `internal/rpc` (the handler: domain errors mapped to Connect codes in one table, `connect.NewError` with safe messages, details only for validation), interceptors for request id, access log and panic recovery, `grpchealth` and `grpcreflect` mounted on the same mux, `/healthz` plain GET for the serve probe. **The payload:** `CreateNote` then `GetNote` through the generated Connect client in a test, and the same call over the gRPC protocol (`connect.WithGRPC()`) in the integration test against the built binary, proving one handler serves both protocols.
- **Verify steps:**
  - `install` (setup): `make install` (go mod download, `go tool` resolves)
  - `generate-check` (check): `make generate-check`, buf generate into a temp dir and diff against `gen/`
  - `buf-lint` (lint): `make buf-lint` (`buf lint` and `buf format --exit-code`)
  - `fmt-check`, `vet`, `lint`, `build`, `test`, `test-integration` as go-api
  - `api` (serve): `make serve`, expect `http://127.0.0.1:${PORT}/healthz`
  - `readme-filled`
- **Agent-ops worth shipping:** a `.claude/rules/proto.md` scoped to `proto/**` (never renumber or reuse a field number, `reserved` for removed fields, add rather than change, run `make generate` after every edit, `buf breaking` before merge); a PreToolUse hook (or agent-ops-style guard) that denies Edit/Write under `gen/`; settings allow `make generate`, `make buf-lint`, `go tool buf lint`.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `docker-deploy` (add id; its `tag=go` branch fits, health via the shipped `-healthcheck` flag like go-api), `rr`, `ce-plugin`, future `go-postgres`, future `opentelemetry-go`. **Not** `rest-api`: its rules are REST resource naming and would contradict RPC method naming. Don't tag `api` unless the maintainers accept rest-api showing as an option; use tags `[go, api, grpc, protobuf, make]` only if `rest-api`'s applies_to moves from the `api` tag to a `rest` tag, otherwise `[go, rpc, grpc, protobuf, make]` and keep the serve step anyway (allowed, just not required).
- **Gotchas:**
  - Connect v2 moved to `connectrpc.com/connect/v2`; generated code from a v1 plugin won't compile against v2. The plugin and runtime must come from the same major. Tell the agent to read the installed plugin's output package names rather than trusting older tutorials.
  - Plain `http.ListenAndServe` doesn't speak cleartext HTTP/2, so gRPC (not Connect JSON) clients fail against a local server. Use the stdlib unencrypted-HTTP/2 protocol setting or h2c; the integration test with `WithGRPC()` catches it.
  - `buf breaking --against '.git#branch=main'` fails on a fresh repo with no commits. Keep it out of verify, put it in CI against the PR base.
  - Remote BSR plugins work without an account but need the network and are rate-limited; local `go tool` plugins avoid both.
  - `buf.yaml` v2 vs v1 config formats; `buf config migrate` converts.

## 2. `go-htmx` (P1)

- **Name:** Go web app with templ and HTMX
- **Description:** A server-rendered Go web app with type-checked templ components, HTMX for partial page updates without a JavaScript build, standard-library routing, form validation with inline errors, and tests that assert the rendered HTML.
- **Why distinct:** the deliverable is HTML pages and forms in a browser, not JSON. Different error model (re-render the form with field errors and 422, error pages, `HX-*` response headers), different tests (parse HTML), a codegen step (templ), static assets and CSRF. Neither go-cli nor go-api covers any of that, and there is no server-rendered web stack outside JS/Python in the registry.
- **Evidence:** templ 10.6k stars and 7.6k importers with releases every few weeks; htmx 49.6k stars. The "GOTH" (Go + templ + HTMX) pattern is the common way Go developers ship UI without a JS toolchain. No survey asks about it, so this rests on stars and importers.
- **Id note:** `go-htmx` is what people type ("go htmx"). `go-templ` is a reasonable alternative; `go-web` is too vague. Name carries both.
- **Modules:**
  - runtime: `github.com/a-h/templ`
  - test: `github.com/stretchr/testify`, `github.com/PuerkitoBio/goquery` (HTML assertions)
  - tool: `github.com/a-h/templ/cmd/templ` via `go tool`
  - Optional decision: Tailwind via the standalone CLI binary (no Node). Default off: plain CSS in `static/`, to keep the stack Node-free.
- **HTMX asset:** htmx is a JS file, not a Go module. Shipping `htmx.min.js` in `files/` would freeze a version. Setup step: download the current htmx release into `static/vendor/` (plain HTTPS from the official CDN, no credentials) and commit it; a verify `check` step asserts the file exists and is non-empty, and an integration test asserts the page references it and the server serves it with the right content type and cache headers. Record the htmx version in AGENTS.md.
- **Lint/format/vet/test:** golangci-lint, gofmt/goimports, `templ fmt` (check mode), `go vet`, `go test -race`.
- **Proving slice:** `cmd/server/main.go`, `internal/web` (handlers, middleware: request id, access log, recovery, CSRF via the stdlib `http.CrossOriginProtection` if the installed Go has it, else a small double-submit token), `internal/views/*.templ` (layout, notes page, note form partial, error page), committed `*_templ.go`, `static/` embedded with `embed.FS`, `internal/notes` store. **The payload:** a notes page whose form posts with `hx-post`; a valid post returns only the list-item fragment (`HX-Request` present) or redirects (full POST without JS); an invalid post returns 422 with the form re-rendered and field errors. Tests assert both paths with goquery.
- **Verify steps:** `install`, `generate-check` (`templ generate` then diff), `templ-fmt` (lint, `templ fmt -fail` or equivalent check flag), `fmt-check`, `vet`, `lint`, `build`, `test`, `test-integration` (built binary, GET page, POST form both ways, static asset), `htmx-vendored` (check), `web` (serve, expect `http://127.0.0.1:${PORT}/healthz` or `/`), `readme-filled`. Tag `web` so the serve step is required.
- **Agent-ops:** rule for `**/*.templ` (edit `.templ` never `_templ.go`, run `make generate`, components take typed params and never call the store); hook denying edits to `*_templ.go`; a rule that every HTMX endpoint also works as a full-page request (progressive enhancement), because agents tend to build fragment-only endpoints.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `docker-deploy` (add id), `rr`, `ce-plugin`, future `go-postgres`. Not `rest-api`. `posthog` only if it gains a server-rendered branch (it's client-side today and lists stacks by id; skip).
- **Gotchas:**
  - Forgetting `templ generate` after editing a `.templ` file compiles the old component silently. The generate-check step and a lint-on-write hook that runs `templ generate` catch it.
  - `templ` CLI and the `github.com/a-h/templ` runtime must match versions; `go tool` from the same go.mod keeps them together, a global `go install templ@latest` doesn't.
  - htmx swaps ignore 4xx/5xx responses by default, so a 422 form re-render doesn't appear. Configure response handling (htmx's `responseHandling` config or `htmx:beforeSwap`) and test that the error fragment is swapped.
  - Redirects after an HTMX POST need `HX-Redirect`, not a 303; a 303 makes htmx swap the redirected page into the target.
  - Without a browser test, JS-side behavior is unproven. Default: HTML-level tests only. Optional decision: a chromedp test when Chrome is installed, skipped otherwise. Don't pull in Node for Playwright.

## 3. `go-tui` (P1)

- **Name:** Go terminal UI with Bubble Tea
- **Description:** A full-screen interactive terminal app in Go on Bubble Tea, with Bubbles components and Lip Gloss styling, an Elm-style model tested by sending messages and comparing rendered frames, a non-interactive fallback, and a single static binary.
- **Why distinct:** go-cli runs a command and exits; a TUI holds the terminal, owns a render loop and keyboard input, and is tested as a state machine. Different architecture (Model/Update/View, commands for I/O), different tests (message-driven, golden frames, teatest), different failure modes (alt-screen left on, blocking I/O in Update).
- **Evidence:** bubbletea 45.6k stars, 15k importers on v1; lipgloss 12k; huh 7.2k. v2 (`charm.land/bubbletea/v2`) released and at v2.1.1 on 2026-10-28.
- **Modules:**
  - runtime: `charm.land/bubbletea`, `charm.land/bubbles`, `charm.land/lipgloss` (the v2 vanity paths; all three must be the same major line)
  - test: `github.com/stretchr/testify`, `github.com/charmbracelet/x/exp/teatest` (v2 subpath exists for Bubble Tea v2)
  - Flags: stdlib `flag` (no cobra; if the user wants subcommands, that's go-cli plus a TUI command)
- **Lint/format/vet/test:** go-api's set; golden files under `testdata/`, with an `-update` flag.
- **Proving slice:** `main.go` (`--version`, `--help`, `--no-tui`/non-TTY fallback that prints the same data as plain text or `--json`), `internal/ui` (root model, a list view with filtering from bubbles `list`, a detail view, key map with help view), `internal/data` (the loader, run as a `tea.Cmd`, never inside Update), `internal/theme` (lipgloss styles, `NO_COLOR` honored), `internal/config`, `internal/errors`, `internal/log` (log to a file, never the terminal, since stdout is the UI). **The payload:** a task list loaded asynchronously, filterable, selectable into a detail view; `q` quits cleanly. Unit tests drive `Update` with key messages and assert state; a teatest test runs the program headless at a fixed size and compares the final frame to a golden file.
- **Verify steps:** `install`, `fmt-check`, `vet`, `lint`, `build`, `test`, `test-integration` (build binary, run `--version`, `--help` and the non-TTY path through a pipe, assert exit codes and output), `smoke` (`make smoke`), `readme-filled`. No serve step.
- **Agent-ops:** rule for `internal/ui/**` (no I/O in Update or View, return a `tea.Cmd`; View is pure; every new key binding goes in the key map and help; update golden files only deliberately with `make golden`, and review the diff); a hook or settings note that the agent must never run the binary interactively in its shell (it hangs the session), only through tests or with stdin not a TTY.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `goreleaser` (widen applies_to; see Fragment work), `rr`, `ce-plugin`.
- **Gotchas:**
  - Agents run the TUI in their own shell and hang. The non-TTY fallback plus the rule above is the fix; the integration test must run the binary with stdin from `/dev/null`.
  - Golden frames depend on terminal size, color profile and `TERM`. Pin size in the test, force the ASCII/no-color profile (lipgloss renderer setting) and set `TERM`/`NO_COLOR` in the test env, or CI and macOS disagree.
  - Mixing v1 (`github.com/charmbracelet/...`) and v2 (`charm.land/...`) imports compiles in confusing ways or not at all; most tutorials and agent training data are v1. Tell the agent to check the installed module paths.
  - Logging to stdout corrupts the screen. `tea.LogToFile` or slog to a file under the state dir.
  - teatest is in `x/exp` (experimental, API may change); keep the golden test small so a teatest change is a small fix.

## 4. `go-gin` (P2)

- **Name:** Go API with Gin
- **Description:** A Go JSON API on the Gin framework with route groups, binding and validation through Gin's validator, one error envelope from a recovery and error middleware, structured slog request logs, graceful shutdown, and tests through httptest and the built binary.
- **Why distinct, and the honest caveat:** this is the same product as `go-api` (a JSON API), on a different framework. It fails the strict "not a variant" test. It's here because Gin is what a large share of Go developers will literally ask for ("a Go API with Gin"), and `go-api`'s router decision tells the agent to add a third-party router only on request, which leaves the agent improvising Gin's binding, validation and error flow, which differ enough from net/http (context type, `c.Error`, `ShouldBind`, abort semantics, validator tags) that the conventions don't transfer. The registry already treats framework choice as a stack boundary (nextjs, sveltekit, react-router for one product). If the maintainers hold the strict line, drop this and keep the other six.
- **Evidence:** 48% of Go developers use Gin ([JetBrains 2025/2026](https://blog.jetbrains.com/go/2026/04/28/popular-golang-web-frameworks/)); 89.5k stars; 191k importers (the most of any Go web module, about 6x Echo); Go's own [web service tutorial](https://go.dev/doc/tutorial/web-service-gin) uses Gin. The earlier research (`plans/research/registry-expansion-stacks-2026-10-29.md`, "Deliberate deferrals") deferred Gin "until named-framework demand wins" and named the id `gin-api`.
- **Id:** `go-gin` (anatomy: main technology plus defining second technology; groups with the other `go-*`). `gin-api` is the alternative the earlier plan used; pick one before shipping since ids are permanent.
- **Modules:** runtime `github.com/gin-gonic/gin`, `github.com/go-playground/validator` (Gin's binding validator; declare it because custom validators import it directly); test `github.com/stretchr/testify`.
- **Proving slice:** mirror `go-api` file-for-file (`cmd/server`, `internal/config`, `internal/errors`, `internal/log`, `internal/notes`, `internal/httpapi` with Gin engine setup in one constructor, `gin.New()` not `gin.Default()`, slog access log and recovery middleware that render the shared envelope), so the two stacks can be diffed. Same notes payload and routes, same integration tests (signals, healthcheck flag).
- **Verify steps:** identical to `go-api`.
- **Agent-ops:** rules: handlers call `c.Error(err)` and return; one error middleware renders the envelope; never `c.JSON` an error directly; bind with `ShouldBind*` (never `Bind*`, which writes a 400 itself); `gin.SetMode` from config, never debug mode in tests.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`, `rest-api`; optional `docker-deploy`, `rr`, `ce-plugin`, future `go-postgres`.
- **Gotchas:** `gin.Default()` adds its own logger and recovery (text to stdout, a different 500 body), duplicating the shipped middleware; Gin's debug-mode route banner pollutes logs; `c.Bind` aborts with a text 400 before your error middleware sees it; `c.Copy()` is required before using the context in a goroutine; Gin's trusted-proxies default warns at startup, set it explicitly from config.

## 5. `go-mcp` (P2)

- **Name:** Go MCP server
- **Description:** A Model Context Protocol server in Go on the official Go SDK, serving typed tools over stdio, with input schemas from Go structs, safe tool errors, logs kept off stdout, in-memory protocol tests and a test that drives the built binary as a real MCP client.
- **Why distinct:** a protocol server over stdio for an agent host, not an HTTP API or a human CLI. Its rules are specific: stdout belongs to JSON-RPC, tool errors are results not crashes, schemas come from types, the client is an LLM.
- **Evidence:** official SDK `github.com/modelcontextprotocol/go-sdk` 5.3k stars, 1.4k importers, v1.8.0 2026-09 and stable; community `mark3labs/mcp-go` 9.2k stars, 1.9k importers. Go survey 2025: 11% build ML models, tools or agents. Fits the product's core audience. The earlier research listed `mcp-typescript` as P3; a Go one is cheaper to prove (single static binary, no Node packaging).
- **Decision:** "SDK: the official `modelcontextprotocol/go-sdk` (default), or mark3labs/mcp-go if the user asks." "Transport: stdio (default); streamable HTTP only when asked, then add a serve step."
- **Modules:** runtime `github.com/modelcontextprotocol/go-sdk`; test `github.com/stretchr/testify`.
- **Proving slice:** `main.go` (`--version`, stdio by default), `internal/server` (builds the `mcp.Server`, registers tools), `internal/tools` (one deterministic local tool, for example a notes or unit-conversion tool with typed input/output structs; domain errors become tool error results, never protocol errors or panics), `internal/log` (slog to stderr or a file). **The payload:** `tools/list` then `tools/call` on the tool, valid and invalid input. Unit tests through the SDK's in-memory transports; an integration test starts the built binary with the SDK's command transport, initializes, lists, calls, and asserts the binary wrote nothing but protocol frames on stdout and exited cleanly when stdin closed.
- **Verify steps:** `install`, `fmt-check`, `vet`, `lint`, `build`, `test`, `test-integration`, `smoke` (`--version`, and `make inspect-check` if useful: a scripted list over stdio), `readme-filled`. No serve step for stdio.
- **Agent-ops:** rule: no `fmt.Print*` or `log` to stdout anywhere (a golangci `forbidigo` rule enforces it; ship it in `.golangci.yml`); tool descriptions are prompts for another model, so write them as instructions with examples; every tool gets a list/call test. A project skill for "add an MCP tool" (struct, register, test) is a good fit here.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `goreleaser` (widen), `rr`, `ce-plugin`.
- **Gotchas:** anything on stdout corrupts the stream and the client disconnects with an unhelpful error; the SDK API moved between pre-1.0 releases and most examples online are mark3labs or pre-1.0, so read the installed package docs; JSON schema inference from struct tags (`jsonschema:"..."`) needs descriptions on fields or the model guesses; stdio servers must exit when stdin closes or hosts leak processes.

## 6. `go-operator` (P2)

- **Name:** Kubernetes operator in Go
- **Description:** A Kubernetes operator in Go on controller-runtime, with one custom resource whose types generate CRDs, RBAC and deep-copy code through controller-gen, an idempotent reconciler with status conditions, and tests against a real API server through envtest, no cluster needed.
- **Why distinct:** the deliverable is a controller reconciling cluster state, not a request handler. Different code generation (CRD manifests, RBAC from markers), a different test harness (envtest runs real etcd and kube-apiserver binaries), and a different correctness model (idempotent, level-triggered reconcile, owner references, finalizers, conditions).
- **Evidence:** controller-runtime 26k importers; kubebuilder 9.4k stars, operator-sdk 7.7k (built on kubebuilder); EKS 41% and GKE 29% among cloud services Go devs use ([survey 2024 H2](https://go.dev/blog/survey2024-h2-results)); cloud infrastructure tooling over a third ([survey 2025](https://go.dev/blog/survey2025)).
- **Generator question:** kubebuilder's `init`/`create api` scaffolds a large tree (kustomize config, Dockerfile, e2e harness). The product rule is "ship files, use a generator only for what can't ship." Everything here can ship as files, so default to shipped files in kubebuilder's layout (including a `PROJECT` file so `kubebuilder create api` still works later) and no kubebuilder CLI in verify. Decision: "Scaffolding: shipped files in kubebuilder layout (default); run `kubebuilder` only for later APIs, non-interactively, merged without overwriting."
- **Modules:**
  - runtime: `sigs.k8s.io/controller-runtime`, `k8s.io/apimachinery`, `k8s.io/client-go`, `k8s.io/api`
  - test: `github.com/stretchr/testify` (kubebuilder's default is Ginkgo/Gomega; offer them as the decision's alternative, but keep testify for consistency with the other Go stacks)
  - tool (`go tool`): `sigs.k8s.io/controller-tools/cmd/controller-gen`, `sigs.k8s.io/controller-runtime/tools/setup-envtest`, `sigs.k8s.io/kustomize/kustomize` (for `make manifests` build check)
- **Tools on PATH:** go, make, git, golangci-lint. Optional: docker and kind for an opt-in e2e (not in verify).
- **Proving slice:** `api/v1alpha1/<kind>_types.go` with kubebuilder markers (spec, status with `metav1.Condition`s), committed `zz_generated.deepcopy.go`, `config/crd`, `config/rbac` (generated), `config/manager`, `config/default` kustomizations, `cmd/main.go` (manager, health/ready probes, metrics bound to localhost, leader election flag), `internal/controller` reconciler. **The payload:** a `Greeting` (or similar) resource that makes the controller create an owned ConfigMap, update it on spec change, set a `Ready` condition, and get garbage-collected via owner reference. Envtest integration tests create the CR and use `Eventually`-style polling helpers to assert the ConfigMap and condition.
- **Verify steps:** `install` (setup; includes `setup-envtest use` to download binaries into a project-local `bin/`), `generate-check` (controller-gen object + manifests, diff), `manifests-build` (check; `kustomize build config/default` succeeds), `fmt-check`, `vet`, `lint`, `build`, `test` (unit, no envtest), `test-integration` (envtest, with `KUBEBUILDER_ASSETS` from setup-envtest), `readme-filled`. Longer timeouts on install and test-integration (first download is ~100 MB).
- **Agent-ops:** rules for `internal/controller/**` (reconcile is idempotent and returns errors to requeue, never sleeps; status updates via the status subresource; every created object gets an owner reference; RBAC only via `+kubebuilder:rbac` markers then `make manifests`); `api/**` (bump version for breaking schema changes, CEL validation markers over webhook where possible); hook denying edits to `zz_generated*` and `config/crd/bases`, `config/rbac/role.yaml`.
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `docker-deploy` (needs a Go branch adjustment: the operator image has no HTTP healthcheck in Docker terms; probes are Kubernetes'), `rr`, `ce-plugin`.
- **Gotchas:** envtest has no controllers (no garbage collection, no namespace deletion), so owner-reference GC can't be asserted in envtest, only that the reference is set; setup-envtest downloads need network on first run (no credentials) and the Kubernetes version must match the `k8s.io/*` minor; `k8s.io/*` module minors must move together with controller-runtime's supported minor or the build breaks; controller-gen versions change marker output, so run it from `go tool` not a global binary; agents often write status with `Update` instead of `Status().Update` and loop on conflicts.
- **Why P2 not P1:** heaviest setup and biggest brief of the set, smallest audience, and a long `k8s.io` dependency graph that slows `go mod tidy` and every first build.

## 7. `go-library` (P2, lowest)

- **Name:** Go library module
- **Description:** A reusable Go module with no binary: a small exported API with doc comments, runnable Example tests that appear in godoc, table and fuzz tests, an API-compatibility check before release, and lint and vulnerability checks.
- **Why distinct:** no `main`, no config, no logging setup; the contract is the exported API and its documentation. Tests include `Example` functions (doc and test at once) and fuzz targets; release discipline is semver and API compatibility. Different from go-cli in every shipped file except the Makefile and lint config.
- **Evidence:** indirect. Libraries appear in the survey's use-case chart but without a quoted figure, and 26% of respondents struggle to find trustworthy modules ([survey 2025](https://go.dev/blog/survey2025)), which is the demand side for well-tested libraries. The earlier research placed `typescript-library` and `python-library` in Batch 4; this is the Go equivalent and the cheapest stack on this list to maintain.
- **Modules:** runtime none (stdlib only); test `github.com/stretchr/testify` optional (decision: stdlib `testing` only by default, so the library adds no test dependency to consumers' go.sum; testify if the user wants consistency); tool `golang.org/x/exp/cmd/gorelease` (API compatibility and suggested version; experimental) or `golang.org/x/exp/cmd/apidiff`.
- **Proving slice:** root package `<slug>` with one small, real API (for example a slug or duration parser with options), `doc.go`, `example_test.go`, table tests, `FuzzParse` with a seed corpus, `internal/` for helpers, `README.md` with usage. **The payload:** `ExampleParse` whose `// Output:` comment is checked by `go test`.
- **Verify steps:** `install`, `fmt-check`, `vet`, `lint`, `test` (race, includes examples), `fuzz-smoke` (test layer: `go test -run=^$ -fuzz=FuzzParse -fuzztime=10s`), `doc-check` (check: every exported identifier has a doc comment, via revive's `exported` rule enabled for this stack), `api-check` (check; `gorelease` against the latest tag, skipped with a message when there is no tag yet), `readme-filled`. No build step beyond `go build ./...` inside vet.
- **Agent-ops:** rule: never break exported API without a major-version path change; exported identifiers need doc comments with an Example for each entry point; no global state or `init()`; no logging from library code (return errors; accept an optional `*slog.Logger` only if the user asks).
- **Fragments:** default `agent-ops`, `git-hooks`, `ci-github`; optional `rr`, `ce-plugin`. Not goreleaser or docker-deploy.
- **Gotchas:** `go test` runs examples only when they have an `// Output:` comment; fuzz in CI must be time-bounded; `gorelease` needs a base version and fails confusingly on an untagged repo; consumers can't import `internal/`.

---

## Rejected candidates

| Candidate | Why not a stack |
| --- | --- |
| **Go API with Postgres (sqlc + pgx + goose/migrate)** | A database is a capability, not a product. The registry's settled pattern is one database fragment per host family (`postgres` for FastAPI, `drizzle-postgres` for Next/SvelteKit, `effect-sql-postgres` for Effect; plans/registry-expansion.md Batch 1: "gives each host family one proven database owner"). `github.com/jackc/pgx` and `github.com/pressly/goose` already sit in `registry/allowlist.json` and `deps/go.json` with no entry using them, which points to a planned Go fragment. Propose `go-postgres` as a fragment instead (below). |
| **Echo, Fiber, chi API** | Variants of the same product. chi is net/http-compatible, so `go-api`'s router decision covers it. Echo (16%) and Fiber (11%) are a third of Gin's usage and a sixth of its importers; one named-framework stack (Gin) is enough until requests show otherwise. Fiber also isn't net/http-compatible (fasthttp), which would fork every Go fragment's guidance. |
| **Background worker / queue consumer (River)** | River is 5.8k stars but only 269 importers; asynq needs Redis. A job queue nearly always lives inside an API process, so it's a fragment (`go-river`, requiring `go-postgres`, applies to `go-api`/`go-gin`/`go-grpc`/`go-htmx`), not a standalone product. River also has a SQLite driver now ([v0.40+ changelog](https://raw.githubusercontent.com/riverqueue/river/v0.45.0/CHANGELOG.md)), but the Postgres driver is the documented default. |
| **GraphQL API (gqlgen)** | Credible (10.8k stars, 5.6k importers, schema-first codegen fits the `go tool` pattern) and would make a fine eighth stack. Ranked out because it is a fourth API-shaped stack after go-api, go-grpc and go-gin, and GraphQL adoption in new Go services is flat to declining by every signal I found. Revisit on demand; outline would mirror go-grpc (schema in `graph/schema.graphqls`, `gqlgen generate` check, resolver tests through the handler, playground disabled outside dev). |
| **Wails desktop app** | v3 went GA on 2026-10-26, five days ago, and v2 has only 571 importers. It also needs a Node frontend toolchain and platform webviews, and `tauri-react` already covers "desktop app with a web UI." Revisit once v3 has a few months of releases. |
| **Fyne GUI** | 28.8k stars, but native GUI testing and packaging on macOS needs cgo and platform SDK setup for every target, and demand for Go GUIs is small. |
| **Temporal workflow worker** | Needs a Temporal server (the dev server is a separate CLI, no account), niche audience, and `temporalio/sdk-go` is 1k stars. Fragment territory at most. |
| **Huma / oapi-codegen OpenAPI-first API** | Real but niche (huma 854 importers). OpenAPI generation can be a later fragment or decision on go-api/go-gin. |
| **gRPC with grpc-go as its own stack** | Folded into `go-grpc` as a decision. Two gRPC stacks would be variants. |

## Fragment work these stacks imply

- **New `go-postgres` fragment** (service): applies to `go-api`, `go-gin`, `go-grpc`, `go-htmx`. Deps: `github.com/jackc/pgx` (pgxpool), `github.com/pressly/goose` (library mode, migrations embedded with `embed.FS`, run by an explicit `make db-migrate`, never on start), optional `sqlc` via `go install` or `go tool` with a `generate-check` step. Follows the "Service lifecycle rule for Docker-backed fragments" (Compose dev/test services on `PORT_DB`/`PORT_DB_TEST`, run-owned test databases cloned from a migrated template, close pools before releasing locks). Gotcha to note: `github.com/sqlc-dev/sqlc` as a `go tool` dep pulls `pg_query_go`, which needs cgo and compiles C for a minute or more on first build; `go install` once into GOBIN is the lighter option.
- **`agent-ops`**: its `stack=astro-blog,go-cli,mobile-expo,python-react` branch (stack ships `.claude/settings.json` allow rules) should list each new stack that ships a Claude adapter. go-api isn't on it today either, though it ships one; worth checking whether that's an omission.
- **`docker-deploy`**: add `go-gin`, `go-grpc`, `go-htmx` to `applies_to`; its `tag=go` branch (CGO off, distroless nonroot) already fits. For `go-htmx`, the image must include embedded static assets (they are, via `embed`). `go-operator` needs its own branch or stays out.
- **`goreleaser`**: widen to `go-tui` and `go-mcp`. Its body assumes go-cli's `main.go` at the root with `main.version/commit/date` ldflags; ship both new stacks with the same root `main.go` and ldflags variables so the body works unchanged, or add `stack=` branches.
- **`rest-api`**: admits on the `api` tag. Decide how `go-grpc` tags itself (see that section).
- **`ci-github`, `git-hooks`**: their `tag=go` branches apply as-is; `ci-github` should also install `go tool` deps through `make install` and run `generate-check` for the codegen stacks (stack-body conditional blocks, as go-cli does).
- **Allowlist and dependency cards**: every new module name goes into `registry/allowlist.json` (`go`) without its `/vN` suffix, with a card in `registry/deps/go.json`, or `scripts/index/allowlist.ts` fails the build.

## Suggested delivery order

1. `go-grpc`, `go-htmx`, `go-tui` together with the `agent-ops`/`docker-deploy`/`goreleaser` applies_to edits and the allowlist additions.
2. `go-postgres` fragment (unblocks database work on four Go stacks at once), then `go-gin`.
3. `go-mcp`, `go-library`.
4. `go-operator` last: it needs the longest bench run and the most prose budget.

Each one should be prototyped from an empty directory against current releases and taken to a green `stacks verify` before its STACK.md is written, as the earlier research's "Authoring sequence" requires.
