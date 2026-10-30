# stacks

`stacks` starts projects for coding agents. You pick a stack (a recipe for one kind of project), stacks writes a few starter files and a build brief, your coding agent builds the project from the brief, and `stacks verify` runs the checks that define done. Browse the catalog at [stacks.steamfield.io](https://stacks.steamfield.io).

The CLI never generates code and never calls a model, and it never runs anything it reads from a stack. It composes text and files; `verify` runs only the steps in your project's own manifest. The only other programs it starts are `git init` for a new project, the coding agent you hand the project to, and npm when you run `stacks update`.

## Install

stacks needs Node 22 or newer, on macOS or Linux. The npm package is `@steamfield/stacks`; the command it installs is `stacks`.

```sh
npm install -g @steamfield/stacks@latest
stacks --version
```

Or skip the install and run it with `npx`, putting `npx @steamfield/stacks@latest` wherever these docs say `stacks`.

`stacks update` upgrades a global npm install, and `stacks update --check` only reports the installed and latest versions. For any other kind of install it prints the command to run instead.

## Quick start

```sh
stacks search "TypeScript command line tool"   # find a stack in plain words
stacks show typescript-cli                     # read the recipe before writing anything
stacks new typescript-cli my-cli --sandbox     # write the project and its brief
cd my-cli
# your coding agent reads .stacks/BRIEF.md and builds the project, then:
stacks verify --all
```

`new` writes the starter files, agent instructions (`AGENTS.md`, `CLAUDE.md`, `.claude/` for the default Claude Code target) and `.stacks/`, which holds the brief, a `NOTES.md` for the agent and the manifest of verify steps. It then runs `git init`. Add `--dry-run` to see the file list and brief size without writing anything.

`--sandbox` is the quick local experiment: every decision takes its default, deploy, release and app fragments are left out unless you name them with `--with`, and steps tagged `prod` are skipped. Drop it for a full project, where the brief lists the decisions your agent should ask you about.

The agent loops on `stacks verify` until it's green. `verify --all` also runs the steps a sandbox skips, and it's the final acceptance run. The [quick start guide](docs/quickstart.md) walks through all of this with real output.

## Working with a coding agent

At a terminal, `new` and `add` hand the project straight to a coding agent. The first configured one on your PATH launches, in this order: Claude Code, Codex CLI, OpenCode, Cursor CLI, Copilot CLI, then the Codex app on macOS. With none configured, a single installed harness launches without asking, and if several are installed you're asked to pick. `--launch <agent>` chooses explicitly and `--no-launch` prints the prompt instead. Nothing launches under `--json`, from inside an agent session, without a terminal, or for an untrusted entry (one from a project registry or a non-official index); for those you get the prompt to give your agent yourself.

Run `new`, `add` or `create` without its arguments at a terminal and it offers numbered choices, then prints the full command it ran so you can reuse it ([interactive pickers](docs/reference/commands.md#interactive-pickers)).

To let your agent drive from the start, install the agent skill once and ask the agent for a new project:

```sh
stacks skill install            # for Claude Code, under ~/.claude/skills
stacks skill install --project  # only for the current repository
stacks skill install --print    # print it to copy into another agent
```

Agents can also read `stacks guide`, which is what `stacks` prints with no arguments. [Using stacks with an agent](docs/agents.md) covers detection, the adapter files written for Claude Code, Codex, OpenCode and Cursor (`--agents`), and launch behavior.

## Commands

| Command | What it does |
| --- | --- |
| `stacks search "<words>"` | Find stacks and fragments for what you want to build |
| `stacks list` | List stacks, fragments and apps, with each stack's fragments |
| `stacks show <id>` | Review one entry: guidance, commands, shipped files, run evidence |
| `stacks new <stack> [dir]` | Start a project and write its brief (`--with`, `--without`, `--sandbox`, `--dry-run`) |
| `stacks add <fragment...>` | Apply fragments to an existing repository; conflicting files are parked under `.stacks/incoming/`, never overwritten |
| `stacks verify` | Run the project's verify steps (`--only`, `--skip-tag`, `--all`) |
| `stacks runs` | Show this project's verify history and timings |
| `stacks create stack\|fragment <id>` | Write a personal entry to edit, from scratch or copied from an existing one |
| `stacks validate [path]` | Check a registry or one entry; `--brief <stack>` previews a composed brief |
| `stacks doctor` | Report the runtime, paths and configuration |
| `stacks schema <name>` | Print the JSON Schema of a `--json` result |
| `stacks telemetry <status\|enable\|disable\|reset\|flush>` | Inspect, change or flush usage telemetry |
| `stacks update` | Check or update a global npm install |

Every command takes `--json` and writes exactly one result object to stdout; a failure writes one error envelope as the last line of stderr, and the exit code says what to do next. `stacks <command> --help` documents every flag. The [command reference](docs/reference/commands.md) and [output reference](docs/reference/output.md) have the details.

## Bundled stacks

| Stack | What it builds | App (`--with`) |
| --- | --- | --- |
| `astro-blog` | Static Astro blog: MDX posts in a validated collection, React islands, Tailwind, RSS and sitemap | |
| `astro-fullstack` | Bun workspace: a static Astro site with React islands and an Effect HttpApi server on Node, sharing a typed contract package | |
| `cloudflare-react-router` | React Router on the local Workers runtime with typed bindings and Workers integration tests | |
| `go-api` | Go HTTP API on the standard library: one JSON error envelope, request logging, clean shutdown, race-enabled tests against the built binary | |
| `go-cli` | Go CLI: cobra, viper config, structured errors, human and JSON output, golangci-lint | |
| `mobile-expo` | Expo Router app and a Bun + Hono API on Postgres, sharing zod schemas through a typed client | |
| `nextjs` | Next.js App Router on Node: server components, zod-validated Server Actions, Vitest and a Playwright test against the production build | |
| `python-api` | FastAPI service managed with uv: in-process pytest, structured request logs, one error envelope, an OpenAPI drift check | |
| `python-react` | FastAPI backend and a React SPA talking through a client generated from the OpenAPI spec | |
| `react-router` | React Router framework mode with SSR, Effect services, typed HTTP errors, Tailwind and shadcn | `openrouter-chat` |
| `sveltekit` | SvelteKit on the Node adapter: server load functions, zod-validated form actions, svelte-check, Vitest and Playwright | |
| `tauri-react` | Tauri desktop app: Rust crates behind a thin shell, typed IPC, a React frontend with a mock transport | |
| `typescript-api` | Node HTTP API on Effect's HttpApi: REST resource conventions, one error-status table, request logs, a core that also runs as a fetch handler | |
| `typescript-cli` | Bun-compiled TypeScript CLI on Effect with typed errors, safe output and logs | `openrouter-chat-cli` |

A stack pulls in default fragments (CI, git hooks, agent guardrails and so on); `stacks list` shows which, and `--without <fragment>` leaves one out. Apps are fragments that add a working feature on top of a stack. You can write your own stacks and fragments: see [Authoring a stack or fragment](docs/authoring.md).

## Network and privacy

Commands work offline against the bundled registry. With a network, `search` asks the hosted API at stacks.steamfield.io first and falls back to local ranking; `list` and `show` add published usage stats for bundled and index entries when they're available; `list`, `show` and `new` refresh a small signed allowlist of dependency names that telemetry may report; `update` makes one request to the npm registry. The search, stats and allowlist requests are best-effort: a slow or missing response never fails the command or changes its exit code. `--offline` or `STACKS_OFFLINE=1` makes no requests at all.

Published releases collect anonymous usage after a first-run notice. Source builds and local packs have no official telemetry endpoint. Run `stacks telemetry disable` to turn collection off; `DO_NOT_TRACK`, `STACKS_TELEMETRY_DISABLED` or any `CI` value also disable it. [Telemetry](docs/reference/telemetry.md) lists every field and what is never sent; the [privacy page](https://stacks.steamfield.io/telemetry) explains the policy.

[Configuration](docs/reference/configuration.md) covers settings, environment variables, the cache locations and the optional remote registry index (`STACKS_INDEX_URL`).

## Documentation

The [docs index](docs/README.md) lists everything: [concepts](docs/concepts.md) (stacks, fragments, the brief, verify), [how stacks works](docs/architecture.md), [authoring](docs/authoring.md), and the [command](docs/reference/commands.md), [output](docs/reference/output.md), [configuration](docs/reference/configuration.md), [search](docs/reference/search.md), [telemetry](docs/reference/telemetry.md) and [validation](docs/reference/validation.md) references.

## Development

This package lives in a bun workspace; the [root README](../../README.md) has setup. From `packages/cli/`:

```sh
bun run dev doctor             # the CLI from source
bun run build                  # bundle dist/cli.mjs behind the dist/stacks entry
node dist/stacks --version
bun run test:unit tests/cli.test.ts   # one test file
bun run check                  # this package's gate: lint, typecheck, tests, e2e
```

`bun run dev` runs the CLI from source in the directory you ran it from; [Configuration](docs/reference/configuration.md#the-development-wrapper) covers its logs, data directories and how to run it from outside the repo. `bun run check` runs Biome (including the boundary plugins), TypeScript, Vitest on Node, then the e2e checks, which pack the npm tarball, install it offline and run it under Node. No `.env`, credentials or external services are needed.

[AGENTS.md](../../AGENTS.md) has the architecture map and conventions, and [Maintaining the bundled registry](docs/maintaining.md) covers the bench, the run ledger, the search cards and publishing the Claude Code plugin.
