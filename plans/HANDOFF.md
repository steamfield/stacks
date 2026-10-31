# Handoff for the next stacks session

Status: DRAFT 2026-10-28 (phases 0 to 3 as before; phase 4's API, telemetry and search work
executed apart from the items under "Next session")

Start here, then read repo `AGENTS.md`, the README's
[product summary](README.md#product-to-preserve), and
[PROBLEM_STATEMENT.md](../product/PROBLEM_STATEMENT.md). Keep this file short: current state,
next steps, who owns each. When it grows past a couple of screens, move the dated detail
to `archive/` and leave a link.

## Plain-language metadata (2026-10-29)

[4.5f](archive/phases/phase-4.5f-plain-language-metadata-2026-10-30.md) is executed (D40). Every bundled
sidecar has an unscored `plain` block (what it is, good at, not good at; the example is
`projectExamples[0]`), and every allowlisted dependency a bundled entry uses has a reviewed
card in `packages/cli/registry/deps/<ecosystem>.json`. `show` leads with the copy,
`validate` checks it (`plain-versioned`, `deps-*`), and `build:index` signs `v1/deps.json`.
A new entry or dependency now needs its `plain` block and card before the bundled registry
is warning-free: `deps-missing` names the gap.

Next, in stacks-api: dependency pages built from `v1/deps.json` with `DEPS_ENABLED` hiding
only the stats sections (4.2e's dated note), the "What this is" panel on stack and fragment
pages, and each dependency's `whatItIs` in the stack page's dependencies section.

## Registry metadata pass (2026-10-29)

The [registry expansion proposal](registry-expansion.md) inventories all 10 stacks
and 20 fragments and links three online research reports with dependency-level
creation outlines. A devils-advocate review reshaped its delivery order into
batches, and the maintainer approved it. Batch 0 (narrowing the remaining
tag-wide `applies_to` lists) landed. Batch 1 is EXECUTED: stacks `nextjs`,
`python-api`, `go-api`, `sveltekit`; fragments `effect-sql-postgres` (Effect
hosts), `drizzle-postgres` (`nextjs` and `sveltekit`; the two conflict),
`effect-otlp`; `postgres` widened to `python-api`. Each was proven green from a
fresh scaffold by a Codex prover. The follow-ups landed: `validate` now budgets
every compatible pair of a stack's optional fragments; `rr`, `ce-plugin`,
`postgres`, `typescript-api` and `astro-fullstack` were trimmed (detail moved to
shipped `docs/guidance/`) so every pair fits within 5,950 words; the new
fragments are in their hosts' `fragments.optional`; the `drizzle-postgres`
SvelteKit branch was proven green; and `drizzle-postgres` ranks first for
host-named SQL requests (golden judgments added). Still open: bench each new
composition (maintainer tokens; none has a ledger record), and a full agent
build of SvelteKit with `drizzle-postgres`, since the prover's own build skipped
dev-reload pool reuse and some harness tests. Low-value or unprovable candidates
are marked deferred in the reports. .NET is excluded.

The subsequent [stack audit](stack-audit-2026-10-29.md) reviews all ten stacks and
records eight findings, including Postgres test-database ownership, fragment
compatibility, verification gaps and two shared-infrastructure opportunities.
A devils-advocate review corrected the findings, and the audit's fix guide
landed except task 8: Postgres lock order and teardown, Go integration tests
in vet/verify/CI, `bun-release`, `docker-deploy` and `openrouter-ai` narrowed
to the stacks they describe, sandbox builds for astro-blog and python-react,
browser smoke in verify for react-router and python-react, Tauri
`check-targets`, and React Router and Tauri guidance moved to portable
`docs/guidance/`. The dev-logs fragment extraction (task 8) is blocked on
typecheck and budget; see the audit's Status line for it and two open CLI
questions. Gate brief digests and five stack search cards were restamped;
astro-blog, go-cli, python-react, react-router and tauri-react need a bench
run before their compositions count as proven.

An audit of every bundled entry's naming, descriptions and search cards was applied: clearer
descriptions, search card facets, synonyms and exclusions, Go and `fullstack` vocabulary
aliases, and the `astro-api` to `astro-fullstack` rename (D39). New authoring guidance lives
in `.claude/skills/stack-authoring/` and `.claude/skills/fragment-authoring/`, and the
`stack-creator` agent (`.claude/agents/stack-creator.md`) uses both. Still open:

- Every `runs.json` proof is stale (the agent-ops, ci-github, claude-harness and effect edits
  changed the default compositions); re-bench before calling those stacks proven.
- `stacks-api` still names `astro-api` in `scripts/seed/profile.ts` (the rising storyline,
  which falls back silently), its web fixtures and its search fixtures. Update them, rebuild
  the index here and re-seed.
- mobile-expo sandbox plus rr is about two words under the 6,000-word brief budget.
- Searches still missing: "mcp server", "add auth to my web app", "add a database to my
  typescript api", "containerize my api".

## Submission queue (2026-10-28)

State at the end of the 2026-10-28 run: R0 to R4, R10, R12 and R13 are done (evidence in
`runs/2026-10-28-submission-readiness/`). CLI 0.4.0 is committed, gated and packed
(`release.md` has the tarball sha256); the maintainer runs `npm publish`, then an agent runs
the pinned `npx @steamfield/stacks@0.4.0` checks and pushes `v0.4.0`. Production serves the
120-day `active-4` seed with fast stats routes, a 4 GB API heap and stack dependency counts
inside each stack's population. The R6 rehearsal reached a green `verify --all`; the recording,
the organizer fields, S6 and the R11 uptime ping are the maintainer's. Known search limit: four
R13 queries ("typescript api", negation, e2e for an existing repo, Fly deploy) need `rank.ts`
and a format release.

Use [the submission-readiness plan](submission-readiness/README.md) for the remaining
order, scoped to a working, polished demo before the deadline. Its README is the tracker
and the decisions the user owes (S1 to S8); each row has its own file: R0 baseline; R1
search guidance, R2 seed realism, R3 demo recipe proof, R4 website polish and R10 judge
docs, R12 website search page and R13 search relevance tuning; R5 release and deploy; R6 demo and submission; R11 judging-window freeze. Signed
remote distribution, the live telemetry launch and hardening work are deferred to its R9.
This queue updates the ordering below; earlier dated execution notes remain historical
evidence.

## Earlier phase 4 handoff (2026-10-28)

Executed this batch: D38 (columnar lists, format 0.3.0), 4.2a's QA fixes, 4.1e, 4.2b's CLI
half, 4.2d, 4.2e, 4.2c's trending, 4.2g's test 4, the v2 deps seed and the active-scale profile,
and 4.5e: search is deployed at `https://stacks.steamfield.io` and `bin.ts::DEFAULT_API_URL`
names it, so the CLI's search, stats and allowlist use the hosted API. The search QA fixes
(4.5e's dated lines) are in format 0.4.0, published, and `stacks-api` `main` takes it; API
search hits now carry stats evidence; the seed has an active-scale profile and incremental
integrity (4.2g's dated lines). Nothing in this list is deployed yet. What's left, in order:

1. Redeploy `stacks-api` `main` (`prod:deploy`), then re-QA search against the hosted API with a
   CLI built from `main`: "go cli", "postgres auth for a saas", "!!!" and an iOS request in
   all three audiences; `--json` hits should show stats evidence and structured penalties,
   and `remote` should be `"ok"`. Until this deploy, the hosted API serves 0.3.0 penalties, which
   a CLI built from `main` can't decode, so it falls back to local ranking.
2. The active seed store. A full run was started at the end of the 2026-10-28 session into
   `.dev/data/active.sqlite` in the `stacks-api` checkout (about 46 minutes). If its seed marker
   says `complete: true` for profile `active`, use it; otherwise rerun: build the index here
   (`bun run build:index --out <dir> --previous none --unsigned --include-unproven` in
   `packages/cli`), then in `stacks-api`
   `STATIC_DIR=<dir> STACKS_DB_PATH=.dev/data/active.sqlite STACKS_ARCHIVE_DIR=.dev/data/active-archive bun run seed --profile active`.
   Judge it with `STACKS_DEMO=true`: `curl` the summary and a few details, read the site's home,
   a stack page, `/deps/` and `/telemetry`, and tune the profile until it reads like an active
   user base (hundreds of thousands of projects and events, rising/falling/launched stacks, a
   suppressed tail, deps cells, trending, no anomaly flag).
3. The Docker stack locally (`bun run deploy`, `docker compose up --build`) with the active
   store in the `/data` volume and `STACKS_DEMO=true`: `/healthz`, every stats, deps and search
   route, `POST /v1/events`, the site pages, `maintain` on its timer, data surviving a restart.
4. The demo host deploy: copy the active store into the host's data volume, deploy with
   `STACKS_DEMO=true`, generate secrets on the host only, look at what's already running there
   first, then manual QA over the LAN (every route, the site in a browser, a source-build CLI
   through an ssh tunnel). Production still serves the small default seed with the seeded label.
5. 4.2f's stats pages and charts and 4.2c's telemetry views: the frontend agent's work.

Cleanup for the maintainers: `stacks-api` has a leftover `.claude/worktrees/a13` (branch
`delegate/a13`) with uncommitted edits to the smoke, deploy, help and production scripts and a
`scripts/query.ts`; 4.1e's query tools already landed on `main`, so check it's superseded before
removing it. The m4-mini gate flakes (zombie-group `kill EPERM`, the rotated `dev.log` ENOENT,
seed and catch-up tests over their timeouts on the loaded coverage host) were fixed on
2026-10-28, and three consecutive stacks-api gates then passed; a new one gets a mechanism and a
regression test, not a retry.

Open questions: the index omits `lastRun` because no bundled stack has a ledger pass at its
current fingerprint, while local search shows ledger passes without that check, so the two
paths disagree. The site's own index reader (`apps/web/src/data/read-directory.ts`) still
requires signatures. 4.0f (Workers) stays deferred; 4.3 and 4.5d wait on their start
conditions. Maintainers' steps: the allowlist review, 4.1e's live launch and alert
destination, the index key, and 4.2d's production rerun.

## Manual library QA and fixes (2026-10-27–28)

QA-01 through QA-11 have CLI/recipe fixes, regression coverage and targeted
follow-up QA. The [closure report](archive/qa-gap-closure-2026-10-30.md) maps each fix and records
the temporary apps' remaining implementation/coverage limits. Mobile owns its
process groups, native guidance is portable, and the test guard follows the
actual command directory. Historical evidence and the ledger are unchanged.
Metadata enrichment is integrated below, with the maintainer's approval to land it.
The merged-tree rr gate passed six partitions: 3,056 tests passed/four skipped,
plus 35 installed-package end-to-end tests. Existing approved discovery cards
received digest-only refreshes; copy and review dates were preserved.

The app-eval follow-up adds one independent report v1 checkpoint shared through
openrouter-ai; both app manifests use it. It rejects the retained incomplete Terra
report and checks two local models, required cases and separate aggregates.
See the closure note's independent-checkpoint section for verification/review;
runner/scorer correctness and full app acceptance remain agent-owned.

Three Terra 6.1 agents exercised all ten bundled stacks and both apps; the
[report](runs/2026-10-27-library-qa/REPORT.md) records eleven CLI/recipe friction
items, implementation gaps missed by green checks, evidence and cleanup.
[Timings](runs/2026-10-27-library-qa/timings.md) separate CLI writes from agent
setup and app work. Subsequent source/registry fixes and fresh timing/QA evidence
are linked from the closure report; the original run remains unchanged.

## Phase 4 in progress (2026-10-27)

Metadata decoration extends the landed 4.5b implementation with additive optional
directory `description`, `seoDescription` and illustrative `projectExamples`,
plus 30 enriched cards (10 stacks, 18 other fragments, 2 app fragments).
The richer copy is outside ranking and embeddings; the existing search budget
and recipe proof digests stay unchanged. See [metadata-decoration.md](archive/metadata-decoration-2026-10-30.md)
for field purposes, coverage, checks and approval provenance. The maintainer
authorized landing the prepared cards on 2026-10-28; their agent authorship and
prompt version remain recorded. Main's reviewed discovery wording is preserved,
with source digests aligned to the QA-fixed recipes.
All final gate partitions passed: 3,112 tests passed/five skipped, plus 35 e2e
tests. The CLI partition passed on a remote rerun after local test watchdogs;
the metadata report records the runs and unchanged assertions.

Executed: 4.0a, 4.0b, 4.0c (both repositories: `stacks-api` serves the index and its
`sha256:`-named bundles, and its API README has the by-hand deploy), 4.0d (the remote origin; no official
index URL ships until the host exists, so `bin.ts` passes none and the origin is off unless
`STACKS_INDEX_URL` is set), 4.4a, 4.4b, 4.4c, 4.5a, and 4.0e (`v1/names.json` here, the directory site in `stacks-api`,
with no source link until the repository has a public URL). 4.5b is landed: all 30 bundled
cards were drafted by Codex agents in checkouts without the golden set and approved by a
maintainer (2026-10-28). 4.2c's telemetry-free parts are landed: `v1/directory.json` here, and in
`stacks-api` the newest, tag, fragment and removed-stack pages with the three-link nav; its
telemetry views remain. 4.2f runs fixture-first: the provisional `StatsSummary` and
`StatsDetail` are in `packages/format/src/stats.ts`, its data layer is landed in `stacks-api`, and
the charts wait on OpenChart work done outside these plans (another agent owns the site and
OpenChart). D17 is decided (opt-out, 2026-10-27) and D16 amended: telemetry storage runs on
SQLite on the Node host now. 4.5c is executed (2026-10-28): `stacks search` ranks locally, scoring
36/36 first results and 4/4 no-match on the golden set (`plans/runs/2026-10-28-search-lexical.md`);
the embeddings comparison waits on a maintainer's provider key. 4.1b is executed (2026-10-28):
`stacks-api` accepts `POST /v1/events` into SQLite (development defaults to `.dev/data/`,
production needs `STACKS_DB_PATH`, `NETWORK_HASH_KEY` and the trusted proxy headers). 4.1a is
executed (2026-10-28): the CLI queues opt-out telemetry and shows the first-run notice, but with
no official endpoint yet consent is `no_endpoint` unless `STACKS_TELEMETRY_URL` is set. 4.1c is
executed (2026-10-28): `stacks-api` runs archive, pruning and refresh under a lease (production
needs `STACKS_ARCHIVE_DIR`). `@steamfield/stacks-format` 0.1.0 is published and `stacks-api` reads its telemetry, names and
signed-index schemas from it. 4.1d is executed (2026-10-28): maintenance judges events after arrival,
rebuilds queued projects, keeps `installs`, `daily_metrics` and `anomaly_flags`, logs one alert
line per flagged run, and `/healthz` reports `maintenanceFresh`. 4.5e's CLI side is on main
(`stacks search` asks the API first; the format package is 0.2.0 with `rank`, unpublished until
a maintainer publishes it). 4.2a is executed: the rollups run in `maintain` after the integrity
pass and serve `GET /v1/stats`, `GET /v1/stacks/{stackId}/stats` and
`GET /v1/fragments/{fragmentId}/stats`. 4.2g is executed: `bun run seed` and `bun run dev:stats`
build labelled history in `.dev/data/seeded.sqlite` offline (tests 4, 12, 13 and 14 deferred),
and a fresh checkout runs them with no key (4.2g's last dated line):
`bun run build:index --out <dir> --previous none --unsigned --include-unproven` in
`packages/cli`, then `STATIC_DIR=<dir> bun run dev:stats` in `stacks-api`.
4.5e's route in `stacks-api` waits on 0.2.0's publication. Maintainers' steps:
review the 47 search judgments (4.5a), generate the index key and add it to `INDEX_PUBLIC_KEYS`,
rerun the bench per stack so the index proves something (4.0c), and publish each
`@steamfield/stacks-format` release (`packages/format/README.md`).

## Demo outline (2026-10-27)

[The revised outline](../product/DEMO_OUTLINE.md) leads with collaborative discovery:
describe a product, have the agent compare shared stacks using fit and usage evidence,
then scaffold and verify the selected starter. Rho stays a minimal example. The 4:45
Loom sequence includes narration, a short motion-graphics opener and shot transitions.
It retains the judge review's verification safeguard and measurable results.
Recording depends on the actual agent access to analytics and contribution route; the
official-only index and telemetry deferral below do not yet cover the full pitch.
Implementation status is unchanged. PITCH.md and PREP.md still use the old narrative;
align those and reconcile the wider positioning with the product and registry plans.

## Stats pages, seed data and search planned (2026-10-27)

New plans, all drafts awaiting the maintainers: [4.2f](phases/phase-4.2f-stats-pages-and-charts.md)
(the shared stats components, chart palette and the stack page's stats, static OpenChart SVG
with one island; 4.2c and 4.2e build and test their pages from these components; the site's
design tokens moved to [4.0e](archive/phases/phase-4.0e-official-names-and-directory-2026-10-30.md) so the
telemetry-free directory has them without D17), [4.2g](archive/phases/phase-4.2g-seed-telemetry-2026-10-30.md)
(deterministic seeded telemetry for local development only, labelled seeded everywhere and
never shown in the demo), and [4.5a](archive/phases/phase-4.5a-search-evaluation-set-2026-10-30.md) to
[4.5d](phases/phase-4.5d-semantic-retrieval.md) (a golden query set, reviewed search
sidecars, `stacks search` with local ranking, and an opt-in semantic leg that starts only if
the holdout paraphrase numbers need it). 4.2a gained a weekly series stride, `interval`,
`previous` and summary `sort`/`limit`/`kind`. Proposals D36 (search privacy; amended 2026-10-27 to API-first `GET /v1/search` with a local
fallback, [4.5e](archive/phases/phase-4.5e-search-endpoint-2026-10-30.md)) and D37 (sidecars outside the entry) are in
[requirements.md](requirements.md#proposed-decisions); open questions 33-40 cover rounding,
the agent dot plot, the golden set's growth, the embedding provider, the API's store layout,
the 90-day window, server-side decoration and a native iOS stack.

## `stacks update` (2026-10-27)

[4.4d](archive/phases/phase-4.4d-self-update-2026-10-30.md) landed (D31): `stacks update` reads the latest
version from the npm registry and upgrades a global npm install in place; npx and other
installs get the command to run; an agent gets `PermissionDenied` (exit 6) unless it passes
`--check`. Release 0.3.0 carries it. Not checked live: a real `npm install -g` replacing the
running package (tests use a fake npm).

## The API moved to a private repository (2026-10-27)

D35: the hosted API is `stacks-api`, a separate private repository, so its source isn't
public; `packages/api` is gone and phase 4's plans stay here, with API paths written
`stacks-api/apps/api/...`. It is a bun workspace: `apps/api` (the Effect `HttpApi`
server), `apps/web` (an Astro static site with React islands and Tailwind, which now holds
the directory, browse, stats and dependency pages) and `packages/contract` (the `HttpApi`
definition both apps import). It runs as a Node server on a maintainers' host first (4.0b,
"API skeleton on Node"), serving only `/healthz`, the signed index files and the built site;
the Workers spike and move are 4.0f, deferred until after the hackathon demo. Every storage-
or telemetry-backed sub-phase (4.1b onward) starts after 4.0f, on D1, so no data ever moves
between hosts. The index and `names.json` are still built and signed here. `@steamfield/stacks-format`
(4.0a) is now published, with a `dist/` build, because the API consumes it across repositories.

The bundled `astro-api` stack is what `stacks-api` is scaffolded from; it builds on the
backend-only `typescript-api`. Release 0.3.1 includes it, so scaffold with the installed CLI
(`stacks new astro-api <path>`): `bun run dev new` keeps the project's state record in the
checkout's `packages/cli/.dev/state`, where the installed `stacks verify` can't find it. Neither stack has
a bench run yet, so `list` shows them unproven; that first build is the bench. The backend
ships Claude rules for Effect HTTP APIs, REST resource naming, testing through HTTP with
real layers, verification and TypeScript, `/add-resource` and `/add-service` commands, and
boundary and command guards with tests.

## 4.5a executed (2026-10-27)

[4.5a](archive/phases/phase-4.5a-search-evaluation-set-2026-10-30.md) landed: `tests/fixtures/search/golden.json`
holds 47 judged requests (30 tune, 17 holdout; "go cli" and the TUI query added with the 4.5 search revision) covering every bundled stack and fragment, with
the `GoldenSet` schema and `evaluate` in `tests/helpers/`; `docs/maintaining.md` says how to
judge and when the baseline moves. The baseline stays at zero until 4.5c. The maintainers still
review the judgments and record the date in the plan. 4.5b can start.

## 4.4a executed (2026-10-27)

[4.4a](archive/phases/phase-4.4a-human-styling-and-live-progress-2026-10-30.md) landed: a person at a terminal
gets colored status words (`Output.style`), a live stderr line for each verify step and `new`'s
write and `git init` stages (`Output.live`), and prose wrapped to the terminal
(`core/wrap.ts`, `Host.columns`, `Host.stringWidth` from `platform/width.ts`). A nonempty
`NO_COLOR` turns off color and the live line; `FORCE_COLOR=1` colors human output through a
pipe. JSON and agent bytes are unchanged. `Host.stdoutColumns` folded into `Host.columns`.

## 4.0c executed (2026-10-27)

[4.0c](archive/phases/phase-4.0c-registry-index-2026-10-30.md) landed: `bun run build:index` in `packages/cli`
builds the proven-only `v1/index.json` and its bundles, signed inline with Ed25519 (`--key` or
`--unsigned`, `--previous <url>` for carry-forward), and `--check <base-url>` verifies a host.
`@steamfield/stacks-format` gains `LastRun`, `IndexEntry`, `RegistryIndex`, `SignedIndex` and an empty
`INDEX_PUBLIC_KEYS`; `LedgerRecord.agent` widens to `DetectedAgent`. Against today's ledger the
index proves no stack: four have stale fingerprints and six have no default-composition record,
so a bench rerun per stack comes first. Maintainers' steps: generate the production key and add
it to `INDEX_PUBLIC_KEYS`, rerun the bench, then the first signed build and deploy. The
`stacks-api` side (static `/v1/` files winning over the 404, the deploy procedure) is next.

## 4.4b executed (2026-10-27)

[4.4b](archive/phases/phase-4.4b-interactive-pickers-2026-10-30.md) landed: at a person's terminal, `new`, `add`
and `create` with missing arguments offer numbered pickers (`core/prompting.ts`, built on the
agent picker's `Terminal.readLine`) and print the `Running:` command the picks stand for. A set
`CI` now resolves to the agent audience. There is no arrow-key selection or filtering; long
menus are plain numbered lists.

## 4.0a executed (2026-10-27)

[4.0a](archive/phases/phase-4.0a-format-package-2026-10-30.md) landed: the entry, manifest and run-record
schemas live in `packages/format` (`@steamfield/stacks-format`), with `canonicalBundle` and
`bundleDigest`; the CLI links it through the workspace and bundles it, and `rr check` gains a
`check-format` partition. D21 (a signed index) and open question 14 (proven-only serving) are
decided, so 4.0c can start. Publishing `@steamfield/stacks-format` 0.1.0 to npm is the maintainers' step,
needed before `stacks-api` imports it (4.1b, after 4.0f).

## 4.0b executed (2026-10-27)

[4.0b](archive/phases/phase-4.0b-api-skeleton-on-node-2026-10-30.md) is built in `stacks-api` (no remote yet):
`/healthz`, `/openapi.json`, the 404 envelopes, a placeholder site, static serving with
`_headers`, and `bun run deploy`, which builds and starts one Docker container on the
maintainers' server over SSH and checks it at `DEPLOY_URL` (a LAN address and port for now).
Maintainers' steps: the first deploy, then the proxy and domain, then a remote and a first
hosted CI run. 4.0c must let static files under `/v1/` win over the API's 404 (the plan's
"What this plan may get wrong"). Scaffolding it with `--agents claude,codex` showed Codex got
less of the harness than Claude Code; the API stacks now ship their command guard, the shared
hook helpers and an Agent harness section for Codex too.

## Agent picker (2026-10-27)

[4.4c](archive/phases/phase-4.4c-agent-picker-2026-10-30.md) landed: at a terminal with several harnesses and
none configured, `new` and `add` ask which one gets the project after the summary; `--launch`
also takes `copilot` and `codex-app` (macOS). Not checked live: whether the Codex app's
`codex://new?path=&prompt=` link fills the prompt, and which env marker Copilot CLI sets.

## 0.1.0 released (2026-10-27)

The CLI is on npm as `@steamfield/stacks` 0.1.0 and installs the `stacks` command (D34:
npm refused the unscoped `stacks`). It is a Node 22+ ESM bundle (`dist/cli.mjs` behind
the `dist/stacks` entry), packed reproducibly by `bun run pack`; tag `v0.1.0`. The product,
`.stacks/`, `STACKS_*` and the skill name keep stacks. A manual QA pass over the
installed package found one blocker (`validate` with no path checked nothing), fixed before
publishing. Open from that pass, next release:

- Under npx, `--help` USAGE and EXAMPLES still say `stacks` (static effect/cli names); the
  guide, brief and `Next:` lines use the npx form.
- `invocationFor` knows only `_npx`: a project-local install, `pnpm dlx` or `yarn dlx` prints
  bare `stacks`, which isn't on PATH there.
- Scaffolded `AGENTS.md` and `.claude/README.md` (agent-ops) hard-code `stacks verify`.
- An unknown flag (`list --bogus`) gets no `details` naming it.
- The packed `package.json` keeps dev `scripts` and `devDependencies`.
- `bun.lock` still lists the workspace bin as `dist/stacks.mjs`; bun won't rewrite it until a
  dependency changes.
- 1.6c's gate rerun from the packed tarball was not done; release automation and provenance
  stay with 5.0.

## User documentation (2026-10-27)

The CLI's user docs live in `packages/cli/docs/` (index: `docs/README.md`): quick start,
concepts, agents, architecture, the reference pages that used to be the CLI README, and
maintaining. `packages/cli/README.md` is now a short entry page. Every command's `--help`
states its exit codes and examples (`tests/help.test.ts`), and `tests/docs.test.ts` checks
the docs' links and command names. Not done: structured `--help --json` (still `{ help }`),
and `create --from` still lists `user` as a choice it refuses. The Mermaid diagrams weren't
rendered locally; check them on GitHub once pushed.

## 1.6b gate runs (2026-10-27)

[1.6b](archive/phases/phase-1.6b-mvp-gate-runs-2026-10-30.md) ran headless from the compiled binary for D13's
three stacks, six rounds with brief fixes between them (rerun log in the plan). Each stack
has a green counting run on `e6f5da2`: [astro-blog](runs/2026-10-27-astro-blog.md),
[go-cli](runs/2026-10-27-go-cli.md), [python-react](runs/2026-10-27-python-react.md).
A maintainer still has to confirm each run, and the other four bundled stacks have none.

- Assumption 1, first result: an agent followed composed briefs of 3,200 to 4,800 words to a green `verify` in 3 to 5 minutes with nothing asked, once the briefs' own contradictions were fixed.
- D5: the 6,000-word budget held with room to spare for these stacks; no run tested a brief near the limit.

## Phases 2 and 3 (2026-10-27, executed)

Phases 2 and 3 are being executed through Codex delegates (`/execute:codex`), one test-author
then one implementer per sub-phase, merged to `main` as each lands. Work runs off the dev build
and the compiled binary: there is no packed tarball until 0.2, so every tarball check is
reworded for `dist/stacks` or deferred in its plan.

- Executed: [2.0a](archive/phases/phase-2.0a-composed-files-and-fingerprint-2026-10-30.md) (composed files and
  the fingerprint), [3.5b](archive/phases/phase-3.5b-two-phase-brief-2026-10-30.md) (base then app stages in
  `verify`), [3.4c](archive/phases/phase-3.4c-agent-skill-2026-10-30.md) (the agent skill and `skill install`),
  [3.1c](archive/phases/phase-3.1c-new-dry-run-and-naming-2026-10-30.md) (`new --dry-run`),
  [2.0c](archive/phases/phase-2.0c-run-ledger-2026-10-30.md) (the run ledger, `runs`, seeded from the 1.6b notes),
  [3.0](archive/phases/phase-3.0-add-fragments-to-repo-2026-10-30.md) (`add`),
  [3.1a](archive/phases/phase-3.1a-show-and-preview-2026-10-30.md) (`show` and the brief preview),
  [2.2](archive/phases/phase-2.2-deterministic-rot-checks-2026-10-30.md) (rot checks; reread the condensed
  `effect` and `effect-schema` guidance it trimmed to fit `mobile-expo --with effect`),
  [2.0b](archive/phases/phase-2.0b-bench-2026-10-30.md) (`bun run bench`, fake-agent tested),
  [3.1b](archive/phases/phase-3.1b-create-and-authoring-guide-2026-10-30.md) (`create` and the authoring guide),
  [3.3a](archive/phases/phase-3.3a-release-and-deploy-fragments-2026-10-30.md),
  [3.3b](archive/phases/phase-3.3b-bundled-stack-expansion-2026-10-30.md) and
  [3.3c](archive/phases/phase-3.3c-service-vendor-and-effect-fragments-2026-10-30.md) (the composition and
  safety tests for every bundled entry; bench proofs are the maintainers'),
  [3.4a](archive/phases/phase-3.4a-agent-harness-fragment-2026-10-30.md) (the TypeScript destructive guard in
  `claude-harness`, sharing one shell lexer with the repo's own hooks),
  [3.4b](archive/phases/phase-3.4b-native-agent-adapters-2026-10-30.md) (Codex, OpenCode and Cursor adapters
  calling the same shell guards, a reference check per config format, and the skill's Claude
  Code plugin; publishing it is a manual step in `packages/cli/docs/maintaining.md`).
- Deferred to phase 4 or later: [3.2a](phases/phase-3.2a-git-sources-and-untrusted-origin.md) and
  [3.2b](phases/phase-3.2b-source-updates-and-trust-report.md), gated on outside demand and open
  question 18.
- Left to maintainers: the real bench runs beyond a few seed runs, and the proofs that need
  them (3.3a-c, parts of 3.4a, 3.4b, 3.5b and 2.0b).
- After the last unit: one codebase-quality refactor (one `fitsStack` rule, an `isStack` guard),
  then two production reviews (CLI; harness and shipped entries), whose fixes are merged: `create`
  refuses to silently shadow an existing id, `add` names what blocks a planned path, project
  names with `"` or `\` are refused, the shipped destructive guard keeps every shell pattern
  when the TypeScript guard runs and fails closed, the shared lexer decodes `$'...'`, and the
  Codex adapter's hooks refuse when their guard is missing. The repo's own Codex delegates now
  run the destructive guard too.
- Open from the reviews, for maintainers:
  - The agent skill (and its plugin copy) falls back to `npx -y stacks@latest`, and the
    npm name is unreserved, so anyone could publish under it. Reserve the name or drop the
    fallback before the plugin is published.
  - `.rr.yaml` names one maintainer's hosts (rr is opt-in per clone, `git config
    stacks.rr true`); another maintainer who opts in needs hosts with the same names.
  - Decided 2026-10-27: the repo's hooks stay separate from the shipped ones and its destructive
    guard stays looser (docs/harness.md, "Repo hooks and shipped hooks").
  - Cursor's `Write` payload for an edit to an existing file isn't recorded; the fixture
    follows the docs. Record a live payload to confirm the secrets guard sees edits.
  - Catalog passes are now labelled historical; `show` compares current content.
    New counting proof still comes from a fresh bench, not a relabelled old run.

## Phases 0 and 1 (2026-10-27)

Every phase 0 and phase 1 sub-phase an agent can do is executed and merged to `main`. Open by
design: [0.0](phases/phase-0.0-decisions-and-npm-name.md) (the maintainers' decisions),
[0.2](archive/phases/phase-0.2-npm-distribution-artifact-2026-10-30.md) and
[1.6c](archive/phases/phase-1.6c-first-release-2026-10-30.md) (packaging, the npm name and the first publish,
the final step before public release, after the roadmap's
[feature gaps](roadmap.md#feature-gaps-to-close-before-release)), and the maintainers'
confirmation of [1.6b](archive/phases/phase-1.6b-mvp-gate-runs-2026-10-30.md)'s runs. The CLI runs from the repo
(`bun run dev`) or the compiled binary. CI runs on Linux only; tests named `(macOS)` run in
lefthook's pre-commit on a Mac. The state as of 2026-10-26, including the D18 amendment and
D29 (agent-first output), is in [archive/handoff-2026-10-26.md](archive/handoff-2026-10-26.md).

The plan, in brief:

- [roadmap.md](roadmap.md) has six phases. Phases 0 and 1 are the MVP and the demo, run
  from the repo or the compiled binary. Publishing to npm by hand is the final step
  before public release. Phase 5 holds every CI change and everything that runs an agent
  on a schedule (D23, proposed).
- The roadmap's shared-contracts table is the single owner of every cross-phase type,
  symbol, error tag and schema version, and its [trust model](roadmap.md#trust-model)
  is the one place trust rules live. Phase files cite both.
- Each sub-phase is sized for one agent; large ones are split with letter suffixes
  (for example [1.2a](archive/phases/phase-1.2a-new-scaffold-and-templates-2026-10-30.md) and
  [1.2b](archive/phases/phase-1.2b-manifest-state-and-detection-2026-10-30.md)). The roadmap's phase tables
  and dependency graph list every file.
- Below the MVP cutline on purpose: `new --dry-run` and naming options
  ([3.1c](archive/phases/phase-3.1c-new-dry-run-and-naming-2026-10-30.md)), the agent skill
  ([3.4c](archive/phases/phase-3.4c-agent-skill-2026-10-30.md)), the rot checks that only matter once
  stacks age ([2.2](archive/phases/phase-2.2-deterministic-rot-checks-2026-10-30.md)), and everything in
  phases 2-5.

D0-D4, D10 and D11 are settled. D5-D9 and D12-D27 are proposals in
[requirements.md](requirements.md#proposed-decisions) (D26 and D28 are superseded by the
amended D18); the roadmap's decision table says which sub-phase each one blocks. D5 (the brief budget) is a hypothesis whose evidence is
[1.6b](archive/phases/phase-1.6b-mvp-gate-runs-2026-10-30.md)'s gate runs. A1-A4 are open.

## Next steps

| Step | Owner | Notes |
|---|---|---|
| Agree or change the amended D18 (entry format v1) | Maintainers | Phases 1-3 are built to it; see [requirements.md](requirements.md#proposed-decisions) and the dated entries in each phase file's "What this plan may get wrong" |
| Reserve `stacks` on npm | Maintainers | Part of the final step before public release, with 0.2 and 1.6c; sooner only if someone else takes the name. The name was free on 2026-10-26, see the name check in [0.0](phases/phase-0.0-decisions-and-npm-name.md) |
| Review requirements.md and roadmap.md; decide A1, D12, D22 and D23 first, then D5-D7, D9, D13, D14, D18-D20 | Maintainers | The gating table in [0.0](phases/phase-0.0-decisions-and-npm-name.md) says which can wait |
| Review A2-A4 as answered in 0.3a and 0.3b | Maintainers | Must be in the decisions log before [1.6c](archive/phases/phase-1.6c-first-release-2026-10-30.md) publishes |
| Answer the open questions in [risks-and-open-questions.md](risks-and-open-questions.md) | Maintainers | Question 1 (registry audience) decides which stacks ship bundled |
| Review the 4.2f, 4.2g and 4.5a-4.5e drafts; decide D36 and D37; answer open questions 33-40 | Maintainers | 4.5a can start any time (data and pure functions); 4.5b and 4.5c need no API; the stats plans wait on D17 and 4.0f |
| ~~Apply the batch review's fixes to phase 1 round 1 (1.0, 1.1, 1.2a, 1.2b, 1.5)~~ | Agents | Done 2026-10-26, merged in PR #4; notes in [archive/handoff-2026-10-26.md](archive/handoff-2026-10-26.md) |
| Confirm 1.6b's three gate runs | Maintainers | One green counting run each for astro-blog, go-cli and python-react; the other four bundled stacks have none |
| ~~Choose how `validate` treats a verify step no layer describes (a file-existence or config check)~~ | Maintainers | Decided 2026-10-26: `check` layer added (roadmap, "Verify step `layer`"). `step-layer` stays a warning and `check` isn't a D7 layer; see [1.5](archive/phases/phase-1.5-validate-and-brief-budget-2026-10-30.md), "What this plan may get wrong" |
| Decide D19 (project-origin entries untrusted by default) | Maintainers | The only decision [1.0](archive/phases/phase-1.0-entry-format-and-registry-2026-10-30.md) blocks on besides D18; phases 1-3 are built to the proposal |
| Execute 0.2 (distribution) | Agent, after A1, D12 and D22 | Deferred 2026-10-26 to the final step before public release, with the npm reservation and 1.6c. Changes `bin.ts` |
| Decide open questions 24-28 (behavior kept on purpose in phases 0-1) | Maintainers | Before 1.0, 1.1, 1.3b and 1.6c, as each question says. Question 26 changed: 1.1 now proposes a warning, not an error, for a `--with` fragment that doesn't fit. The rest (D25, D27, questions 29-31) can wait for phases 3-4 |
