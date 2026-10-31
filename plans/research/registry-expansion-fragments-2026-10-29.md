Status: REVIEWED 2026-10-29. Batch 1 (in progress): `effect-sql-postgres`, `drizzle-postgres`, and `postgres` widened to `python-api`. Batch 2: `better-auth`, the `posthog` revision. Batch 3: `redis`, `bullmq`, `s3-storage`, `resend`, `stripe-checkout`, `axe-checks`. Batch 4: `storybook`, `renovate`, `openapi-client`, `ai-sdk`, `cloudflare-r2`, `cloudflare-queues`. Deferred: `drizzle-sqlite`, `prisma`, `supabase`, `ci-gitlab`, the PostHog server branches and every P3 row. Batches live in [the plan's delivery order](../registry-expansion.md#delivery-order).

# Registry expansion research: application capabilities

Add one persistence owner per host family first: `effect-sql-postgres` on the Effect stacks, `drizzle-postgres` on the new non-Effect Node stacks. Auth follows on the non-Effect hosts, then jobs, storage, email and payments. These fill holes in ordinary applications that the current registry can scaffold but cannot yet compose from reusable entries.

This is proposal research, not an agreed implementation schedule. Candidate ids are provisional. Package lists below are direct dependencies an author would declare, not transitive lockfile inventories. Existing stack dependencies, lint tools and test runners remain inherited. Resolve stable versions and compatible peers from current documentation when implementing; do not copy a documentation site's prerelease install command blindly.

## Evidence and existing coverage

The 2026 Stack Overflow survey places PostgreSQL, SQLite and Redis first, second and fourth among databases, respectively. That supports covering those capabilities before niche storage systems. It does not establish which ORM, auth vendor or queue library this product's users want. Vendor documentation below establishes implementation feasibility; priorities beyond the survey are product judgments. [Survey technology results](https://survey.stackoverflow.co/2026/technology/).

The registry already has several pieces that should be reused:

- `postgres` fits only `python-react` and owns SQLAlchemy, asyncpg, Alembic, Compose and isolated test databases. Extend its Python compatibility when an API-only Python stack lands; keep its released id.
- `mobile-expo` already embeds Postgres and Drizzle, while `cloudflare-d1` adds Drizzle on D1. A Node Drizzle fragment should extract lessons from those recipes without adding a second driver or database lifecycle to either.
- `clerk` fits only `mobile-expo`. Auth for browser SSR stacks remains absent despite the existence of an auth fragment.
- `python-react` already includes MSW, Orval, Playwright and Testing Library. Most React stacks have browser tests. New fragments should add missing behavior or broaden reuse, rather than install a second test runner.
- `rest-api` is conventions guidance, not OpenAPI client generation, validation or compatibility checking. `ci-github`, `docker-deploy`, `cloudflare-pages`, `bun-release` and `goreleaser` already own their respective workflows.
- `openrouter-ai` and the two chat apps cover OpenRouter. A provider-neutral library recipe is a separate capability; another branded chat app would mostly duplicate the current ones.

The P1 outlines below are spread across batches 1 to 3 (see Status). Ship new capabilities as optional fragments. `drizzle-sqlite` is deferred: it would be a third persistence choice sharing `DATABASE_URL` and the `db:*` scripts before any one choice is proven.

Every new `deps` name goes into `packages/cli/registry/allowlist.json`; every Docker-backed fragment follows the plan's service lifecycle rule.

## Composition rules for all candidates

Start with explicit stack ids. A tag such as `typescript` also admits browser-only, compiled CLI and Workers projects that cannot open a Node socket or native SQLite driver. Add a tag only after composing and testing every admitted stack.

The format's `requires` list is conjunctive. It cannot express “Drizzle Postgres OR SQLite OR Supabase.” A fragment must choose one concrete first implementation, split into narrow variants, or leave a documented authoring decision for a later format proposal. Use the existing `conflicts` field for incompatible alternatives. Do not invent alternative-dependency metadata. Document combinations that require an authoring decision explicitly.

For Effect stacks, keep each vendor client behind the stack's service boundary and convert SDK failures there. Do not impose a second application runtime or replace the existing logger, server, HTTP schemas or error envelope. A worker is a separately started process with its own shutdown boundary. Hosted services need no account during ordinary verification: use actual local protocols or stub the remote boundary; label real cloud smoke tests as separate maintainer actions.

## First-wave authoring outlines (P1)

### Extend `posthog`: inspect the product and implement its initial instrumentation

**Scope and priority:** Batch 2 revision of the existing id, web hosts only. `posthog` is a default fragment on `astro-blog` and `python-react`, so the workflow below goes under `<!-- stacks:when mode=add -->`; under `new` the fragment keeps its current deliverable plus one instrumented starter action and the event inventory (the plan's PostHog section has the split and how to prove the `add` branch). Keep one PostHog fragment: its current initialization wrapper and event catalog are the right starting point. Add shared guidance that describes the instrumentation work independently of framework, plus explicit SDK/layout branches for supported hosts. A second generic analytics-rules fragment would duplicate most of its guidance while leaving the installed SDK fragment incomplete.

**Current gap:** the existing entry describes `initAnalytics`, `track`, `identify` and `reset`, but it does not require the agent to inspect a product's actual journeys and instrument its first meaningful actions. Installing a library and checking that the wrapper emits an event is insufficient. The deliverable should be actual call sites in the application's existing flows, an event contract and tests exercising those flows.

**Generic workflow, usable before choosing an SDK adapter:**

1. Inspect routes/screens, forms, commands, server mutations, auth callbacks, queues and external integrations. Identify the product's actual activation path and the decisions analytics should support. Reuse any existing tracking plan. Record what the code already implements; do not invent checkout, organization, signup, AI or subscription events for a product without those features.
2. Create `docs/analytics.md` and a typed event catalog using the host language's normal schema/type facilities. For each selected event, record purpose, exact trigger, allowed properties and their types/enums, identity source, client/server owner and deduplication rule. A sensible first pass is a few meaningful actions already present, not exhaustive click tracking. Keep event names stable and property cardinality bounded. PostHog's guide emphasizes consistent naming and consistent trigger meaning across surfaces. Its suggested naming guide uses present-tense snake_case; the existing fragment uses past-tense names. Keep a project's established convention and document it rather than mass-renaming existing analytics. [Product analytics best practices](https://posthog.com/docs/product-analytics/best-practices).
3. Implement those events at the real action boundaries. Distinguish an attempt from a confirmed result. A click may describe UI intent; a completed mutation belongs after success, usually on the server that knows it committed. For an implemented export flow, capture the actual successful export rather than a page render. For search, record safe filters/result counts rather than raw private queries. Choose one authoritative emitter per semantic event so a frontend click and backend completion do not double-count the same action.
4. Wire identity into the product's real auth lifecycle if auth exists. Use the stable internal user id after confirmed login/signup; call reset on logout and account changes. Never use email, an empty placeholder, a shared constant or a newly generated random id on every event as the authenticated identity. Backend events use the same trusted distinct id; never trust an arbitrary client-supplied user id for attribution. Anonymous browser behavior remains a documented choice. Avoid routine alias calls when identify already handles the anonymous-to-known transition. [Identity lifecycle](https://posthog.com/docs/product-analytics/identify).
5. If the code has organizations/accounts, wire groups from actual membership and active-organization changes. Use stable group ids; choose a few non-sensitive group properties. Do not invent multi-tenancy to demonstrate group analytics. Browser SDK group context can persist; server SDKs need group attribution on the appropriate events, scoped to the request rather than a global mutable tenant. Group analytics availability/cost should be recorded as a user setup concern. [Group analytics](https://posthog.com/docs/product-analytics/group-analytics).
6. Integrate through one narrow analytics module/service, then call it from those concrete product paths. Choose one pageview owner per navigation model: either the SDK's documented history tracking or the router hook, not both. Maintain the existing keyless development behavior. Analytics failures must not change a successful product response, hold a user action open indefinitely or replace an application error. No key or no consent means no event sending or queuing. Keep a bounded pre-init buffer only where needed; clear it on logout, identity changes and consent withdrawal so a later login/opt-in cannot inherit old events.

**SDK adapters and direct dependencies:** existing browser branch `posthog-js`; optional React provider only when justified by existing provider composition. Node backend branch adds runtime `posthog-node` behind a server service, with bounded flush on disposable/serverless work and shutdown at actual process exit, not after every request. Reusable clients must not be shut down between requests. [JavaScript SDK](https://posthog.com/docs/libraries/js), [Node lifecycle and package](https://posthog.com/docs/libraries/node).

The Node, Python and Go server branches in this and the next paragraph are deferred; the revision ships web branches only. Python branch adds PyPI `posthog`; for the async FastAPI path use the documented `posthog[async]` extra when supported by the selected stable release and own it in application lifespan. A later Go branch adds `github.com/posthog/posthog-go` and owns client close at process exit. These are researched adapter candidates, not evidence that the current fragment supports Python server capture or Go today. Each needs a real implementation/bench before broadening `applies_to`. [Python SDK](https://posthog.com/docs/libraries/python), [Go SDK](https://posthog.com/docs/libraries/go).

**Compatibility:** first implement the shared workflow for the currently admitted browser hosts, auditing each actual `web` tag match rather than assuming all frameworks use the same env prefix or initialization path. The fragment already declares `[web]` but has only some explicit stack branches; close those adapter gaps before claiming generic runtime support. Add explicit Node and Python host ids only after implementing their server adapters. Workers require their own request-lifecycle/transport proof; Go CLI analytics also require an explicit consent/config decision. Generic guidance can be framework-neutral while the supported implementation matrix remains narrow.

**Product analytics versus operational telemetry:** keep domain events separate from structured logs, OpenTelemetry spans/metrics and exception events. PostHog supports error tracking, but an ordinary `track('request_failed')` call is not a captured exception. If error tracking is selected, use the SDK's documented exception method at one actual error boundary and test scrubbing/deduplication. Do not manually synthesize the reserved exception event format. Do not enable exception autocapture, session replay, feature flags or LLM prompt capture merely because the SDK supports them. [Exception capture](https://posthog.com/docs/error-tracking/capture), [autocapture behavior](https://posthog.com/docs/product-analytics/autocapture).

**Configuration and privacy:** retain framework-specific public project token/host env names, optional server `POSTHOG_PROJECT_TOKEN`/`POSTHOG_HOST` (document any older project's key spelling), an explicit analytics enable/consent mode and empty-key no-op. Use the project token, never a personal administrative key in a browser. Record regional host, event property allowlist and consent policy. Leave autocapture/session recording off by default as the existing fragment does; explicitly review page URL/query collection, form contents, user text, tokens, email and persistent identifiers. Scrub before capture. Memory persistence does not itself eliminate personal-data or consent concerns. [Data collection controls](https://posthog.com/docs/privacy/data-collection).

**Initial implementation and verification:** add real calls for the selected implemented journeys, not just a sample script. Browser interaction/server integration tests exercise the action and assert its emitted catalog event, permitted payload and correct identity; failed or cancelled actions do not emit success. Test rerenders/retries for duplicate events, logout/reset, organization switching where present, missing key, rejected consent and a failing vendor transport. Stub the SDK/network boundary while keeping the actual route/component/service path real. Assert no traffic when disabled and no sensitive text in payloads. A local recorder/debug sink lets an agent inspect representative event payloads without an account. Document which funnels/activation questions those events can answer and which product flows remain uninstrumented. A live PostHog ingestion check is an optional configured smoke, not ordinary verify.

### `drizzle-postgres`: typed PostgreSQL for Node applications

**Scope and priority:** Batch 1. `applies_to: [nextjs, sveltekit]`, the non-Effect Node servers; `nuxt` joins when it lands. The Effect stacks use `effect-sql-postgres` instead, and the two declare each other in `conflicts`. Keep `mobile-expo` on its existing owner until a deliberate extraction updates its base recipe. Exclude `cloudflare-react-router` and browser bundles. The database module is server-only (`server-only` import on Next.js, `$lib/server` on SvelteKit), so no client bundle can import it.

**Direct dependencies:** runtime `drizzle-orm`, `pg`; development `drizzle-kit`, `@types/pg`. Optional test harness: `@testcontainers/postgresql` only if the implementation chooses Testcontainers instead of Compose. Tools: Node, Bun and Docker Compose. No `pg-native` by default. Drizzle documents both `pg` and `postgres`; choose `pg` here to match the current Expo stack. [Drizzle PostgreSQL drivers](https://orm.drizzle.team/docs/get-started-postgresql).

**Configuration and files:** `DATABASE_URL`, `TEST_DATABASE_URL`, configurable development/test ports; `compose.yaml`, `drizzle.config.ts`, checked-in `drizzle/` SQL migrations; a server-only database module and one repository; script names `db:up`, `db:migrate`, `db:generate`, `db:check`, `db:down`. Pool lifecycle belongs to the server scope. A readiness endpoint queries the database; liveness stays database-independent.

**Verification:** create an empty run-owned database, apply committed migrations, insert/read, prove unique/foreign-key constraints and rollback, check migration drift, close the pool and stop only run-owned resources after failure or interruption. Never generate new migration history during normal verification. Test simultaneous checkouts and parallel test files without prefix-based database cleanup. Model the harness on `postgres`'s run-owned template database, which already follows the plan's service lifecycle rule; the proving slice swaps the host stack's in-memory service for a repository behind the same interface, so the stack's existing page and form tests keep passing against the database.

**Composition:** alternative to Prisma or a complete Supabase persistence recipe, not a prerequisite for all database-related fragments. Reuse existing script owners and Compose keys; do not overwrite `.env.example` or a stack's current health semantics silently.

### `effect-sql-postgres`: PostgreSQL through the existing Effect runtime

**Scope and priority:** Batch 1. `applies_to: [typescript-api, astro-fullstack, react-router]`; these already use Effect services. It is the persistence owner on Effect hosts and declares `conflicts: [drizzle-postgres]`. `typescript-api` and `astro-fullstack` have about 700 words of default-preset headroom, so the body states the contract and puts per-stack layout detail in `files/docs/`.

**Direct dependencies:** runtime `effect` (inherited) and the Effect 4 PostgreSQL driver package, at the release that matches the installed `effect`; development uses the stack's existing TypeScript/Vitest tooling. Resolve the package name, its peer requirements and whether it brings its own wire client from the installed Effect release's declarations and the [effect-smol](https://github.com/Effect-TS/effect-smol) source, not from Effect 3 docs; on 2026-10-29 the driver was `@effect/sql-pg` with shared SQL contracts in `effect` itself. Don't add `pg`, `@types/pg` or Effect 3's separate `@effect/sql` package by habit. The fragment body names no module path or export; it describes the behavior and this lookup order.

**Tools/env/files:** Docker Compose and optional `pg_dump` only if a schema-dump command uses it; `DATABASE_URL`, `TEST_DATABASE_URL`, configurable ports, redacted credentials, SQL migrations, a scoped live database layer and schema-decoding repository in the platform-free core. Use the selected release's migrator APIs and document explicit migration commands; do not put migrations on every request/startup.

**Verification:** migrate a fresh run-owned database, exercise the real service through HTTP, reject invalid decoded rows, prove transaction rollback/constraint errors and scope cancellation/cleanup. Keep liveness independent from readiness. A later SQLite sibling uses `@effect/sql-sqlite-node` on supported Node plus inherited `effect/sql`, rather than forcing Drizzle or a native third-party driver into Effect projects.

### `drizzle-sqlite` (deferred): local persistence without Docker

Deferred until `drizzle-postgres` is benched and someone asks for Docker-free persistence. It must then declare `conflicts` with both Postgres fragments.

**Scope and priority:** was P1. `react-router`, `typescript-api`, `astro-fullstack`; a separately proven branch may cover `typescript-cli`. Workers use the existing D1 fragment. Desktop Rust persistence is a separate Rust concern.

**Direct dependencies:** default runtime `drizzle-orm`, `@libsql/client`; development `drizzle-kit`. Use the driver's local `file:` mode first. `better-sqlite3` with `@types/better-sqlite3` is an alternative implementation, not a second installed driver. Drizzle supports libSQL, `node:sqlite` and better-sqlite3; libSQL's local and remote transports make the explicit transport choice necessary. [Drizzle SQLite drivers](https://orm.drizzle.team/docs/get-started-sqlite).

**Configuration and files:** `DATABASE_URL` defaults to an ignored local file; optional `TURSO_AUTH_TOKEN` belongs only in a later remote extension. Server-only client, schema, SQL migrations, `db:migrate`, `db:generate`, `db:check`, backup/reset documentation. Confirm native installation and bundler behavior on each supported runtime.

**Verification:** migrate a fresh temporary file, round-trip data, enforce foreign keys, test rollback, reopen to prove persistence, delete only the temporary directory. Tests must not use the developer's database. No cloud request, token or Docker dependency.

**Composition:** select one database recipe for the proving slice. A future Turso vendor fragment can reuse this schema but must not turn a local-only verify into a remote write.

### `better-auth`: self-hosted browser authentication

**Scope and priority:** Batch 2. `applies_to: [nextjs, sveltekit]` with `requires: [drizzle-postgres]`; `nuxt` joins when it lands. `react-router` is an Effect host whose persistence owner is `effect-sql-postgres`, so it waits for the Batch 3 decision on an Effect-host auth variant. Leave Expo's existing Clerk flow alone. Better Auth documents a Next.js route handler and a SvelteKit hook; use the framework's documented integration rather than a generic catch-all.

**Direct dependencies:** runtime `better-auth`; database driver/ORM inherited through `requires: [drizzle-postgres]`. The React client is the `better-auth/react` export, not another package. Use the stable documented Drizzle adapter export rather than assuming an independently installed beta adapter. Auth schema generation uses Better Auth's documented CLI at implementation time. [Installation and database adapters](https://better-auth.com/docs/installation), [React Router integration](https://better-auth.com/docs/integrations/react-router).

**Configuration and files:** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`; server auth module, catch-all auth resource route, browser client module, session/current-user boundary, sign-in/sign-up/sign-out route, protected proving route, SQL migration. Default to local email/password so verification needs no OAuth tenant or email account; verification/reset email wiring is a subsequent `resend` integration. Document trusted origins, cookie flags, CSRF/origin behavior and session expiration.

**Verification:** local registration and sign-in, invalid password, missing/expired session, protected loader/action, sign-out revocation, ownership denial, production configuration failure. Browser tests use the real local auth handler and database, not a permanently signed-in mock.

**Composition:** alternative to Clerk/Supabase auth. The database `requires` is deliberately concrete. Add a SQLite variant or formally widen this contract later; do not claim either database works through an unexpressed OR relationship.

### `redis`: local cache and shared ephemeral state

**Scope and priority:** Batch 3. Explicit Node servers `nextjs`, `sveltekit`, `react-router`, `typescript-api`; `astro-fullstack` after a budget check; Python support via a later branch. Exclude Workers TCP clients. Owns the cache client and module; the Compose service follows the plan's lifecycle rule and is shared by name with `bullmq` when both are selected.

**Direct dependencies:** Node runtime `redis`; Python branch runtime `redis` from PyPI. Tools: Docker Compose. The server image is Redis by default; Valkey compatibility is a separately tested decision, not an automatic guarantee. The official Node client installs as `redis`. [Node client guide](https://redis.io/docs/latest/develop/clients/nodejs/).

**Configuration and files:** `REDIS_URL`, configurable local port, bounded connect/command timeout, run-specific test key prefix; Compose service and healthcheck; cache module/service with namespaced keys, TTL, JSON validation and a documented cache-aside proving example. Close clients on shutdown. Cache outages fall back only where the application explicitly permits it; auth or distributed limits must not quietly bypass enforcement.

**Verification:** real local SET/GET, expiration, invalid cached payload, unavailable server behavior, concurrent namespaces and connection cleanup. Delete exact test keys; never `FLUSHALL` a shared server.

**Composition:** cache capability does not require an ORM. Queue state and cache eviction policy must be separate, even when a developer runs them on one local server.

### `bullmq`: background jobs with retries

**Scope and priority:** Batch 3. Node servers above; no Workers, browser, compiled CLI or implicit Expo worker. `requires: []`: it owns a Redis Compose service under the shared service name, and reuses it if `redis` already added it, so a jobs project gets no cache module and no second Redis client.

**Direct dependencies:** runtime `bullmq` and `ioredis` (BullMQ's connection client). If `redis` is also selected, its cache client stays `redis`; don't merge the two clients. BullMQ documents Node/Bun execution, Redis-backed queues and worker connections. Validate the selected stable release before authoring around newer backend options. [Quick start](https://docs.bullmq.io/quick-start), [connection rules](https://docs.bullmq.io/guide/connections).

**Configuration and files:** `REDIS_URL`, queue prefix, queue name, bounded attempts/backoff, concurrency; `src/jobs/` producer/payload definitions, `src/worker.ts`, separate `worker` development/start command, Docker worker service only when deployment is selected. One harmless idempotent job proves delivery. HTTP enqueue returns a job id rather than waiting indefinitely.

**Verification:** a real worker consumes a local queued job; a transient failure retries; a permanent failure records a terminal state; duplicate delivery does not duplicate the effect; interrupt shuts down worker and clients. Use a private queue prefix and clean it precisely. Do not prove queues with the library's eager/in-process fake path alone.

**Composition:** optional independently deployed worker. No dashboard, cron product, cloud queue or Temporal abstraction in the first fragment.

### `s3-storage`: private object uploads and downloads

**Scope and priority:** Batch 3. Node server stacks above; Python branch later. Workers use `cloudflare-r2`. Local emulator: MinIO is the usual choice; recheck its image licensing and maintenance status at authoring time, with an S3-compatible alternative noted.

**Direct dependencies:** TypeScript runtime `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`; `@aws-sdk/lib-storage` only when multipart upload is actually shipped. Python later: `boto3`; async integration must account for its blocking calls. Tools: Docker for a local S3-compatible emulator, with the emulator choice and exact image reviewed during implementation. [AWS SDK presigner](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/), [multipart package](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html).

**Configuration and files:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; server-only storage service, signing endpoint, upload/download proving route, local emulator setup and test bucket lifecycle. Production should also support the SDK's ambient credential chain. Choose private buckets, server-generated keys, short-lived signatures, content-type/size policy and authenticated object ownership.

**Verification:** local put/get/delete, signed URL expiration/header behavior, denied ownership/path manipulation, bad content type, missing object, emulator teardown. Browser-upload support also verifies CORS. A mocked successful SDK call alone does not prove the protocol.

**Composition:** no database or auth vendor requirement. Accept the stack's current-user boundary; unauthenticated projects expose only a local proving fixture. Do not grant public production writes as a no-auth fallback.

### `resend`: transactional email with a local outbox

**Scope and priority:** Batch 3. Node server stacks above. Keep this an email transport fragment, not a newsletter app.

**Direct dependencies:** runtime `resend`; no React dependency for the default HTML/text template. Optional rich-template branch `react`, `react-dom`, `@react-email/components`, `@react-email/render`, and development `react-email` only when that branch is chosen. Resend's basic Node path needs its SDK, an API key and a verified domain for real delivery. [Node email guide](https://resend.com/docs/send-with-nodejs).

**Configuration and files:** `RESEND_API_KEY`, `EMAIL_FROM`, explicit `EMAIL_TRANSPORT=outbox|resend`; server-only mail service, template with both text and HTML, ignored local outbox, preview/readme instructions. Missing hosted credentials select the documented local transport in development, never pretend a message was externally delivered. In production, a requested hosted transport with missing credentials fails clearly.

**Verification:** template rendering/escaping, recipient and subject validation, outbox capture, provider rejection, idempotency policy and no key leakage. Tests stub only the Resend network boundary and never contact a recipient. Verified domain, sender and delivery smoke remain user setup.

**Composition:** compatible with auth/reset flows and jobs without requiring either. Email credentials do not belong in browser env prefixes.

### `stripe-checkout`: hosted payments with verified webhooks

**Scope and priority:** Batch 3. `applies_to: [nextjs, sveltekit]` with `requires: [drizzle-postgres]`; Effect hosts wait for the Effect-host persistence variant decision in Batch 3. A billing portal and recurring entitlement system should be a subsequent `stripe-billing` capability, not silently bundled into one-time checkout.

**Direct dependencies:** Node runtime `stripe`. Hosted redirect checkout does not require `@stripe/react-stripe-js` or `@stripe/stripe-js`; those belong to embedded/payment-element variants. Python branch later uses PyPI `stripe`. Optional external tool: Stripe CLI for a separate real sandbox exercise. [Hosted Checkout quickstart](https://docs.stripe.com/checkout/quickstart), [webhook management](https://docs.stripe.com/events/manage-webhook-endpoints).

**Configuration and files:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, server-owned price ids and allowed return origins; checkout creation route, raw-body webhook route, durable processed-event receipt table and order state, success/cancel pages for web hosts. Start with `requires: [drizzle-postgres]` to make durable idempotency explicit; API-only hosts need no browser package. No production price or customer data is invented.

**Verification:** SDK stub asserts server-controlled prices and idempotency key; signed fixture accepted using the real Stripe verifier; wrong signature/raw-body mutation rejected; duplicate/out-of-order webhook does not fulfill twice; success redirect alone never fulfills an order. Live payment tests are a separate, explicitly configured sandbox command.

**Composition:** auth can supply the current user but is not mandatory for guest orders. Avoid requiring one specific auth vendor. Billing later adds subscription synchronization, customer portal and entitlement transitions on the same persistence owner.

### `axe-checks`: automated accessibility scans in browser tests

Renamed from `accessibility`: an axe scan catches a subset of WCAG failures and doesn't establish compliance, so the id and name say what it runs. The name is "Axe accessibility checks".

**Scope and priority:** Batch 3. Only stacks that already ship Playwright: `react-router`, `python-react`, `cloudflare-react-router`, `astro-fullstack` (after a budget check), and the Batch 1 web stacks once their browser tests land. Not `astro-blog`: the audit decided it doesn't need a mandatory Playwright suite, and this fragment must not add one. Exclude native Expo accessibility.

**Direct dependencies:** development `@axe-core/playwright`; the stack's existing `@playwright/test`. Inherit the stack's browser installation, webServer lifecycle and e2e runner. Playwright documents the axe integration and explicitly notes that automated scans do not establish full accessibility compliance. [Accessibility testing](https://playwright.dev/docs/accessibility-testing).

**Configuration and files:** `e2e/accessibility.spec.ts`, a shared axe fixture, existing Playwright config extension, `test:a11y` command, manual keyboard/screen-reader checklist in project docs. Scan page, dialog/menu open, validation errors and signed-out state rather than just an empty home page. Record the standards/rule tags chosen.

**Verification:** run real browser scans plus focus order, keyboard dismissal and visible-focus assertions on the proving interaction. An intentionally broken test fixture proves the check detects a violation. No blanket exclusion, zero-rule scan or globally disabled rule as a shortcut.

**Composition:** optional test capability, no paid scanner or hosted account. Extend existing e2e commands rather than replacing them.

## Second-wave outlines (P2)

### `supabase` (deferred): local-first managed-backend integration

Deferred: it replaces the Batch 1 and 2 database and auth owners rather than adding to them, and its local stack's port isolation across worktrees needs its own design.

**Scope and priority:** was P2. Start with `react-router` and a prospective `nextjs`; explicit variants for SPA/mobile later. This can intentionally be a vendor suite because database, auth, storage and RLS share one local lifecycle; list exactly which of those surfaces the first recipe proves.

**Dependencies:** runtime `@supabase/supabase-js`, `@supabase/ssr` for SSR cookie handling; development/tool `supabase`; Docker-compatible runtime. Env: public project URL and publishable key using the host framework's public prefix; server-only secret/service key only for an explicitly required admin operation. Avoid deprecated auth-helper packages. [Local development](https://supabase.com/docs/guides/local-development), [SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

**Files and verify:** `supabase/config.toml`, SQL migrations/seed, generated database types, separate server/browser clients and current-user boundary. Run local database reset against a run-owned instance, actual signup/session flow, RLS tests with two users, type regeneration drift and private storage ownership if included. Test elevated-key code separately. No hosted project needed for normal verify.

**Boundaries:** alternative to the initial Drizzle+Better Auth combination. It must not start a duplicate Postgres container or create a second auth owner. The Supabase CLI's local project ports/isolation need particular attention for parallel worktrees.

### `prisma` (deferred): an alternative TypeScript ORM

Deferred: a second ORM for the same hosts as `drizzle-postgres` doubles persistence maintenance before either is proven. If added, it declares `conflicts` with both Postgres fragments.

**Scope and priority:** was P2. Start with `react-router`, then new Node SSR stacks; exclude Workers and Bun-compiled CLI until separately proven. This adds an ORM choice that differs in authoring and migration workflow from Drizzle.

**Dependencies:** runtime `@prisma/client`, `@prisma/adapter-pg`, `pg`; development `prisma`, `@types/pg`; Docker Compose. Env: `DATABASE_URL` and a distinct direct migration URL only if the selected hosted/pooler deployment needs it. Prisma documents runtime-specific driver adapters and a separate edge transport; do not use a TCP driver on an edge host. [Driver adapters](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers), [connection choices](https://www.prisma.io/docs/postgres/database/serverless-driver).

**Files and verify:** `prisma/schema.prisma`, committed migrations, generated-client output convention, current Prisma configuration, server-only client. Generate client, migrate an empty test database, round-trip/constraint/transaction tests, compare schema and migration state; teardown. Reuse a common local DB lifecycle only if one already exists. Do not `requires: [drizzle-postgres]`, which would install the competing ORM.

### `storybook`: component documentation and interaction tests

**Scope and priority:** P2. `python-react` frontend, `react-router` reusable client components, `tauri-react` mock browser surface. Next/Nuxt/Svelte require their documented framework adapters, not one generic React config.

**Dependencies:** development `storybook`, `@storybook/react-vite`, `@storybook/addon-docs`, `@storybook/addon-a11y`, `@storybook/addon-vitest`; inherit Vite, React, Vitest, and add the current documented Vitest browser provider/Playwright peer only when required by that installed addon version. Do not copy old standalone test-runner package assumptions. [React Vite setup](https://storybook.js.org/docs/get-started/frameworks/react-vite), [Storybook test integration](https://storybook.js.org/docs/writing-tests).

**Files and verify:** `.storybook/main.ts`, `preview.ts`, component stories for loading/error/empty/success, decorators for router/query providers and mock transport; `storybook`, `storybook:build`, `test:stories`. Build static output and execute a real story interaction and accessibility check locally. No Chromatic account by default. Keep browser and native component stories separate.

### `cloudflare-r2`: Worker-native object storage

**Scope and priority:** P2. `cloudflare-react-router` only initially.

**Dependencies:** no application SDK for the R2 binding; inherit Wrangler and Workers binding/test types from the stack. Optional S3 presigning branch needs AWS packages but should not be the default Worker binding path. Env/config: typed `BUCKET` binding, local bucket name/persistence, separate remote bucket prerequisite. [R2 Workers and S3 entry points](https://developers.cloudflare.com/r2/get-started/).

**Files and verify:** Wrangler binding, typed storage service, private object read/write/delete route and request limits; isolated local R2 tests and local server probe, missing object and ownership checks. Regenerate binding types. Cloud provisioning is a user action; no remote binding access during verify. This is an alternative host adapter to `s3-storage`, not a requirement on it.

### `renovate`: dependency update automation

**Scope and priority:** P2. Explicitly any stack whose actual lockfile ecosystem the selected Renovate release supports. Zero application runtime dependencies; optional development `renovate` for its config validator, or a pinned external validator image/tool.

**Files and verify:** `renovate.json5` with documented preset, update grouping by ecosystem, concurrency limits, lockfile maintenance, schedule/timezone and major-update review policy. Verify with the real configuration validator, plus a fixture ensuring each workspace is covered. Installing the hosted app or configuring a self-hosted token remains user setup. [Renovate configuration reference](https://docs.renovatebot.com/configuration-options/).

**Boundaries:** do not enable automerge before the project has trustworthy required checks. A GitHub-only `dependabot` alternative uses `.github/dependabot.yml`, no app dependency, and native schedule/ecosystem validation; select one updater. Check Bun and uv lockfile support at authoring time. [Dependabot configuration](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

### `ci-gitlab` (deferred): CI for a different repository host

Deferred: its pipeline can only be proven by a hosted GitLab runner, and no user has asked for it.

**Scope and priority:** was P2. Explicit branches matching `ci-github`'s supported stack scripts. No runtime package; optional YAML parser for local contract tests. External requirement: GitLab project and runner. Config: `.gitlab-ci.yml`, cache keys from lockfiles, lint/typecheck/tests/build stages, service dependencies and job artifacts. [GitLab quickstart](https://docs.gitlab.com/ci/quick_start/).

**Verification:** run the exact project commands locally, validate YAML and stack-specific job assertions, and record that only GitLab's CI lint plus a hosted pipeline prove runner integration. Do not call a locally parsed YAML document a green remote pipeline. Alternative to `ci-github`; use the same project check owner rather than duplicate CI logic.

### `openapi-client`: generated clients and contract drift checks

**Scope and priority:** P2 after inspecting overlap. `python-react` already owns Orval generation and should be extended or used as a model, not gain a duplicate fragment. Apply initially to `typescript-api`/`astro-fullstack` when they serve a schema and have a separate consumer; Hono's typed client is already appropriate in Expo.

**Dependencies:** choose one branch: development `orval` for generated request/query clients with runtime `@tanstack/react-query` when that client style is used; or development `openapi-typescript` plus runtime `openapi-fetch` for a smaller fetch client. Do not install both. An OpenAPI validator must support the schema version emitted by the host; Swagger Parser's older 3.0 scope must not silently claim 3.1 coverage. [OpenAPI TypeScript documentation](https://openapi-ts.dev/), [Orval documentation](https://orval.dev/).

**Files and verify:** checked-in schema/client, generator config, error adapter, `api:generate` and `api:check`; export schema locally without depending on a deployed server, regenerate to a temporary directory and compare. Test actual successful and error responses through the generated client. Preserve Effect's existing HttpApi contract rather than define a parallel Zod schema.

### `ai-sdk`: provider-neutral text, tools and structured output

**Scope and priority:** P2. Start Node servers `react-router`, `typescript-api`, `astro-fullstack`; no need for another chat app. It should work without `openrouter-ai` and should not rewrite that released fragment's provider contract.

**Dependencies:** runtime `ai`, `zod` only if the chosen SDK schema path needs it; install exactly the selected provider package (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, or another documented provider). `@ai-sdk/react` belongs only to a browser streaming UI variant. Env: provider key and model id, server-only; no model name frozen into the registry. The SDK documents separate provider packages behind a common model interface. [Provider catalog](https://ai-sdk.dev/docs/foundations/providers-and-models).

**Files and verify:** one provider construction module, service boundary, bounded generation/stream/tool example, cancellation and usage accounting, model-stub tests, missing-key behavior and deterministic structured-output assertion. No paid calls in ordinary verify. Verify installed SDK/provider peers together; provider capability parity must not be assumed.

## Later backlog with creation outlines (P3)

All deferred. These are useful extensions, but each needs its own narrow execution proposal before entering the bundled registry. `cloudflare-queues` is the exception and moves to Batch 4. Where an official page was not inspected in depth, treat the dependency list as an authoring starting point and recheck it before creating an entry.

| Candidate | Fit and direct dependencies | Files, external requirements and verification | Why later |
| --- | --- | --- | --- |
| `celery` | `python-react`, then `fastapi`/`django` proposals; runtime `celery[redis]`; Redis broker/result service | Worker module, tasks and routing, Compose worker, `CELERY_BROKER_URL`/`CELERY_RESULT_BACKEND`; test a real local worker, retry, idempotency and shutdown, not eager mode alone. [Celery first steps](https://docs.celeryq.dev/en/stable/getting-started/first-steps-with-celery.html) | Adds another worker runtime; implement after a reusable Python Redis branch. |
| `temporal` | Node servers; runtime `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`; development `@temporalio/testing` after verifying installed SDK guidance | Separate workflow/activity/worker modules; Temporal CLI local service, namespace/task queue/address; prove activity retry, replay/time behavior and shutdown. Node process boundary rather than claiming Bun parity. [TypeScript setup](https://docs.temporal.io/develop/typescript/set-up-your-local-typescript) | Durable orchestration is a different operational commitment from simple jobs. |
| `testcontainers` | Existing Node/Python DB recipes; Node dev `testcontainers`, selected module such as `@testcontainers/postgresql`; Python dev `testcontainers` with selected extra | Test fixture owns real mapped ports, migrations and teardown; Docker required; parallel and interrupted lifecycle tests. [Node quickstart](https://node.testcontainers.org/quickstart/usage/), [Docker Postgres guide](https://docs.docker.com/guides/testcontainers-nodejs-getting-started/) | Prefer an option on a database/service fragment until independent reuse justifies its own entry. |
| `pgvector` | Requires the selected Postgres recipe, not every ORM; extension-enabled Postgres image; optional language adapter only if needed | SQL `CREATE EXTENSION`, dimensioned embedding table/index, repository nearest-neighbor query; deterministic fixture vectors prove ranking and dimension checks without an embedding API. [pgvector project](https://github.com/pgvector/pgvector) | Add when retrieval is requested; avoid a full RAG framework as a database dependency. |
| `meilisearch` or `typesense` | Node servers: runtime `meilisearch` or `typesense`, one choice; local Docker service | Index schema, ingest/reindex command, server search route, admin/search key separation, port/url env; insert fixtures and prove search/filter/deletion through the real local engine | Useful product search, but two search engines would duplicate much of the maintenance. Choose from demand. [Meilisearch docs](https://www.meilisearch.com/docs), [Typesense docs](https://typesense.org/docs/) |
| `rate-limit` | Node server stacks, initially requires `redis` for shared atomic state; runtime `rate-limiter-flexible`, Redis client inherited | Identity-key extraction, trusted-proxy policy, bounded atomic increments, `429`/Retry-After, test clock/concurrency and cross-process enforcement; no keys stored indefinitely | Avoid conflating a cache with an authorization control; current API conventions alone do not implement it. [Library project](https://github.com/animir/node-rate-limiter-flexible) |
| `i18next` | React browser stacks; runtime `i18next`, `react-i18next`; optional locale detection package only if shipped | Locale resources, SSR/request-scoped language selection, HTML language/direction, missing-key check and browser locale-switch test; no machine translation key | Broad reuse, but defer until a concrete multilingual product proves SSR/hydration and fallback semantics. [React integration](https://react.i18next.com/) |
| `trpc` | Future TypeScript client/server pair using matching runtimes; runtime `@trpc/server`, `@trpc/client`, `@trpc/tanstack-react-query` and `@tanstack/react-query` for the modern React Query variant; `zod` if chosen for input validation | Router/context, auth/error boundary, typed consumer and real HTTP test | Alternative API architecture. Do not layer it onto Effect HttpApi or Hono just to add another library. [tRPC docs](https://trpc.io/docs) |
| `vercel` | Prospective Next.js first, then documented supported SSR/static adapters; dev/tool `vercel` | Framework deployment config only when needed; `VERCEL_TOKEN`, org/project ids for explicit CI; local production build first, preview/deploy smoke separately. [Vercel CLI](https://vercel.com/docs/cli), [deploy command](https://vercel.com/docs/cli/deploy) | Host support follows stack support; ordinary verify must not create deployments. |
| `fly-deploy` | Node/Python/Go servers with an existing container recipe; external `flyctl`, Docker build tooling | `fly.toml`, healthcheck, explicit release/migration command, worker process groups where selected; local image smoke, config validation, real deploy a separate user action. [Docker hosting](https://fly.io/docker/) | Compose with `docker-deploy` where it fits: that fragment builds images and publishes to GHCR, while rollout is explicitly a separate user-selected step. Avoid generating competing Dockerfiles. |
| `changesets` | A future publishable JS library/workspace stack; dev `@changesets/cli` | `.changeset/config.json`, release note workflow, local version/pack fixture and package-content checks; npm/OIDC publishing separate | Existing release fragments target binaries. A library stack should establish the package boundary before this fragment. [Changesets project](https://github.com/changesets/changesets) |
| `clerk-web` | React Router runtime `@clerk/react-router`; future Next.js runtime `@clerk/nextjs`; `@clerk/backend` only where a separate backend actually needs it | Session/current-user boundary, keyless public boot, production refusal, local verifier fixtures and protected route; `CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY` with the framework's public prefix where required, tenant/redirect setup separate | Retain `clerk` id and mobile scope. A new web surface or widening requires reviewed adapters and tests, not a broad auth tag. [React Router quickstart](https://clerk.com/docs/react-router/getting-started/quickstart) |
| `cloudflare-queues` | `cloudflare-react-router`; no application SDK for bindings; inherit `wrangler`, Node and Workers types/test integration | Typed producer binding, queue consumer entry, schema-checked messages, retry/dead-letter configuration in Wrangler; local producer-to-consumer assertion, failed-message retry and idempotency in isolated local persistence. No API token needed for local tests; queue/account provisioning is separate. [Queues setup](https://developers.cloudflare.com/queues/get-started/), [local development](https://developers.cloudflare.com/queues/configuration/local-development/) | Worker-native alternative to BullMQ; no Redis dependency. Local consumer concurrency differs from production and needs a separate deployed proof. |
| `cloudflare-durable-objects` | `cloudflare-react-router`; no application SDK; `cloudflare:workers` runtime import, inherited `wrangler`; dev `vitest` and currently documented `@cloudflare/vitest-plugin` only when not already present | Durable Object class export, namespace binding, class migration and per-object SQLite state; prove concurrent updates, independent ids, persistent vs in-memory behavior and reset with Workers runtime tests. No secret env required for local bindings; deploy credentials remain external. [Getting started](https://developers.cloudflare.com/durable-objects/get-started/), [runtime tests](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/) | Adds stateful coordination for a concrete product need; avoid claiming a generic Redis replacement. |
| `openfeature` | Node server stacks; runtime `@openfeature/server-sdk`; a selected vendor provider is optional, not all providers | Typed flag catalog, defaults and evaluation context behind one service; local in-memory provider first, tests for missing flags, context, type mismatch, provider failure and lifecycle. Browser branch would use `@openfeature/web-sdk` separately. [JavaScript SDK project](https://github.com/open-feature/js-sdk) | Separate from PostHog analytics. Add when teams need feature rollout controls rather than quietly installing a second analytics SDK. |
| `npm-publish` | Future JS library stack; Node/npm tools, optional dev `@changesets/cli` via the release-note fragment; no app runtime dependency | Package exports/files metadata, tarball build/install-consumer tests, `.github/workflows/release.yml` with trusted-publisher identity; OIDC `id-token: write`, package/project registration is user setup. Local pack/content/import tests never publish. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) | Complements a library stack and Changesets. `bun-release` publishes compiled binaries, which does not cover npm library packaging. |
| `pypi-publish` | Future Python library/CLI stack; build backend inherited, dev `build`, `twine` if using its distribution checks; uv/Python tools | Wheel/sdist and metadata configuration, isolated install/import smoke, `twine check`, release workflow using PyPI Trusted Publishing/OIDC and an explicitly registered project/environment. No API token or real upload in verify. [PyPI trusted publishing](https://docs.pypi.org/trusted-publishers/) | Add after a reusable Python package stack establishes the artifact contract; distinct from deploying FastAPI. |

## Authoring and proof requirements

Each selected proposal becomes one fragment plus its draft search card, guidance/adapters and tests following the loaded authoring skills. Do not set card `reviewedAt`, approve or restamp a card as part of agent authoring. Propose golden judgments and have maintainers review them. Add a stack's optional-fragment offer only when its composed brief, file plan, env names, commands and verification steps agree.

For every admitted stack, prove composition with current default fragments and common combinations. The most important combinations are database+auth, auth+email, database+payments, cache+jobs, storage+auth and browser tests+Storybook. `drizzle-postgres` with `effect-sql-postgres` must fail composition through `conflicts`. Check for duplicate commands, competing service owners, Compose names/ports, env-file collisions, SSR/browser secret leakage and stale migration/code generation.

Bench at least one fresh project per genuinely different runtime adapter. A composition-only test does not establish that a generated app works. Capture dependency/toolchain choices and intervention count in the run note, update the registry ledger through the normal workflow, and leave remote account setup explicit. No package installation, hosted service provisioning or paid request was performed for this research.
