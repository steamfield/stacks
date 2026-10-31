# stacks

`stacks` starts projects for coding agents. It writes starter files and a build brief from a recipe (a stack), hands the project to your coding agent, and runs the project's declared checks so you and the agent agree on when it's done. Browse the catalog at [stacks.steamfield.io](https://stacks.steamfield.io).

This repository holds the CLI and the shared format package. The hosted side (the directory site, search and stats API) lives in a separate repository, `stacks-api`.

## Submission: architecture, demo, and data

Public repo: [steamfield/stacks](https://github.com/steamfield/stacks). The CLI uses TypeScript and Effect 4, bundled by Bun for Node 22+. Recipes are Markdown; your existing coding agent builds the application. The FastAPI + React example uses uv, pytest, Vite, and a generated OpenAPI client.

```mermaid
flowchart LR
  R["Markdown stacks + fragments"] --> C["CLI composes starter files and brief"]
  C --> A["Your coding agent builds"]
  A --> V{"verify --all"}
  V -- "fix failures" --> A
  V -- "checks pass" --> P["Working project foundation"]
```

### Reproduce the local FastAPI + React demo

Install Node 22+, git, Bun, uv, make, jq, and lefthook, and authenticate your coding agent. From a fresh directory, use the published CLI version checked for this submission:

```sh
npx --yes @steamfield/stacks@0.6.0 show python-react
npx --yes @steamfield/stacks@0.6.0 new python-react stacks-demo --sandbox --no-launch
cd stacks-demo
cp .env.example .env
```

Open `stacks-demo` in your coding agent and ask: **“Read .stacks/BRIEF.md and implement it without weakening the checks; finish by running npx --yes @steamfield/stacks@0.6.0 verify --all.”** Then inspect the result:

```sh
npx --yes @steamfield/stacks@0.6.0 verify --all
npx --yes @steamfield/stacks@0.6.0 runs
make dev
```

Open `http://localhost:5173`; the API health endpoint is `http://localhost:8000/health`. Check that all required verification steps passed, since a partial run can also exit 0. Generation and timing vary with the agent and dependencies; this reproduces the workflow, not a historical timed run.

The CLI calls no model and needs no API keys or `.env`. Your agent needs its own provider login or credentials. The generated app includes a [sample `.env.example`](packages/cli/registry/stacks/python-react/files/.env.example) with local defaults:

```dotenv
PORT_API=8000
PORT_WEB=5173
ENVIRONMENT=development
LOG_LEVEL=INFO
CORS_ORIGINS=["http://localhost:5173"]
VITE_API_BASE_URL=
```

No Rho, database, or analytics key is needed for this local starter. Optional integrations need separate credentials. Keep secrets out of Git and browser-exposed `VITE_` variables. The CLI does not autoload `.env`; the generated app reads its own configuration.

### Data and provenance

No external dataset is required for the local starter. Recipes and starter assets are in the [maintainer-controlled registry](packages/cli/registry); inspect their Git history for provenance. The public [run ledger](packages/cli/registry/runs.json) records historical agent sessions, versions, fingerprints, outcomes, and steps. At this revision it contains 8 records: 7 labeled pass and 1 fail. Five records skip the production build. Full run narratives referenced under `plans/runs/` are not public; these summaries do not establish a current success rate or an 8.8-minute reproduction.

The directory's [stats API](https://stacks.steamfield.io/v1/stats) identified its population as **seeded development data** on October 29, 2026. Its synthetic usage and outcome metrics illustrate the analytics interface, not community adoption. This repo documents reproduction of the CLI workflow rather than the hosted site's synthetic dataset. Record your own session metrics with `stacks runs`; illustrative homepage timings are not controlled benchmarks.

### Limitations and next steps

The CLI supports macOS and Linux on Node 22+; recipes need their own tools and agent access. Verification proves only the declared checks, not application quality or production readiness. Hosted search can fall back to local ranking. The catalog and historical evidence are limited, directory metrics are synthetic, and the [MCP server](packages/mcp/README.md) is a placeholder. Next steps are broader recipe coverage, public reproducible run artifacts, real outcome data with appropriate disclosure, and MCP support.

## Install and try it

stacks needs Node 22 or newer, on macOS or Linux.

```sh
npm install -g @steamfield/stacks@latest
stacks search "TypeScript command line tool"
stacks show typescript-cli
stacks new typescript-cli my-cli --sandbox
cd my-cli
# your coding agent reads .stacks/BRIEF.md and builds the project, then:
stacks verify --all
```

The package is `@steamfield/stacks` and the command is `stacks`; `npx @steamfield/stacks@latest <command>` works without installing. The [CLI README](packages/cli/README.md) explains each step, the bundled stacks and how agents drive it, and the [quick start](packages/cli/docs/quickstart.md) walks through a first project.

## What's here

| Path | What it is |
| --- | --- |
| [packages/cli](packages/cli/README.md) | `@steamfield/stacks`, the CLI: Effect 4 on Node, bundled by Bun. Holds the bundled registry of stacks and fragments, the agent skill and the [user docs](packages/cli/docs/README.md) |
| [packages/format](packages/format/README.md) | `@steamfield/stacks-format`, the contracts the CLI and the hosted API share: entry format, manifest, run records, telemetry events, bundles, the signed index and stats shapes |
| [packages/mcp](packages/mcp/README.md) | `@steamfield/stacks-mcp`, the MCP server: a stdio server on Effect's MCP modules that wraps the CLI's `--json` contract as typed tools and resources, so an agent whose client prefers MCP tools gets the same results and trust boundary |
| `product/` | The problem statement, pitch and demo outline |
| `.claude/`, [docs/harness.md](docs/harness.md) | The agent harness: hooks, rules, skills and agents, with their tests in `tests/hooks/` and `tests/scripts/` |

## Development

You need Bun 1.4.2 and Node 24 LTS. Install lefthook (`brew install lefthook` on macOS) and jq for the git hooks.

```sh
bun install                 # every package, plus the git hooks
bun run dev doctor          # the CLI from source
bun run dev new go-cli "$HOME/stacks-projects/my-cli" --sandbox --no-launch
bun run check               # lint, typecheck, every package's tests and e2e
```

Put projects you scaffold from source outside this checkout. `bun run dev` resolves paths against the directory you ran it from; [Configuration](packages/cli/docs/reference/configuration.md#the-development-wrapper) explains running it from inside a scaffolded project. To let your coding agent start projects from source, run `bun run dev skill install` once (`--project` installs it for the current repository only).

`bun run check` is the full gate and takes a few minutes. While you work, run the tests for what you changed (`bun run test:unit tests/<file>.test.ts` in `packages/cli`) plus `bun run lint` and `bun run typecheck`. [AGENTS.md](AGENTS.md) lists every command, the architecture and the conventions; it's written for coding agents and works for people too.

Commits follow Conventional Commits, checked by the commit-msg hook. Pre-commit formats staged files; pre-push runs lint and typecheck. CI (`.github/workflows/ci.yml`) runs the gate on Ubuntu for pushes to `main` and pull requests.

## Monorepo

Every package lives in `packages/<name>/` and is a bun workspace member (`"workspaces": { "packages": ["packages/*"] }` in the root `package.json`). There is one `bun.lock` and one `node_modules/` install at the root.

The root owns what applies to the whole repo: the agent harness (`.claude/`, `tests/hooks/`, `tests/scripts/`), lefthook, CI, the root `biome.json`, `tsconfig.base.json`, and the dependency catalog. It has no product code. Each package owns its source, tests, scripts, `tsconfig.json`, README, and any lint plugins of its own.

Root scripts (`build`, `typecheck`, `test`, `coverage`, `e2e`, `clean`) run `bun run --filter '*' <script>`, which runs that script in every package that defines it and skips the ones that don't. So a package joins the gate by defining the standard script names, and `bun run check` at the root is the gate for everything. Inside a package, the same script names run just that package. `bun run dev` at the root runs the CLI directly (`--cwd packages/cli`) because `--filter` prefixes each output line, which would break `--json`.

Dependency versions live once, in `workspaces.catalog` in the root `package.json`; packages depend on `"catalog:"` so every package gets the same Effect, TypeScript and Vitest. A package that depends on another one uses `"workspace:*"`. Shared code goes in its own package, never imported across another package's `src/`.

To add a package:

1. Create `packages/<name>/package.json` with a scoped name (`@steamfield/stacks-<name>`, the maintainers' npm scope), `"private": true` and `"type": "module"`, then run `bun install`.
2. Add `tsconfig.json` extending `../../tsconfig.base.json`, which has Node types only; add `"types": ["bun", "node"]` only if the package uses Bun APIs.
3. Define the standard scripts the package supports so the root gate runs them.
4. If it needs lint rules of its own, add a nested `biome.json` with `"root": false, "extends": "//"`.
5. If agents need package-specific guidance, add `.claude/rules/<name>/` scoped to `packages/<name>/`, and note the package in AGENTS.md.

## Releasing

Maintainers publish both packages with `bun run release` from an up-to-date `main`; `bun run release:dry-run` packs both and publishes nothing. [packages/format/README.md](packages/format/README.md#publishing) has the steps and the checks the script makes.
