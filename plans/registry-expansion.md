# Registry expansion: missing stacks and reusable capabilities

Status: APPROVED 2026-10-29 after one devils-advocate review (corrections below). Batch 1 EXECUTED: `nextjs`, `python-api`, `go-api`, `sveltekit`, `effect-sql-postgres`, `drizzle-postgres` and `effect-otlp` landed, each proven green from a fresh scaffold; no bench ledger records yet. Follow-ups EXECUTED: pair budgets, trims, optional lists, the proven `drizzle-postgres` SvelteKit branch and its search ranking.

Start with reusable operational fragments and a small set of missing framework
families. The first stack candidates are Next.js, SvelteKit, Nuxt, a standalone
FastAPI API, and a Go API. Database access, authentication, jobs and observability
offer more reuse than another React full-stack variation.

This plan inventories the current registry, records online research, and gives an
author enough information to turn each selected candidate into an entry. It does
not agree new roadmap decisions, change published ids, or claim that a researched
recipe has been built or proven.

## Read the dependency outlines

The linked reports are part of this plan, not optional background. They contain
the per-candidate runtime and development dependencies, external tools and
services, environment, integration files, local verification, alternatives and
official documentation links:

| Report | Scope |
| --- | --- |
| [Stack creation outlines](research/registry-expansion-stacks-2026-10-29.md) | Missing framework and language families, plus library, CLI, documentation and data-project candidates |
| [Observability creation outlines](research/registry-expansion-observability-2026-10-29.md) | Logging, traces, metrics, error reporting, local backends and runtime-specific limits |
| [Fragment creation outlines](research/registry-expansion-fragments-2026-10-29.md) | Persistence, auth, cache/jobs, storage, email, payments, testing, delivery and AI capabilities |

Dependencies mean direct dependencies an author deliberately installs, including
testing and build tools. Transitive packages and platform-specific generator
output belong to the eventual lockfile. Optional branches are identified rather
than installed together. Resolve compatible current releases, peer dependencies,
native build requirements and generator output when implementing; package names
here are research outlines rather than a frozen lockfile.

## What exists

Inventory: 10 stacks and 20 fragments, read from
`packages/cli/registry/{stacks,fragments}` on 2026-10-29.

| Current stack | What it already covers | Gap worth addressing |
| --- | --- | --- |
| `astro-blog` | Static MDX/content site, React islands, feed/sitemap | Documentation-site conventions and search; no new generic Astro blog recipe |
| `astro-fullstack` | Static Astro site plus separate Node Effect API and shared contracts | Optional persistence, server telemetry and auth |
| `react-router` | Node SSR React Router with Effect services and Playwright | Optional database/auth; distinct framework families still missing |
| `cloudflare-react-router` | Workers SSR, resource routes, local runtime tests | Workers-native observability, R2, queues and durable state |
| `python-react` | FastAPI, React SPA, generated OpenAPI client, structlog, pytest and browser tooling | API-only Python option; reusable Python capabilities |
| `mobile-expo` | Expo Router, Hono API, Drizzle/Postgres, shared schemas, Clerk | Reusable standalone Hono/API building blocks; mobile error reporting |
| `tauri-react` | Rust desktop shell, React frontend, typed IPC | No immediate need for another desktop shell before demand |
| `typescript-api` | Node Effect HTTP API, contracts, structured request logs | Database access and exportable telemetry |
| `typescript-cli` | Effect CLI, config, structured logs, binary tests | Library publishing and Python CLI are different deliverables |
| `go-cli` | Cobra/Viper CLI, unit/integration tooling and release option | Go HTTP API, standard-library structured logs and database access |

All existing fragment ids, grouped by purpose:

| Purpose | Entries | Important limit |
| --- | --- | --- |
| Agent guidance/hooks | `agent-ops`, `claude-harness`, `ce-plugin` | Already a substantial part of composed briefs |
| Local and CI tooling | `git-hooks`, `ci-github`, `rr` | GitHub only; rr is host-dependent tooling |
| Release/deploy | `goreleaser`, `bun-release`, `docker-deploy`, `cloudflare-pages` | Container publication is not a host rollout; Bun binaries are not npm libraries |
| Persistence | `postgres`, `cloudflare-d1` | Postgres currently applies only to `python-react`; D1 only to `cloudflare-react-router` |
| Auth and analytics | `clerk`, `posthog` | Clerk applies only to `mobile-expo`; PostHog currently supplies browser SDK setup and event helpers, but needs an initial instrumentation workflow |
| Schema/API conventions | `effect`, `effect-schema`, `rest-api` | REST conventions do not add a running API or a generated non-Effect client |
| AI and example apps | `openrouter-ai`, `openrouter-chat`, `openrouter-chat-cli` | Provider integration and two app surfaces already exist; direct-provider alternatives need a separate reason |

Several bases already have logging. `python-react` lists `structlog` and request-id
middleware. The Effect stacks own their logging through Effect; replacing it
with Pino would create two competing systems. Reusable export, correlation and
backend integration are the missing pieces.

The [stack audit](stack-audit-2026-10-29.md)'s tasks 1 to 7 landed on 2026-10-29
(run-owned Postgres databases, Go integration tests, narrowed `bun-release`,
`docker-deploy` and `openrouter-ai`, sandboxed builds, browser smoke, portable
guidance). Task 8, the `dev-logs` extraction, is blocked: other stack scripts
import the log scripts by relative path, and the attempt overran a brief budget.
Don't create another local log viewer while it is open.

Composed brief sizes measured on 2026-10-29 with `validate --brief <stack> --json`
(limit 6,000). `validate` budgets every fitting stack and fragment pair at the
default and sandbox presets, so a new fragment's words come out of this headroom:

| Stack | Default | `--with rr --sandbox` |
| --- | --- | --- |
| `astro-fullstack` | 5,234 | 5,997 |
| `mobile-expo` | 5,235 | 5,998 |
| `typescript-api` | 5,210 | 5,973 |
| `python-react` | 4,856 | 5,672 |
| `react-router` | 4,642 | 5,427 |
| `astro-blog` | 3,814 | not measured |

A fragment for `astro-fullstack`, `mobile-expo` or `typescript-api` has roughly
700 words of room at the default preset. Measure its sandbox composition before
admitting one of those stacks, and leave a stack out of `applies_to` rather than
trim the fragment below what it needs to say.

### Search checks against this checkout

Ran the real local ranker, rather than inferring availability from descriptions:

| Request | Observed result | Interpretation |
| --- | --- | --- |
| Stack: `nextjs app` | No results; `noStrongMatch: true` | Missing framework family |
| Stack: `sveltekit` | No results; `noStrongMatch: true` | Missing framework family |
| Stack: `python backend api` | `python-react` is strong | A relevant backend exists, but forces a frontend |
| Fragment: `postgres typescript` | `postgres` ranks strong while declaring `appliesTo: [python-react]` | A search hit does not establish composition compatibility |
| Fragment: `redis background jobs` | No strong match; CI jobs appear as a partial match | Missing capability, with a future search distinction to test |
| Fragment: `logging tracing error tracking` | No strong match | Product analytics and coding guidance do not fill observability |
| Fragment: `authentication nextjs` | No strong match; Clerk is partial and mobile-only | Missing host and integration |

Do not use the search response's example/seeded stats as market-demand evidence.
The source of truth for compatibility is frontmatter plus the composed brief and
working project, not ranking strength.

## How to prioritize

Priorities combine a concrete coverage gap, likely reuse, a clear local proof,
and maintenance cost. They are product judgments, not survey rankings. A smaller
well-tested catalog is more useful than dozens of unproven names.

The current [Stack Overflow 2026 framework data](https://survey.stackoverflow.co/2026/technology/data/web-framework)
shows substantial respondent use of Next.js, FastAPI, Vue, Angular,
Spring Boot and Django. Its [technology overview](https://survey.stackoverflow.co/2026/technology/)
places PostgreSQL, SQLite and Redis among the leading databases. These are
self-selected survey responses, not global market shares or evidence that stacks
users want each recipe. The [State of JS 2024 framework report](https://2024.stateofjs.com/en-US/libraries/front-end-frameworks/)
provides an additional, older signal for Vue usage and Svelte sentiment. Keep
usage, satisfaction and fit for this product separate.

Use three priority levels throughout the reports:

- **P1:** closes a clear gap and can serve existing users or a major missing
  framework family. Candidate for the next expansion cycle.
- **P2:** useful next, after its host stacks or prerequisite capabilities exist,
  or after the first batch establishes proof and maintenance capacity.
- **P3:** demand-gated backlog. Research gives a starting point; do not schedule
  it just because a dependency list is available.

## Delivery order

The detailed reports sometimes rank within their own domain. This table owns
the cross-domain ordering. A batch holds what the maintainers can review and
bench in one cycle; the next batch starts after the previous one is benched.

| Batch | Entries | Why this order |
| --- | --- | --- |
| 0: protect existing coverage | Audit tasks 1 to 7 (landed). Narrow the framework-specific tag-wide `applies_to` lists (`effect`, `effect-schema`, `posthog`, `goreleaser`, `cloudflare-pages`) to the stack ids they match today, so new stacks don't pick them up through ordinary tags (done 2026-10-29). `rest-api` (`[api]`) and `claude-harness` (`[node, bun]`) stay tag-scoped because their bodies are framework-independent; each new stack's author composes them and narrows only on a real conflict. Write the service lifecycle rule below. Re-bench the existing stacks at current fingerprints (maintainer) | New stacks would otherwise inherit fragments nobody composed with them |
| 1: missing bases and first persistence (in progress) | Stacks `nextjs`, `python-api`, `go-api`, `sveltekit`. Fragments `effect-sql-postgres` (Effect hosts), `drizzle-postgres` (`nextjs`, `sveltekit`), `effect-otlp` (Effect servers). `postgres` widened to `python-api` | Broadens framework and language choice, and gives each host family one proven database owner |
| 2: identity, errors and telemetry backend | `nuxt`; `better-auth` (requires `drizzle-postgres`, on `nextjs` and `sveltekit`); the `posthog` revision; `sentry-web`, `sentry-python`; `opentelemetry-python` together with `grafana-lgtm`; `react-vite` | Needs Batch 1's hosts and database owner; the Grafana backend lands with a second SDK that can send to it |
| 3: application services | `redis`; `bullmq`; `s3-storage`; `resend`; `stripe-checkout`; `axe-checks`; `django` | Reuses the database and auth integrations from batches 1 and 2 |
| 4: operational breadth | `pino` (mobile-expo API), Workers observability and Go `slog` as baseline edits, `opentelemetry-go` (`go-api`), `storybook`, `renovate`, `openapi-client`, `ai-sdk`, `cloudflare-r2`, `cloudflare-queues`, `typescript-library`, `python-library` | Runtime-specific branches need their own fixtures and tests |
| Deferred | Everything in the "Deferred" lists of the three reports, including `drizzle-sqlite`, `prisma`, `supabase`, `sentry-expo`, `prometheus-*`, `k6`, `ci-gitlab`, the PostHog server branches, and the Rails, Laravel, Spring Boot, Phoenix and Flutter stacks | Low value now, duplicate an earlier choice, can't be proven locally, or need a format change |

Batch 1's persistence choice follows the host. Effect stacks (`typescript-api`,
`react-router`, `astro-fullstack`) get `effect-sql-postgres`, which keeps the
Effect service, schema and scope model. The new non-Effect stacks (`nextjs`,
`sveltekit`) get `drizzle-postgres`. The two declare each other in `conflicts`
so a project never has two owners of `DATABASE_URL`, the Compose service and the
`db:*` scripts. `mobile-expo` keeps its embedded Drizzle setup until a deliberate
extraction preserves its behavior. Python stacks keep `postgres` (SQLAlchemy).

Batch 2's `better-auth` and Batch 3's `stripe-checkout` require
`drizzle-postgres` and therefore apply only to the non-Effect hosts. Auth or
payments on an Effect host needs its own variant on `effect-sql-postgres`; that
is a Batch 3 decision, made after both persistence fragments are benched.

Rails (gems), Laravel (Composer), Spring Boot (Maven), Phoenix (Hex) and Flutter
(pub) are deferred until the format can describe their dependencies:
`@steamfield/stacks-format`'s `Ecosystem` is `npm | pypi | go | crates`, and
`core/deps.ts::readDependencies` reads only `package.json`, `pyproject.toml`,
`go.mod` and `Cargo.toml`. Extending both is a format release that `stacks-api`
also consumes, so it needs a decision in the plans README before any of those
stacks is authored. Django stays in Batch 3 because it is PyPI.

.NET is excluded at the maintainers' request, including from the later backlog.

### Service lifecycle rule for Docker-backed fragments

`postgres` already follows this; every new fragment that starts a local service
(`drizzle-postgres`, `effect-sql-postgres`, `redis`, `bullmq`, `s3-storage`,
`grafana-lgtm`) cites it instead of inventing its own:

1. Host ports are env variables with fixed defaults (`PORT_DB`, `PORT_DB_TEST`
   in `postgres`), and the Compose project name is the project's, so a second
   checkout or worktree sets its own ports in `.env` and never shares a
   container. The fragment's guidance says so.
2. A test run creates the databases, keys, queues or buckets it uses under
   run-owned names and removes only those. Never truncate, flush or drop by
   prefix on a shared service.
3. Teardown stops only containers the current run started. If the service was
   already running, leave it running.
4. Close clients and pools before releasing any lock or removing a resource.
5. Ordinary unit tests stay Docker-free. Ingestion checks against a heavy
   backend (`grafana-lgtm`) are an explicitly run command, not a default verify
   step.

## Entry boundaries and dependencies

### PostHog: instrument the application, beyond installing the SDK

Extend the existing `posthog` entry in Batch 2, retaining its id. Its current event
catalog, buffering and no-key behavior are useful building blocks. The missing
deliverable is an initial set of meaningful instrumentation integrated into the
application's actual execution paths. The [fragment report](research/registry-expansion-fragments-2026-10-29.md)
defines the researched SDK and behavioral outline.

`posthog` is a default fragment on `astro-blog` and `python-react`, so whatever
it says runs on every new scaffold of those stacks. Split the guidance by mode
with `<!-- stacks:when mode=add -->`:

- Under `new`, keep today's deliverable plus one instrumented starter action
  from the stack's own proving slice and the event inventory. There are no
  existing journeys to inspect.
- Under `add`, run the inspect-and-instrument workflow below.

The bench only scaffolds with `new`, so prove the `add` branch with a scripted
`add` test against a small existing project and a manual QA run. Changing the
body changes the `astro-blog` and `python-react` brief digests and stales their
proofs.

The `add` workflow, independent of framework and business domain:

1. Inspect the repository: runtime and framework, client/server boundaries,
   routes/commands/jobs, current analytics, auth/session lifecycle and consent.
   Read current official PostHog guidance for the detected runtime. Preserve an
   existing event contract rather than rename it to match a preferred taxonomy.
2. Identify the working user journeys and operational boundaries that actually
   exist. For each proposed event, record the question it answers, trigger,
   success/failure meaning, property types, owner and privacy rule. Do not invent
   checkout, signup or other domain features solely to obtain familiar events.
3. Install/configure the appropriate SDK through one adapter. Instrument a small
   initial set at real boundaries: navigation where relevant, the existing core
   action's completed outcome and meaningful failure, and identity transitions
   only if authentication exists. If there is no application behavior yet,
   provide a minimal proving action and list domain events as pending product
   work. A bare `track()` helper is insufficient completion.
4. Give each event one owner. Avoid duplicate manual/automatic pageviews and
   client/server captures for the same outcome. Identify with internal ids,
   reset on sign-out and apply the selected consent policy. Keep cookies,
   credentials, request bodies and user-entered text out of event properties.
5. Exercise the actual action/router/session path in tests and assert its event
   and safe properties through a controlled transport. Prove disabled/no-consent
   behavior sends and queues nothing, bounded buffering and safe shutdown.
   Produce a short event inventory and optional hosted inspection instructions.

The behavioral method is generic. SDK dependencies and lifecycle hooks still
depend on the runtime. Keep the web scope: the Node, Python and Go server
branches in the fragment report are deferred until a server stack asks for
them with explicit packages and a fresh local proof. Never install
`posthog-js` into Python or assume browser globals exist on a server. A future
separate guidance-only fragment is justified only if the universal method earns
independent reuse; it should not duplicate the same instructions in every SDK
fragment.

Distinguish product events, exception reporting, structured operational logs and
traces/metrics. PostHog instrumentation can correlate their ids, but must not
silently route every log line to product analytics or claim that the existing
analytics SDK establishes a full observability pipeline. Error capture and any
additional PostHog products need explicit selection and SDK support.

### Base and capability ownership

Keep the base responsible for routing/application structure, framework-native
configuration, tests, lint, type checking, artifact builds where applicable and
a meaningful deliverable.
Persistence, auth, vendors and deploy destinations normally stay optional.
Framework-native necessities can remain in the base: Django ORM/migrations,
Rails Active Record and Laravel Eloquent are not arbitrary ORM add-ons.

Separate these capabilities even if one vendor offers them together:

| Capability | Owns | Does not implicitly require |
| --- | --- | --- |
| Structured logging | Event schema, levels, request context, safe serialization, redaction | A paid account, collector or trace backend |
| Tracing/metrics instrumentation | SDK bootstrap, context propagation, resource attributes, bounded export and shutdown | Grafana specifically, Sentry, or product analytics |
| Local telemetry backend | Collector and local log/metric/trace storage/query tools | Every application language's SDK |
| Error reporting | Error capture, safe context, release/source-map workflow | Session replay or duplicate automatic tracing |
| Product analytics | Typed product events, identity/reset and consent behavior | Server tracing or exception reporting |
| Cache | Client lifecycle, namespacing, TTL, failure policy | A durable job worker |
| Jobs | Queue producer, separate worker, retry/idempotency and graceful shutdown | Email, payments or a web frontend |
| Database access | Connection ownership, migrations, isolated real database tests | Authentication or a hosting vendor |

Suggested dependency chains, using conceptual names until ids are selected:

```text
bullmq -> owns its own Redis Compose service; does not require the redis cache fragment
better-auth -> drizzle-postgres (non-Effect hosts only)
stripe-checkout -> drizzle-postgres; auth optional
drizzle-postgres <-> effect-sql-postgres: conflicts
pgvector -> PostgreSQL integration for that language/ORM
OTLP instrumentation -> no backend-specific fragment
grafana-lgtm -> no application SDK fragment; admitted only on stacks with an OTLP SDK fragment
Sentry -> no OTLP fragment; choose which system owns automatic tracing
Cloudflare R2 / Queues / Durable Objects -> Workers host, not Node SDK assumptions
```

When `bullmq` and `redis` are both selected, they share one Compose service:
whichever lands second detects the other's service by name and reuses it rather
than adding a second container. Jobs projects don't get a cache module or a
second Redis client they didn't ask for.

`FragmentMeta` already supports `requires`, `conflicts`, `applies_to` and
`requires_tools`. Use actual fragment ids in `requires`, never npm package names
or vague capabilities. A service precondition is not a required local tool: an
SDK that talks to managed Redis does not require a local `redis-server` binary.
Docker becomes a required tool only when the selected local proof needs it.

Use `conflicts` for mutually exclusive implementations that own the same schema,
path or authentication boundary, not for competing vendors that can coexist.
Drizzle and Prisma choices for the same model need an explicit selection policy.
Sentry errors and OTel traces can coexist with nonduplicating instrumentation.

Start `applies_to` with explicit stack ids from the report. Proposed future ids
are not valid compatibility targets until those stacks land. A `node` tag is
not enough to admit a Workers recipe whose Node tag merely describes its build
tools. `typescript` is far too wide for a server-only SDK.

## Authoring contract for each selected candidate

Read `.claude/skills/stack-authoring/SKILL.md` and
`.claude/skills/fragment-authoring/SKILL.md`, their shared search-card guidance,
and `packages/cli/docs/authoring.md`. Recheck the linked official documentation
at implementation time. The reports describe setup intent; they do not freeze
one generator invocation, SDK API or configuration format.

For each entry, record these choices before writing:

1. The proposed id and plain name; the product/capability and runtime it delivers;
   the nearest existing entry and why extending it would not cover this case.
2. Exact supported host ids; decisions with a default and fallback; required,
   default and optional fragments; conflicts and ownership of shared files.
3. Direct runtime dependencies, build/test/lint dependencies, system tools,
   external services, env names and which values remain empty locally. Keep
   credentials out of shipped files and fixtures. No package version in `deps`.
   Add every new `deps` name to `packages/cli/registry/allowlist.json` under its
   ecosystem; `build:index` fails on a bundled `deps` name missing from it, and
   the maintainer reviews the list.
4. Layout, generated files versus stable shipped files, native agent adapters
   and portable guidance. An AGENTS section points to the same knowledge for
   each agent; do not hide the implementation contract in Claude-only rules.
5. Project commands and verify steps. A fragment proves its own behavior and
   preserves the host's checks. Do not replace a command silently when two
   fragments contribute tests. Compose and inspect the final command map.
6. Search card and realistic requests. Choose closed facets from the existing
   vocabulary; propose a separate vocabulary change if observability, jobs or
   storage need new facets. No invented facet values. Draft provenance stays
   unreviewed until a maintainer reads it.

Use `tooling`, `service`, `vendor`, `deploy`, `release`, `ci`, `agent-ops` or `app`
as appropriate; there is no `observability`, `database` or `auth` category in the
current schema. Describe those concepts in names/tags/search metadata instead.

### Verification and proof

Every base covers install, lint, type checking (or the ecosystem's compiler/static
analysis), tests, and a production-relevant serve probe or CLI smoke. A base that
ships an artifact also builds/packages and checks that artifact. An explicitly
unpackaged Python service proves its runtime through HTTP rather than inventing
a build command; a packaged Python service also builds and installs its wheel.
Browser stacks exercise one rendered route and one form/data flow.
API stacks exercise valid input, invalid input and a failing dependency through
real HTTP. Worker stacks run in their local runtime.

Fragment checks exercise the boundary they add. Examples: migrate an empty
database and persist/read a row; prove cache expiry; retry a job without duplicate
side effects; round-trip an object through a local S3 service; verify a signed
webhook from its raw body; capture a span/event through an in-memory exporter or
local receiver. Merely asserting that a config file exists does not prove these.

Distinguish three proof levels:

- **Unit/contract:** controlled transports, local keypairs, in-memory exporters
  and malformed/failure cases. No production credentials.
- **Local integration:** real database/cache/queue/storage/collector where needed,
  isolated run ids, health waits, bounded timeouts, owned ports and teardown.
  Initial dependency/image downloads may need network access; the checks do not
  depend on an external account or paid API.
- **Hosted/manual:** provisioning, OAuth providers, ingestion visibility,
  source-map upload and actual deployment. Record these as pending user actions;
  local green does not establish a successful hosted deployment.

Telemetry checks cover disabled mode, secret/body redaction, context isolation
under concurrent requests, bounded exporter failure and flush/shutdown. Browser
builds must not leak server credentials. Database tests run real migrations and
clean only resources the current run owns. Queues test cancellation and worker
shutdown. Auth checks include unauthorized, forbidden and session isolation,
not merely rendering a sign-in button.

For each selected host, compose default and sandbox presets with the fragment;
test its required dependencies and likely sibling combinations. Read the result,
check file collisions and final command ownership, and measure word budgets.
Budgets remain 2,000 words per stack, 1,000 per fragment, 3,000 per app and
6,000 per composed brief (9,000 with an app). Optional operational capabilities
should not silently become defaults that consume the whole budget.

Run scoped registry/composition/search tests during implementation, then the full
gate once at the end of an implementation batch under the clone's rr policy.
Follow the skills' documented treatment of intentionally unreviewed search cards;
report those exact draft failures and obtain maintainer review rather than
fabricating an approval stamp. After review, the bundled registry should return
to zero errors and warnings.

Run a fresh bench for every new stack and every fragment that adds an app or
changes verify behavior, with the exact selected composition. Save failures and
interventions, fix the entry rather than weakening the project, and record a
current-fingerprint proof. Shared default-fragment changes stale every affected
stack's old proof. Promotion into the signed index follows its existing proof
rules, not the existence of a search card.

## Decisions

Made on 2026-10-29 when the maintainer approved this plan and asked for Batch 1
to be built:

- New general web stacks target a Node server, with deployment adapters
  optional; non-Effect stacks use their framework's native defaults; fragments
  start with explicit host ids; local proofs need no credentials.
- Batch 1 is the seven entries listed above, plus widening `postgres`.
- The standalone FastAPI stack is `python-api`, following `typescript-api` and
  `go-api`; its name and search card carry "FastAPI".
- The proposed `accessibility` fragment is `axe-checks`, because an automated
  axe scan doesn't establish accessibility compliance.
- Persistence follows the host (see "Delivery order"); `drizzle-sqlite`,
  `prisma` and `supabase` are deferred so one database owner per host family is
  proven first.

Still open: extending `Ecosystem` and `readDependencies` for gems, Composer,
Maven, Hex and pub (blocks those stacks), the auth and payments variant for
Effect hosts (Batch 3), and D6, who the bundled registry is for, which decides
how large the bundled catalog should grow past Batch 2.

## Completion criteria for this research plan

1. Every current stack and fragment is accounted for, including capabilities
   already embedded in bases and the existing `dev-logs` proposal.
2. Recommended additions have a dependency-level outline, host scope, integration
   shape, local verification and official sources in the linked reports.
3. Delivery order distinguishes immediate candidates, later work and demand-gated
   ideas, with reasons for keeping capabilities separate or extending an entry.
4. The plan is linked from the plans index and handoff. No registry entries,
   search approvals, benchmark proofs or agreement dates are fabricated.

## What this plan may get wrong

Survey respondents may not resemble this product's users. SDK names and generator
defaults may change before an entry is implemented. A popular framework may be
too costly to bench reliably on the available hosts. An apparently reusable
fragment may need narrower runtime-specific entries once composed projects expose
file ownership or lifecycle differences. Record those findings here and in the
candidate report; do not widen compatibility based on prose alone.

The 2026-10-29 review found these errors in the draft, now corrected above:
Batch 1 asked for Drizzle on a "non-Effect host" when every existing host it
named was an Effect stack; `better-auth` and `stripe-checkout` required
`drizzle-postgres` on hosts where `effect-sql-postgres` was preferred, with no
`conflicts` between the two; the draft claimed no format change was needed
while Rails, Laravel, Spring Boot, Phoenix and Flutter have no `Ecosystem`; it
never mentioned the dependency allowlist; the PostHog workflow assumed an
existing product on a default fragment that runs under `new`; `grafana-lgtm`
landed before most SDKs that could send to it; `bullmq` pulled in a cache; and
`react-vite`, `prometheus-*`, `k6`, `sentry-expo`, `supabase`, `prisma`,
`ci-gitlab`, `openapi-client` and `ai-sdk` had no place in the order.

Batch 1 authoring found the Effect hosts can't take two optional fragments at
once. `validate` budgets each fitting fragment alone, and every single
composition fits, but `typescript-api` and `astro-fullstack` sit within about 30
words of the 6,000-word brief limit with `rr` alone. Adding `effect-otlp`
(about 600 words) or `effect-sql-postgres` (about 650) on top of `rr`,
`docker-deploy` or each other overflows: `typescript-api` with `effect-otlp`
and `rr` composes to 6,562. Persistence plus telemetry, the obvious pairing,
doesn't fit. Fix it before Batch 2 adds Sentry and Better Auth to these hosts:
trim the two stack bodies and their default fragments, moving per-stack detail
into `files/docs/guidance/`, then add a budget check over the likely pairs
rather than each fragment alone.

Resolved 2026-10-29. The pair check covers every compatible pair, not just the
likely ones, and it found the problem wider than the Effect hosts: eight stacks
overran, mostly through `rr` (672 words) and `ce-plugin` (418). Trimming those
two, `postgres`, `typescript-api` and `astro-fullstack` brought every pair to
5,950 words or fewer.

## Research validation

Three research agents inspected the current registry and official online sources.
A separate architect review checked the combined proposal once. Its corrections
are incorporated: current installed Effect uses `effect/observability`, native
`PrometheusMetrics` avoids a second metrics client on Effect hosts, and an
unpackaged Python service needs a real HTTP proof rather than a nominal build.
The PostHog extension was included in that review. Research validates the
outline's consistency; future prototype builds and benches still establish
whether each proposed dependency combination works.

A devils-advocate review on 2026-10-29 checked the four documents against the
registry, the format package and the validate code; its corrections are applied
above and in the reports.

Document checks found all seven local links across the four proposal documents
valid and all four draft statuses present. `git diff --check` passed. The final
`rr check` passed all six partitions: CLI 179 files / 2,814 passing tests (3
skipped), bench 1 / 47, format 19 / 255, root harness 16 / 407 (3 skipped), plus
static checks and installed-package E2E 10 files / 35 passing tests. These are
repository checks for the documentation change, not benches of proposed entries.
