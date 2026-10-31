# Product requirements: stacks

Status: DRAFT 2026-10-26, derived from [PROBLEM_STATEMENT.md](../product/PROBLEM_STATEMENT.md)
and not yet reviewed by the maintainers. Settled decisions are in the
[README decisions log](README.md#decisions-log); everything under
[Proposed decisions](#proposed-decisions) below is open until agreed. Risks and open
questions are in [risks-and-open-questions.md](risks-and-open-questions.md).

## TL;DR

stacks is a CLI and a set of stacks. A stack is version-less prose plus a few files
that never change across versions: what the project is built from, how it is laid out,
what the tools must enforce, and a list of verify commands that define "working". The
user, or more often their agent, runs `stacks new <stack> <dir>`. The CLI writes
those files, a brief and a manifest, then hands off to the agent on PATH. The agent
builds the project against today's versions and loops on `stacks verify` until it
passes.

The goal is a project the user doesn't have to audit: the same setup they would have
built by hand, with the tests and tooling they would have added, in the time it takes to
make coffee. The sandbox target is a green `verify` in under 20 minutes with no user
intervention.

## Who this is for

Four users, in the problem statement's priority order. The full description of each,
and what success looks like for them, is in
[Who has it](../product/PROBLEM_STATEMENT.md#who-has-it).

| User | What they need from release 1 |
|---|---|
| The developer who starts projects often | A stack that matches how they'd build it, including tests, lint, CI and agent config |
| The coding agent (the CLI's main reader) | A brief with no ambiguity, a `verify` that exists and defines done, a default for every decision |
| The developer under time pressure | `--sandbox`: shortest path to a running dev environment with a passing test |
| The stack author | A way to know a stack still produces a working project without running it by hand |

The agent is the primary reader of everything the CLI emits. Requirements that trade
human readability against agent unambiguity should favor the agent, with `--json` on
every command an agent calls.

## What we're replacing

| Approach | What it gets right | Where it fails |
|---|---|---|
| Templates and generators (Yeoman, cookiecutter, the `create-*` family) | Durable choices: layout, tooling, conventions | Versions are committed, so the template ages from the day it ships; it can't express intent ("mypy strict with the pydantic plugin") without a config file that will be wrong for the next release |
| A bare agent prompt | The perishable part: current docs, running generators, fixing what breaks | No definition of done, a different layout every run, skips tests, lint, CI and agent config unless told in a level of detail that costs the afternoon |

Wider landscape, researched 2026-10-26. Where a claim came from a third-party review
rather than vendor docs, the row says so. Nothing found combines a version-less
project description, the user's own agent, an executable definition of done, and
detection of a weakened gate.

| Product | Kind | Versions | Definition of done | Uses the user's agent | Where it leaves the gap | Source |
|---|---|---|---|---|---|---|
| Copier | Template engine with updates | Template versions from git tags; dependency versions frozen in the template | None; `copier update` leaves conflicts as markers or `.rej` files | No | The best update story of the template tools, still with no gate that says the result works | [docs](https://copier.readthedocs.io/en/stable/updating/) |
| create-t3-app and the `create-*` family | Official generator | Pinned by the CLI release | Builds | No | One opinionated stack each. stacks calls generators like these as a step rather than competing with them | [docs](https://create.t3.gg/en/installation) |
| degit | Repo snapshot copy | Whatever the repo had at that commit | None | No | A plain copy with no parameters | [repo](https://github.com/Rich-Harris/degit) |
| Projen | Config synthesized from code | Manages upgrades itself | Its own build and test tasks | No | Owns the generated files for the life of the project; a manager, not a one-shot handoff | [site](https://projen.io/) |
| Nx generators and Nx MCP | Monorepo generators exposed to agents | Tied to the Nx release | Nx tasks, no done gate | Partly, through MCP | Closest to "the agent runs official generators", but only inside Nx | [docs](https://nx.dev/docs/reference/nx-mcp) |
| GitHub Spec Kit | Spec-driven workflow | Chosen during planning | Implement and converge commands repeat until the model reports converged | Yes, many agents | Works per feature, not per project bootstrap; the model decides it is done | [repo](https://github.com/github/spec-kit) |
| Kiro | Agentic IDE with specs | Not addressed | EARS-style acceptance criteria and a task checklist | No, its own agent | A checklist, not an executable check; tied to the IDE | [docs](https://kiro.dev/docs/specs/feature-specs/requirements-first/) |
| Tessl | Spec-as-source and a skills registry | Versioned registry items | A verification phase in its spec workflow (third-party review) | Registry works with any agent | Ongoing regeneration from specs rather than a bootstrap; not generally available | [review](https://codemyspec.com/blog/tessl-review) |
| BMAD Method | Agent persona and workflow kit | Not addressed for project dependencies | Workflow steps only | Yes | Heavy process, no executable gate | [docs](https://docs.bmad-method.org/start/install-bmad/) |
| Agent OS | Standards injected into projects | Stack-neutral | None (third-party review) | Yes | Standards without bootstrap or verification | [review](https://codemyspec.com/blog/agent-os-review) |
| AGENTS.md | Open instruction-file convention | n/a | An optional build-and-test section agents "will try to run" | Yes, most agents | A convention with no runner. stacks writes one rather than competing | [site](https://agents.md/) |
| A Stop-hook loop plugin for Claude Code ("Ralph Wiggum") | Agent loop pattern | n/a | Re-prompts until the model emits a completion promise or hits an iteration cap | Claude Code only | Shows people want "loop until checks pass"; completion is still self-reported (third-party write-up) | [write-up](https://www.dreamhost.com/blog/ralph-wiggum/) |
| Lovable, bolt.new, v0 | Hosted app builders | The platform picks the stack | A running preview | No, their own agent | Hosted, fixed stacks, backend lock-in (third-party comparison) | [comparison](https://resources.rework.com/tools/ai-coding/lovable-vs-bolt-new-vs-v0) |
| shadcn registry | Distribution model for copied components | npm dependencies resolved at install | None | Not by design | Copies files rather than describing intent, but its static, URL-addressable registry JSON is a model for a registry index | [docs](https://ui.shadcn.com/docs/registry/getting-started) |

Patterns users will expect, and what the plan does with each:

| Pattern | Seen in | In this plan |
|---|---|---|
| An `--agent <name>` flag and a non-interactive `-y` | Spec Kit `init --integration`, BMAD `--tools ... --yes` | `new --launch <agent>`, `--agents <list>`, `--yes` and `--sandbox` (1.2a, 1.4) |
| A stored record of the inputs that machines can check | Copier's answers file and `check-update` | `.stacks/manifest.json` (1.2b) |
| AGENTS.md as where agents look for build and test commands | AGENTS.md, Nx's agent setup | Every stack writes one; the brief requires it to be accurate (1.1) |
| A static registry addressable by URL | shadcn | The signed registry index (4.0c) |
| Trust tiers for third-party content | Claude Code plugin marketplaces, Tessl's security scores | Origins with `trusted` marks (1.0), git sources pinned and confirmed (3.2a, 3.2b) |

## What we're building

### The entry format

Stacks and fragments are directories with a markdown definition (frontmatter plus a
prose body) and an optional `files/` folder. `files/` holds only content that is the
same across versions. Everything version-sensitive is prose the agent interprets. A
fragment is a known-good piece (CI, agent hooks, Postgres) that composes onto a stack or
an existing repo. An app is a fragment with `category: app` that builds a small
application on top of a stack (D18).

### The CLI

| Command | Job it serves | Requirement |
|---|---|---|
| `list --json` | Agent picks a stack | Enough metadata for an agent to choose and explain why |
| `new <stack> <dir> [--sandbox] [--with ...]` | Start a project | Writes files, brief and manifest; hands off; runs no entry commands |
| `verify` | Definition of done | Runs the manifest's steps; the brief forbids weakening a step; detects tampering with the steps |
| `add <fragment>` | Improve an existing repo | Applies a fragment without overwriting existing files; never restructures |
| `validate` | Stack author trust | Checks entries, including the brief budget once one is set (D5) |

### The brief

The brief is the agent's whole instruction set. It must say which layers of testing to
set up, which verify command exists, and a default for every decision, so the agent
reaches green without asking the user anything the brief could have answered.

### The registry

Stacks come from layered origins: a project, the user's directory, third-party sources
and the bundled set. Who the bundled set is for is open (D6).

## In scope and out of scope

In scope for release 1 (proposed): the entry format, `list`, `new` with `--sandbox`,
`verify`, the brief, handoff to the agent on PATH, `validate` with a brief budget, and
enough stacks to test the core assumption at both small and large brief sizes, published
to npm by hand. That is phases 0 and 1 in [roadmap.md](roadmap.md#mvp-cutline), and it is
the demo. User-directory stacks load in the MVP because the origin is cheap; `add`,
authoring tools and git sources (jobs 3 and 4) follow in phase 3. CI release automation,
the scheduled canary and CI-run deploys are phase 5 (D23).

Out of scope, from [What this is not](../product/PROBLEM_STATEMENT.md#what-this-is-not), settled
as D1-D4:

- A template engine. `files/` holds only what is the same across versions.
- An agent. The CLI never calls an LLM and never runs a command from an entry.
- A package manager or version resolver. Versions are the agent's job.
- Retrofitting a project onto a stack. `add` applies fragments only.

## Proposed decisions

Each needs the maintainers' call. When agreed, move it to the README decisions log with the same
ID and the date.

| ID | Proposal | Why | Traces to |
|---|---|---|---|
| D5 | Set a per-stack brief budget, enforced by `validate` ([1.5](archive/phases/phase-1.5-validate-and-brief-budget-2026-10-30.md)), before the MVP stacks are written ([1.6a](archive/phases/phase-1.6a-bundled-stack-content-2026-10-30.md)). Starting numbers, revised 2026-10-26 and amended again the same day while executing 1.5 (agent proposal): stack body 2,000 words, fragment body 1,000, app body (a `category: app` fragment) 3,000, composed brief (either preset, fixed text included, rendered with 1.5's canonical context) 6,000 without an app and 9,000 with one; the earlier proposal was 5,000 composed and 6,500 with any one optional fragment, with no app number. 1.5 enforces these (`budget-body`, `budget-composed`), and they live in one constant, `src/core/validate/budget.ts::BUDGET`. These numbers are a hypothesis: that a composed brief near 6,000 words still gets an agent to green inside the 20-minute target, and that a much longer one slows it or ends with deliverables missing while `verify` passes. The evidence to collect is 1.6b's gate runs, which record brief size next to time to green ([1.6b](archive/phases/phase-1.6b-mvp-gate-runs-2026-10-30.md)) | Once stacks are 10,000 words nobody will cut them; the problem statement calls this a one-way door. A budget avoids the 10,000-word question rather than answering it ([risks](risks-and-open-questions.md#risks), first row) | Assumptions row 1; open question "What is the brief budget?" |
| D6 | The bundled registry is a curated catalog of stacks a stranger would want. Personal tooling lives in the user directory or a personal source | Mixed content makes the product unclear either way; origin layering already supports the split | Open question "Who is the bundled registry for?" |
| D7 | Every shipped stack's `verify` covers install, lint, typecheck, test, and a dev-server probe when there is a server. A stack can't ship without it. 1.5's `verify-layers` check enforces it on each stack's base composition in both presets (a `serve` step with a probe for `web` or `api` tags), and `step-layer` warns on a step with no `layer` | This is the "result is complete" success measure; making it a format rule turns it into something `validate` can check | Success table row 3 |
| D8 | Revised 2026-10-26 under D23. The scheduled canary runs in phase 5 ([5.1](phases/phase-5.1-scheduled-canary.md)), after the demo. Phase 2's local proof (ledger, bench, rot checks) comes before authoring (3.1b) and git sources (3.2a), which multiply stacks; `add` (3.0) reuses proven fragments and may run alongside phase 2. Reasons in [roadmap.md](roadmap.md#measurement-and-the-canary) | Manual end-to-end runs are the only quality signal; the bench makes them one command, and scheduling them is operational work the demo doesn't need | Open question "How does a stack prove it still works?" |
| D9 | Hand off to whatever agent is on PATH, and treat "ask your agent to run stacks" as an equal entry point. Instrument which one people use | Low-confidence assumption; cheap to support both and measure | Assumptions row 5 |
| D12 | Publish the package with `engines.node` `>=22` and test the packed artifact on Node 22 and the `.node-version` Node ([0.2](archive/phases/phase-0.2-npm-distribution-artifact-2026-10-30.md) locally; the CI job is [5.0](phases/phase-5.0-ci-release-and-checks.md)) | The base's `>=24 <25` would refuse many `npx` users; 22 is the oldest Node line still in maintenance | Entry point `npx stacks`; A1 |
| D13 | Amended 2026-10-26 (agent proposal): [1.6a](archive/phases/phase-1.6a-bundled-stack-content-2026-10-30.md) now brings the whole bundled catalog into entry format v1 and validates it ([roadmap, Feature gaps to close before release](roadmap.md#feature-gaps-to-close-before-release)), these three stacks among it. The word targets below become measurements to record rather than authoring targets, and since D20 gates every bundled stack, 1.6b grows to one run per catalog stack unless the maintainers narrow D20 to these three. Measured 2026-10-26 by 1.6a (`validate`, canonical context; composed words, fixed text in parentheses): `astro-blog` 3,635 (842) default and 3,629 (879) sandbox; `go-cli` 3,206 (749) and 3,197 (786); `python-react` 4,740 (851) and 4,734 (888). Each is under the 6,000 cap; `python-react` with its largest optional fragment (`postgres`) is 5,382 default. Original proposal: The MVP bundles three stacks: `astro-blog` first (composed brief about 3,000 words, dev server), `go-cli` (small, no server) and `python-react` (composed brief about 4,800 words, near the 5,000 budget, two servers), with the fragments their defaults need (AGENTS.md and agent config, git hooks, GitHub CI, and for `python-react` a stack-specific `api-client` fragment of about 700 words, which is how it reaches its target: the 2,000-word body cap rules out doing it in the body). `typescript-cli`, `react-router` and personal-tooling fragments stay out of the bundled set ([1.6a](archive/phases/phase-1.6a-bundled-stack-content-2026-10-30.md)) | One small and one near-budget brief tests assumption 1; all three are stacks a stranger would want (D6). Without a stated target, `python-react` could land too close to `astro-blog`'s size to test anything | Assumption 1; open questions on registry audience and the first stack |
| D14 | Changed verify steps fail `verify` (exit 5, `VerifyChanged`) instead of warning. The step digest, with the coverage in the [roadmap trust model](roadmap.md#trust-model) point 5, is kept in the manifest and in the user's state directory; `verify --accept-changes` re-records it only from a terminal and never when an agent is detected ([1.3b](archive/phases/phase-1.3b-tamper-detection-and-run-records-2026-10-30.md)) | A warning lets an agent finish by weakening the definition of done, which is the failure the trust story exists to prevent | Jobs ("why the brief refuses to let the agent weaken a step"); assumption 3 |
| D15 | The canary runs on a machine the maintainers control, as a separate OS user or in a VM or container that holds only the agent's login, under a maintainer's own agent subscription, never with model API keys stored in GitHub-hosted CI. Its GitHub token is a fine-grained token for this repo only with contents, pull-request and issues write; `main` is protected so that token can't push to it. It posts only after the agent's process group exits ([5.1](phases/phase-5.1-scheduled-canary.md)) | Keeps inference out of hosted CI and its secrets; a throwaway HOME is not a boundary against an agent with full permissions | Open question "How does a stack prove it still works?"; open question 13 |
| D16 | Decided 2026-10-27 (decisions log, with D35): Workers with D1 in production, reached in [4.0f](phases/phase-4.0f-workers-migration.md) after a Node interim. The proposal was: host the API on Cloudflare Workers with D1, or on a Node server with Postgres; 4.0b runs a spike and recommends one. Domain code depends only on Effect services, but the platform layer provides more than a database (event store, rate limiter, network hasher, archive, static assets, a scheduled entry), so a later move is real work | Cost, operations and how well Effect's HTTP modules run on each | Success rows 4 and 5 across users |
| D17 | Decided 2026-10-27 (decisions log): opt-out with 4.1a's protections. The proposal was: telemetry consent model (opt-in or opt-out), with a first run that sends nothing, standard off switches, and a published schema ([4.1a](archive/phases/phase-4.1a-telemetry-cli-client-2026-10-30.md) to [4.1c](archive/phases/phase-4.1c-telemetry-maintenance-and-retention-2026-10-30.md)). 4.1a recommends opt-out with those protections; if the answer is opt-in or no collection, 4.2a and 4.2b shrink to publishing ledger results. Same question as open question 5 | Two success measures can't be collected across users without it; the trust story makes the default matter | Success table; "None of these are collected today" |
| D18 | Entry format v1, amended 2026-10-26 (an agent's proposal; the maintainers haven't agreed it). Layout: `stacks/<id>/STACK.md` and `fragments/<id>/FRAGMENT.md`, each with optional `files/` and `adapters/<agent>/` (`claude`, `codex`, `opencode`, `cursor`); no symlinks. Frontmatter keys are snake_case. Shared fields: `schema_version` (1), `id` (kebab-case, equals the directory), `kind`, `name`, `description`, `tags`, `deps` (role to package names, never versions), `commands`, `tools`, `decisions`, `env`, `verify`, `merge`. Stack only: `fragments: { required, default, optional }`. Fragment only: `category` (`agent-ops`, `app`, `ci`, `deploy`, `release`, `service`, `vendor`, `tooling`), `applies_to`, `needs_own_repo`, `requires`, `conflicts`, `requires_tools`. A verify step is `{ name, run, cwd?, phase, tags, expect?: { http, within }, layer?, timeout? }`; built-in file checks are dropped from v1. Dotfiles are stored literally in `files/` and `adapters/`. Only `*.tmpl` files render, with the fixed variables `project_name`, `project_slug`, `env_prefix`, `package_scope`, `author`, `year`. An app is a fragment with `category: app`, at most one per composition, composed last. Conditional prose uses `stacks:when` / `stacks:end` markers. The schema is [1.0](archive/phases/phase-1.0-entry-format-and-registry-2026-10-30.md)'s, composition [1.1](archive/phases/phase-1.1-composition-and-brief-2026-10-30.md)'s, templates [1.2a](archive/phases/phase-1.2a-new-scaffold-and-templates-2026-10-30.md)'s; the versioning rule is the [roadmap's Schema versions table](roadmap.md#schema-versions). CLI output stays camelCase; only authored YAML (and `config.json` keys added for authors, such as `package_scope`) is snake_case. Blocks the start of 1.1 and the authoring in 1.6a | Every bundled entry is written against it; changing it after 1.6a means rewriting them. Authors write snake_case YAML, and literal dotfiles are what an author expects to find in a `files/` tree. Making an app a fragment keeps one entry kind and one composition algorithm, and folding `package_scope` in now means no entry ever needs `schema_version: 2` for it | Job 5; "a target I can verify against" |
| D19 | Every project-origin entry is untrusted until the user allowlists its content digest, not only one that shadows an id ([roadmap trust model](roadmap.md#trust-model) point 2). Blocks 1.0 | A cloned repo can ship a stack with a new id; an agent that picks it follows whatever its prose says | The trust paragraph in Jobs |
| D20 | The MVP gate: every bundled stack has at least one recorded green `new --sandbox` run with zero interventions and `tamperCheck: "full"` before release. Two of three green on the first attempt is the success-rate target, not the gate. Blocks 1.6b | One rule in every file; a 2-of-3 gate would ship a stack that doesn't work | Success row 1 |
| D21 | Decided 2026-10-27 (decisions log, with open question 14: proven-only serving). The proposal was: the default registry index is signed with an Ed25519 key whose public half is compiled into the CLI; an index that fails verification is ignored. Blocks 4.0c and 4.0d | A same-host digest proves nothing if the host is compromised; the index changes what agents build | Trust; "Stacks don't rot" |
| D22 | Release 1 supports macOS and Linux (`"os": ["darwin", "linux"]`) on the Node runtime only. Running the package under Bun (`bunx --bun`, or Bun without Node) is unsupported: the package's tiny entry `dist/stacks.mjs`, which also checks the Node floor before Effect loads, exits 1 with a fixed line. `bun run dev` runs `src/bin.ts` directly and is unaffected. Blocks 0.2 | Process groups and `/bin/sh` are POSIX; under Bun, `.env` files load into the environment before `config.ts` captures it | A1; D12 |
| D23 | Demo first. Phases 0 and 1 publish to npm by hand; everything that adds CI jobs, runs an agent or LLM in CI or on a schedule, or builds and deploys from CI moves to phase 5 (5.0-5.2). Each earlier sub-phase keeps its local behavior and tests. The existing CI workflow is not changed before phase 5. The roadmap is already written to this proposal | The goal is a hackathon demo; `npx stacks` is the demo, CI robustness is not | Entry point `npx stacks` |
| D24 | Headless agent runs (bench, canary) authenticate with a long-lived token passed through the environment, using each agent's own headless-token flow, and never copy refreshable credential files into a throwaway HOME. The bench's adapter table records each agent's mechanism. Blocks 2.0b and 5.1 | macOS keychain logins can't be copied, and OAuth refresh tokens rotate inside a copy and invalidate the original | Success rows 1 and 2 |
| D25 | Decided 2026-10-28 (decisions log). Collect dependency versions, limited to an allowlist. The CLI fetches a published allowlist of package names per ecosystem (`GET /v1/allowlist`), reads the project's manifest files at `verify` (it executes nothing, D2), and sends only allowlisted names with their major version on the verify event, under telemetry `schemaVersion: 2`. Public per-dependency and per-ecosystem numbers use the same suppression and capping as every other stat ([4.2d](archive/phases/phase-4.2d-dependency-telemetry-client-and-ingest-2026-10-30.md) collects, [4.2e](archive/phases/phase-4.2e-dependency-trends-and-pages-2026-10-30.md) publishes). Needs D17 | It is the only across-users signal of which current versions a stack's agents actually install, which is how version-less prose rot shows up before a stack fails; 2.2's deterministic checks only see the stack's own content. An allowlist keeps private and internal package names off the wire | Assumption 2 ("version-less prose rots much more slowly"); success row 4 |
| D26 | Superseded 2026-10-26 by the amended D18: an app is a fragment with `category: app`, not a separate kind, and the two-part brief moves into [1.1](archive/phases/phase-1.1-composition-and-brief-2026-10-30.md). Original proposal kept for the record: Add an entry kind `app` (`applications/<id>/APP.md`): an app is built on a stack and brings a two-phase brief. Phase one takes the stack to a green `verify`; phase two adds the app's own slice and verify steps, appended to the manifest and covered by the same step digest (D14). Each phase has its own budget under D5. It amends D18 (a new `kind` value, so the entry schema version rule applies and every `app` entry declares `schemaVersion: 3`) ([3.5a](phases/phase-3.5a-app-entry-kind.md), [3.5b](archive/phases/phase-3.5b-two-phase-brief-2026-10-30.md)) | Developers start apps, not only skeletons; splitting the brief keeps each phase inside the budget instead of growing one brief past it | Job 1; assumption 1 (brief size) |
| D27 | Bundled agent fragments ship native adapters for Claude Code, Codex, OpenCode and Cursor (`adapters/<agent>/`), each only in the agent's documented config format and each proved by a bench run with that agent ([3.4b](archive/phases/phase-3.4b-native-agent-adapters-2026-10-30.md)) | AGENTS.md alone gives a non-Claude user instructions without the guardrail hooks, so the same stack is weaker for them | "The CLI hands off to the agent the user already has"; D9 |
| D28 | Superseded 2026-10-26 by the amended D18, which puts `package_scope` in v1's variable set (set by `new --scope`, then `Settings.package_scope`), so no `schema_version: 2` is needed. Original proposal kept for the record: Add a `{{package_scope}}` template variable, set by `new --scope`, then `Settings.packageScope`, else empty. It amends D18 (a new name in the fixed variable set, which older CLIs reject as unknown, so an entry that uses it declares `schemaVersion: 2`) ([3.3a](archive/phases/phase-3.3a-release-and-deploy-fragments-2026-10-30.md)) | Release fragments that publish a package need the scope; without a variable every such fragment would ask the agent to guess | Job 1 ("a default for every decision") |
| D31 | Decided 2026-10-27 (decisions log) as `stacks update`, npm global installs only ([4.4d](archive/phases/phase-4.4d-self-update-2026-10-30.md)). The proposal was: `stacks upgrade [--check]`, an explicit command that reports the running and latest versions and, without `--check`, upgrades by deferring to the install method it detects (npm global, Homebrew, or a compiled binary it can name); it never checks for updates in the background or on other commands, and refuses under an agent unless `--check`. Needs A1 answered first, since the install methods depend on it. Per-platform compiled binaries behind an npm wrapper is A1's option (b) and is not re-proposed here | An explicit upgrade removes the "how was this installed?" guesswork, while background update checks add network calls a trust-focused CLI shouldn't make silently | Entry point `npx stacks`; A1 |
| D32 | Generate the command reference (markdown, and roff man pages if a package manager wants them) from effect/cli's `HelpDoc` for every command, with a test that fails when the committed reference differs from the generated one | Help text is already the documented contract an agent reads cold (`rules/cli/cli.md`); generating the reference from it keeps the two from drifting. No Effect-native generator exists, so it's a small script | "Help text documents every flag and argument" |
| D36 | Amended 2026-10-27 (the maintainers chose API-first search with a local fallback; the details below are proposed). Search is an API endpoint, `GET /v1/search?q=` ([4.5e](archive/phases/phase-4.5e-search-endpoint-2026-10-30.md)), and `stacks search` asks it first: the request text goes to the API, and when the API doesn't answer within 800 ms, or answers with anything that doesn't decode, the CLI returns its own local ranking ([4.5c](archive/phases/phase-4.5c-search-command-and-local-ranking-2026-10-30.md)) and says so in the result. Both sides run the same `rank` from `packages/format`, so a fallback changes freshness, not behavior. The call is skipped with `--local`, `--offline` or `STACKS_OFFLINE`, or `DO_NOT_TRACK`, and during a 10-minute backoff after a failure. The API never logs, stores, caches or counts a request by its text (its request records carry no query string, responses are `no-store`); only a daily total of requests exists. The CLI never logs request text either. When the semantic leg ([4.5d](phases/phase-4.5d-semantic-retrieval.md)) starts, it runs inside the same route for every caller, and Workers AI is the one processor that sees the text. Replaces the proposal that searching stayed local unless a person ran `stacks search-hybrid enable` | Search is a key surface of the hosted API, shared by the CLI, the site, MCP clients and other callers; ranking on the server lets cards, index entries and later embeddings improve results without a CLI release, and the local fallback keeps search working offline and fast. The cost: a request describing what someone is about to build leaves the machine by default, and a `GET` puts it in a URL that infrastructure outside the API's code can log. This is the one exception to D17's "a first run sends nothing": a search sends the words the user asked to search for, and nothing else | Trust model; D17; 4.5e's privacy rules |
| D37 | Search metadata is a reviewed sidecar per entry under `registry/search/` ([4.5b](archive/phases/phase-4.5b-search-metadata-2026-10-30.md)), outside the entry, so it never changes `fingerprint` or `bundleDigest` and never invalidates a proof. Proposed editorial enrichment (2026-10-27): the same schema-version-1 sidecar may include optional `description` (directory details), `seoDescription` (page metadata) and illustrative `projectExamples` (directory/agent comparisons). These have separate caps, remain outside ranking and embeddings, and validate named hosts/additions using recipe selection rules. Existing search phrases/facets retain their 150-word budget and existing fields; apps remain fragments. A maintainer-only script (`scripts/decorate.ts`) may draft sidecars through OpenRouter with the key from the environment; a person reviews and approves each one. No language model writes or reads metadata at run time, in the CLI or the API (D2). The stated exception is 4.5d's embedding model, if 4.5d starts: the API's `maintain` step embeds reviewed sidecars into vectors and `GET /v1/search` embeds the request; it writes nothing but vectors and never changes a sidecar. A sidecar whose entry text changed is reported stale by `validate` | Search needs words authors don't write (platforms, product kinds, example requests); keeping them out of the entry keeps proven content proven, and review keeps them true | "Agents pick the right stack"; D2 |

## How success is measured

Measured per stack, not per release. These come from
[What success looks like](../product/PROBLEM_STATEMENT.md#what-success-looks-like). None are
collected today. The roadmap's [measurement section](roadmap.md#measurement-and-the-canary)
says where each first gets a number.

| Outcome | Measure | Target | Collected by |
|---|---|---|---|
| The agent finishes without help | Fraction of `new --sandbox` runs reaching green `verify` with no user intervention | Gate (D20): every bundled stack has one recorded green run before release. Success-rate target: 2 of 3 stacks green on the first gate attempt, then 80% of bench and canary runs per stack per month (about four samples per stack per month, so one failure misses it; open question 21) | MVP gate runs (1.6b), bench runs (2.0b), canary (5.1) |
| It's faster than by hand | Median time from `new` to green `verify`; time to the first passing `test`-layer step is recorded alongside | Under 20 minutes to green (sandbox), a stand-in for the problem statement's "time to first passing test" (open question 22) | Run records (1.3b, 2.0c) |
| The result is complete | Shipped stacks whose verify covers all D7 layers | Every shipped stack | `validate` (1.5, if D7 is agreed) |
| Stacks don't rot | A stack that passed last month passes this month with no prose change | Every bundled stack | Bench reruns by hand (2.0b), then the canary (5.1) |
| People write their own | Stacks and fragments in user directories and third-party sources | Anyone outside the maintainers | Git sources make it countable (3.2a); usage telemetry across users (4.1a-4.1c), if D17 is agreed |

Telemetry isn't decided (D17). If it's adopted, [4.1a](archive/phases/phase-4.1a-telemetry-cli-client-2026-10-30.md) to [4.1c](archive/phases/phase-4.1c-telemetry-maintenance-and-retention-2026-10-30.md) carry the
privacy model and no collection ships before it.
