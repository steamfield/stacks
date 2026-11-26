# Entry anatomy

The full entry format. `<cli> create` writes a skeleton with every key and section in place; this page says what goes in each one.

## Where an entry lives

`<cli> create stack <id>` writes into the user registry, `$XDG_CONFIG_HOME/stacks/` (default `~/.config/stacks/`):

```text
~/.config/stacks/
  stacks/<id>/STACK.md
  stacks/<id>/files/...
  stacks/<id>/adapters/<agent>/...
  fragments/<id>/FRAGMENT.md
  fragments/<id>/stacks/<stack-id>/...
  search/stacks/<id>.json
  search/fragments/<id>.json
```

User entries are trusted, so `<cli> new <id>` works on them right away. `create` refuses an id another root already has; copy an existing entry with `<cli> create stack <id> --from bundled` when you want to edit it instead.

## Frontmatter

YAML between the two `---` lines. Keys are snake_case, and an unknown key is an error, so `appliesTo` fails where `applies_to` passes.

```yaml
schema_version: 1
id: go-cli
kind: stack
name: Go CLI
description: A Go command-line tool with cobra commands, viper config, structured errors and golangci-lint.
tags: [go, cli, make]
deps:
  cli: [github.com/spf13/cobra, github.com/spf13/viper]
  test: [github.com/stretchr/testify]
tools: [go, make, git, golangci-lint]
decisions:
  - "Binary name: the project slug (default; the Makefile's BIN)."
  - "Coverage floor: 50% (default)."
env: {}
merge: [.claude/settings.json]
fragments:
  default: [git-hooks, ci-github]
  optional: [goreleaser]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: vet, layer: typecheck, run: make vet }
  - { name: test, layer: test, run: make test }
  - { name: smoke, layer: test, run: make smoke }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Download modules and install dev tools that are missing
  lint: Run golangci-lint
  vet: Type-check every package
  test: Unit tests
  smoke: Build and run the binary's --help and --version
---
```

| Key | What goes in it |
| --- | --- |
| `id` | Kebab-case, permanent once published. The main technology plus the kind of product (`go-cli`) or the defining second technology (`tauri-react`). No major versions, no internal abbreviations |
| `name` | The human title shown in lists. It can name both halves when the id can't |
| `description` | One or two sentences, about 40 words. Open with plain words for the kind of project and where it runs, then the two or three packages people search for by name. Search weights it heavily |
| `tags` | Compatibility labels fragments select on (`typescript`, `node`, `go`, `web`, `api`, `static`, ...). Exactly one task-runner tag: `make` or `scripts` |
| `deps` | Package names grouped by role. Names only, never versions |
| `tools` | Programs that must be on PATH. `new` warns when one is missing |
| `decisions` | Choices the building agent asks the user about. Each one says `(default: ...)` and what to do when the default can't apply |
| `env` | Default environment values verify uses, such as `PORT_WEB: "5173"` |
| `merge` | JSON files to deep-merge when several entries ship the same path (usually `.claude/settings.json`) |
| `fragments` | `required`, `default` and `optional` fragment ids (stacks only) |
| `verify` | The steps that define done (below) |
| `commands` | Every project command verify runs, with one line on what it does |

## Id, name and description

People and agents pick an entry mostly from these three. If they don't say what it is, nobody chooses it.

Test a candidate id before `create`:

- Name what a developer would type: `go-cli`, `typescript-api`, `tauri-react`.
- The second word must not suggest a product the stack doesn't build. `astro-api` reads as an API built with Astro, even if it means a static Astro site plus a separate API.
- When an existing entry shares the framework, the id or name says what separates them (the host, the runtime).
- Use the public name, never an internal abbreviation or a major version (`tauri-react`, not `tauri2-react`).
- Say it in a search box and run it: `<cli> search "<id words>" --local --json`.

Write the `description` for someone skimming a list:

- Open with plain words for the kind of project and its runtime: "A Go command-line tool with...", "A full-stack React Router app on Cloudflare Workers with...".
- Name the two or three packages people search for by name. The long tail belongs in `deps` and the body.
- About 40 words. No major versions and no internal jargon; every unusual word can match an unrelated search.
- Describe what ships. Don't claim a capability only an optional fragment adds, or "cross-platform" when one platform is left out.

## Verify steps

Verify steps check; they never generate source (no generate, `--write` or `--fix` in a verify step).

Each step has a `name` (kebab-case), a `run` command and optionally `phase`, `layer`, `cwd`, `tags`, `timeout` and `expect`.

- `phase`: `setup` (stops at the first failure), `check` (the default; every check runs), `serve` (started, probed, stopped) or `teardown` (always runs).
- `layer`: `install`, `lint`, `typecheck`, `test`, `build`, `serve`, `docs` or `check` (a file or config check). A stack's default composition must cover install, lint, typecheck and test, plus a serve step when tagged `web` or `api`.
- `timeout`: `500ms`, `90s`, `10m`. The default is `10m`.
- A serve step needs `expect`, a localhost URL that must answer below 500 within the time given. The command must stay in the foreground.

```yaml
  - name: dev
    phase: serve
    layer: serve
    run: make dev
    expect: { http: "http://localhost:${PORT_WEB}/", within: 60s }
```

Verify calls project commands (`make test`, `bun run test`), and every command it calls must be declared in `commands`. A `scripts` stack's install step runs the package manager (`bun install`) and declares no `install` command, because a `package.json` script named `install` recurses.

Go beyond install, lint, typecheck and test: add the step that proves the deliverable. A serve probe for anything that serves, a smoke command for a CLI, a build for anything that ships an artifact. Keep the README check from the skeleton; it fails while any `stacks:fill` marker remains.

## The body

Markdown after the frontmatter, copied into the brief under the entry's name. Use ATX headings (`## Layout`). A stack body uses these sections, combined or extended where the product needs it:

- **What stacks wrote**: one paragraph naming the shipped slice (entry point, modules, tests, configs, docs) and the payload that proves the wiring, ending with an instruction to read the code before extending it. The code is the reference for every convention; the body doesn't restate what it shows.
- **Layout**: where new code goes, beyond what the shipped tree already shows.
- **Setup**: numbered steps. Add the declared dependencies so they resolve to current releases, run the checks, and update any shipped file the installed release rejects (a renamed API, a dropped config key) without loosening a check. Record toolchain versions, then fill the README. Use a generator only for what can't ship as files (native project directories, a lockfile): tell the agent to read its current help, run it non-interactively into a subdirectory and merge the output without overwriting shipped files. Never freeze its flags.
- **Conventions**: the rules new code must keep, each already followed by the shipped code.
- **Testing**: the test layers the slice ships and what a new feature adds to each.
- **Commands**: the project commands, matching `commands`.
- **Gotchas**: the mistakes an agent actually makes with these tools.

A shipped config needs words only where an agent adapting it to a new release would drop a rule; say which rules to keep.

Spend words on what an agent would get wrong, not on what it does anyway. The body carries only what the agent can't learn from the shipped files or already knows: decisions, setup order, the rules new code must keep, and gotchas a real run paid for. Cut any sentence that restates the code, a config, the task runner or a shipped doc. Budgets: a stack body under 2,000 words, a fragment under 1,000, an app under 3,000, and the composed brief under 6,000 (9,000 with an app). A workspace's composed brief may reach 7,500 words, and the workspace body itself still aims for about 400. Move reference material into a shipped doc in `files/docs/` and link it from the body.

### Developer experience

A stack sets up a project an agent can work in without friction. Every stack provides:

- An aggregate command that runs every offline check CI runs: `ci` on a Makefile, `check` in `package.json` scripts. A tool's own check (`astro check`, `cargo check`) on a Makefile keeps its name, and `ci` is added. The audit stays out of it.
- A fix command: `format` applying the formatter and the linter's safe fixes, or a separate `lint-fix`.
- A dependency audit, `audit` (Go keeps `vuln`), with a tool that needs no account or key (govulncheck, cargo-deny, pip-audit, `bun audit` or `npm audit`, osv-scanner). It needs the network, so it isn't a verify step or part of the aggregate; CI runs it as its own step.
- For a `web` or `api` stack with a serve step, a background start, stop and status (`dev:bg`, `dev:stop`, `dev:status`, or `dev-bg`, `dev-stop`, `dev-status` on a Makefile). They behave the same in every stack:
  - Start runs the serve command in its own process group, writes output to `logs/dev.log`, and records the group and its start time (read with `LC_ALL=C ps -o lstart=`) in `logs/dev.pid`. It waits, on a wall-clock deadline, for the URL the serve step's `expect.http` probes, and stops its group if that never answers or the start is interrupted (exit 130).
  - Start reuses a recorded server only when it is healthy and on the requested (or default) host and port. A recorded server that is unhealthy or on another port fails at once, naming the stop command. A server it didn't record is never reused or signaled.
  - A record whose start time doesn't match is stale and is never signaled. Stop signals the recorded process group, never a wrapper's pid, waits for it to exit, and removes the record.
  - Status exits 0 when a recorded server is running and 1 otherwise.
  - A `dev-cycle` verify step in the `check` layer, timeout 3m, fails without starting anything when status finds a running server, and otherwise runs start then stop. The body tells agents to use these commands instead of killing processes.
  - On a Makefile the logic lives in `scripts/dev-bg.sh`. Everything below its `# --- shared body ---` line is byte-identical across stacks; above it, each stack sets its host and port variables, timeouts, `launch` and `healthy`.
- agent-ops, git-hooks and ci-github in the default composition.
- A concrete single-test command in Commands or Testing.
- A coverage command with a floor, for any stack with unit tests.
- Logs an agent can read from a file during development (`logs/dev.log`, or `--log-file` for a CLI or TUI that owns the terminal).
- A Setup step that records each toolchain version in the file its tools and CI read (`.node-version`, `.python-version`, `.java-version`, `go.mod`, `rust-toolchain.toml`).
- Agent permissions that allow every declared non-destructive command.
- `.env.example` and a config doc when the slice reads environment variables.
- A real code linter with its config shipped, not only a format check.

### Conditional prose

A block between standalone markers appears only when its condition holds. No nesting.

```md
<!-- stacks:when with=ci-github -->
CI reads the Go version from go.mod.
<!-- stacks:end -->
```

Conditions: `with=<fragment>`, `stack=<id>`, `tag=<tag>`, `tag!=<tag>`, `preset=default|sandbox`, `mode=new|add`. Use `preset=sandbox` for the local-only path (nothing deployed or released).

In add mode, matching `with=<added-fragment>` blocks from the host stack and already-applied fragments appear under that addition as notes from each recipe's current version. Other host prose stays out. Write notes about existing files conditionally, since older projects may differ.

Without a known recorded stack, add infers conditional tags from repository data: Makefile gives `make`; package.json gives `node` and an object `scripts` gives `scripts` unless Makefile exists; a Bun lockfile or `packageManager: bun@` gives `bun`; tsconfig.json, go.mod, pyproject.toml and Cargo.toml give `typescript`, `go`, `python` and `rust`. A `workspaces` field or manifests in two immediate child directories give `monorepo`. The brief prints these tags. They affect only conditionals, never `applies_to`, and are not recorded in the manifest.

## files/, adapters/ and stack overlays

A fragment may ship `stacks/<stack-id>/<path>` alongside `files/` and `adapters/`. Only that host stack gets `<path>`, including in add mode. Stack entries cannot have overlays. The stack must exist and fit the fragment's `applies_to` by id or tags (empty admits all). An overlay cannot duplicate a `files/` output path; use separate paths for separate hosts. An overlay may import its host stack's shipped files (a relative import of `src/errors.ts`, say); files under `files/` may import only the fragment's own files and its `requires` closure. Templates, merge rules and security checks apply to overlays too.

Conditional markers resolve only in entry bodies. Shipped files may hold `stacks:fill`, but `stacks:when` and `stacks:end` are errors there.

`files/` holds a working slice of the project: the entry point, a few modules that exercise config, errors, logging and output, their unit and integration tests, the lint, format, typecheck and test configs, the task runner (a Makefile or `package.json` scripts), docs, `.gitignore` and `.env.example`. Write it against a current release and make it pass every verify step from a fresh scaffold once dependencies are installed. Keep it small: one payload that proves the wiring, no product features.

Leave out everything that ages: dependency versions and ranges (a shipped `package.json` has scripts but no dependency blocks; the agent adds the declared `deps`), `packageManager`, `engines`, the `go` and `toolchain` directives, action refs, versioned `$schema` URLs and generator flags. `validate` warns on a version literal inside a shipped config. Every shipped file a tool reads must be exercised by a verify step (built, linted, typechecked, tested or run), so a file a release outdates fails verify instead of passing silently; docs and editor settings are exempt.

Store dotfiles under their real names (`files/.gitignore`). A file ending in `.tmpl` is rendered with only these variables: `{{project_name}}`, `{{project_slug}}`, `{{env_prefix}}`, `{{package_scope}}`, `{{author}}`, `{{year}}`. Everything else is copied byte for byte. Directory names can't be templated, so code that must live under a project-named directory, or import itself by module path, uses `{{project_slug}}` inside the files and a Setup step for any rename.

`adapters/<agent>/` holds files for one coding agent: `claude`, `codex`, `opencode` or `cursor`. Only targeted agents get them; every target gets `AGENTS.md`. Settings permissions and hook commands must name composed commands, and hook paths must exist in the composed files. List shared JSON files such as `.claude/settings.json` in `merge`.

Guidance every agent needs lives in `files/` (a doc under `docs/`), because only Claude loads `.claude/`. A path-scoped Claude rule (`.claude/rules/<id>/<name>.md` with `paths:` frontmatter) states its must-not-break constraints inline, in a few lines, and links to that doc for the reasons and examples: a rule that only says "read the doc" loads nothing an agent acts on. Never `@`-import the doc into a path-scoped rule; Claude Code loads an imported file at session start whatever the rule's `paths` say.

## Workspace stacks

A workspace stack mounts two existing stacks into one project. It is a stack with a `parts` list, each part `{ name, role, stack }`:

```yaml
parts:
  - { name: backend, role: api, stack: hono-api }
  - { name: frontend, role: web, stack: react-vite }
```

`name` is the part's kebab-case directory and the prefix on its steps, commands and dependency roles. `role` is `api` or `web`. A workspace has exactly one `api` part and one client part, and a part cannot have parts. The workspace's `fragments` tiers are the project's: restate every fragment a part requires in `required` (`validate` fails otherwise) and choose which of the parts' defaults to keep.

A part must meet its role's rules. `validate` checks the declared ones: an `api` part has `PORT_API` in `env` and a `serve` step probing `${PORT_API}` at a path ending `/healthz`, and for a link it writes `openapi.json` in its own directory with an `openapi-drift` step; a `web` part has `PORT_WEB` in `env`. The workspace's verify steps prove the rest: resources under `/v1` with the `notes` example (operation ids `listNotes`, `getNote`, `createNote`); a client that reaches the API through one configured base URL and one client module with a single request function, calls `notes` in a test, and reads only the status and `x-request-id` from a failure; and a web dev proxy that forwards `/api` to `PORT_API`, strips only `/api`, and exists only when `PORT_API` is set. Hooks find their tools by walking up from the edited file, since they run at the workspace root.

A fragment whose `applies_to` names exactly one part's stack is written into that part; any other fragment is written once at the root. Each harness's session-root adapter paths (`.claude/settings.json`, `.claude/hooks/`, `.codex/`, `.cursor/hooks.json`, `opencode.json` and the like) go to the root; the rest stays in the part.

The workspace ships the root Makefile (delegating to each part, running Biome inside each part, letting ports exported in the shell win over `.env`), `README.md`, `.env.example`, `AGENTS.md` with a `CLAUDE.md` that imports it, a short contract document a verify step checks, and a verify step that sends one request through the client to the API.

Its body is the seam only; anything about one half belongs in that half's stack. Keep it near 400 words, name every part directory, and use three required headings:

- `## How the parts connect`: the request path (base URL, proxy, prefix), which part owns the contract, and what crosses the boundary.
- `## Setup`: one order across both parts ending in `stacks verify`, naming the step that first generates the client and the checks that fail before it. Refer to a part's steps by what they do, never by number.
- `## Changing the API`: change a route, regenerate, update the client, commit the generated output, run both parts' tests.

Also state each part's CI and hook commands inside `with=ci-github` and `with=git-hooks` blocks (the parts' own blocks drop when mounted) and where settings come from. The full rules are in the authoring guide that `<cli> create` names.

## Checking your work

```sh
<cli> validate <entry-dir> --json
<cli> show <id> --kind stack
<cli> validate ~/.config/stacks --brief <id> --sandbox
<cli> validate ~/.config/stacks --brief <id> --with <fragment>
```

`show` prints every guidance branch and shipped path. `--brief` prints the composed brief an agent would get, without writing anything. Fix findings at their source: replace a pinned version with a discovery step, drop a version literal from a shipped config, repair an unknown reference or template variable. Read warnings as well as errors.
