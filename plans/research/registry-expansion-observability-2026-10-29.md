Status: REVIEWED 2026-10-29. `effect-otlp` is Batch 1 (in progress, server stacks only); `sentry-web`, `sentry-python`, `opentelemetry-python` and `grafana-lgtm` Batch 2; `pino`, the Workers and Go logging baseline edits and `opentelemetry-go` Batch 4. `prometheus-node`, `prometheus-python`, `prometheus-go`, `sentry-expo`, `k6` and the `typescript-cli` export branch are deferred. Batches live in [the plan's delivery order](../registry-expansion.md#delivery-order).

# Registry expansion: logging and observability research

Add trace export, a local backend and error reporting before adding more logging
libraries. Most existing server stacks already have structured logging. This report
is a dependency-level proposal for authoring agents, checked against the registry
and official sources on 2026-10-29. It does not claim the proposed combinations have
passed a project bench.

Package lists below are direct application/build/test dependencies. Transitive
dependencies stay with the package manager. Versions, generator flags and changing
configuration syntax must be checked again when an entry is authored.

## Existing coverage and boundaries

- `python-react` already declares `structlog`, request-context binding and request
  IDs. Improve that contract rather than installing a second Python logger.
- `typescript-api`, `react-router`, `astro-fullstack` and `typescript-cli` already
  own Effect logging. Pino is a separate choice for non-Effect servers.
- `posthog` already adds browser product analytics, with no account needed for
  tests. Error reporting, distributed tracing, server metrics and operational log
  shipping are separate capabilities.
- [The stack audit](../stack-audit-2026-10-29.md), task 8, already proposes
  `dev-logs`: extract the identical `scripts/logs.ts` and `scripts/dev-logs.ts`
  from the two Effect API stacks. Reuse that work; do not create a competing
  development-log fragment here.

Implementation order: `effect-otlp`; then `opentelemetry-python` and
`grafana-lgtm` together, so the backend lands with two SDKs that can send to it;
`sentry-web` and `sentry-python`; then Pino. Prometheus, `sentry-expo` and `k6`
are deferred (see the table). These priorities are judgments about coverage and reuse, not
claims about measured registry demand. Official SDKs and maintained integrations
establish feasibility; they do not establish a popularity ranking.

| Candidate | Priority | Initial compatibility | Dependency boundary |
| --- | --- | --- | --- |
| `effect-otlp` | Batch 1 | `typescript-api`, `react-router`, `astro-fullstack` | Existing Effect runtime; OTLP modules from the installed major |
| `opentelemetry-python` | Batch 2 | `python-react`, `python-api` | Python SDK, HTTP exporters and targeted instrumentation |
| `grafana-lgtm` | Batch 2 | Stacks with an OTLP SDK fragment: the three Effect servers, `python-react`, `python-api` | Docker/Compose and the Grafana development image |
| `sentry-web` | Batch 2 | `react-router`, `nextjs`, `sveltekit`, `astro-blog`; `react-vite` once it lands | Framework-specific Sentry SDK and source-map build integration |
| `sentry-python` | Batch 2 | `python-react`, `python-api` | Python Sentry SDK |
| `pino` | Batch 4 | `mobile-expo` API | Pino runtime; pretty printer only in development |
| Workers observability | Batch 4, baseline edit | `cloudflare-react-router` | Native platform collection |
| Go structured logging | Batch 4, baseline edit | `go-cli` (`go-api` ships slog already) | Standard library only |
| `prometheus-node` | Deferred | Long-running Node servers | Effect's OTLP metrics already cover Effect hosts; no non-Effect Node server needs scraping yet |
| `prometheus-python` | Deferred | Python APIs | OTLP metrics through `opentelemetry-python` cover the first need |
| `sentry-expo` | Deferred | `mobile-expo` app | Proving crash capture needs a native build, a device and an account; local verify can't |
| `k6` | Deferred | HTTP stacks | External tool, no host or proof plan; revisit with a concrete performance requirement |

## Instrument Effect applications with OTLP

**Proposed id:** `effect-otlp`. **Category:** tooling. Explicit `applies_to`
IDs: `typescript-api`, `astro-fullstack` and `react-router`. The `typescript-cli`
branch is deferred: a short-lived CLI needs a flush-before-exit design and a
stdout/JSON purity proof that the server branches don't, and nobody has asked
for CLI traces. `astro-fullstack` and `typescript-api` have about 700 words of
default-preset headroom; measure both presets before admitting them.

**Dependencies.** Reuse existing `effect` and the stack's existing Node platform
package; no new npm package is expected. Research notes (for the author, never
for the fragment body): on 2026-10-29 the installed Effect 4 exported OTLP
tracer, logger, metrics and serialization layers from `effect/observability`,
which earlier Effect 4 prereleases placed under `effect/unstable/observability`.
That move is the reason the fragment states behavior plus a lookup order and
names no module or export: the installed package's declarations, then its
`ai-docs/` observability examples, then the Effect 4 source in
[effect-smol](https://github.com/Effect-TS/effect-smol). Do not add Effect 3's
`@effect/opentelemetry` to an Effect 4 project.

**Integration.** Add one platform-owned `observability.ts` layer; business code
continues using Effect spans, metrics and log annotations. Trace the actual HTTP
request boundary and one service operation. Propagate W3C context on outbound
requests. Attach service name/version/environment and trace IDs to existing logs.
Preserve the stack's safe-error and request-ID conventions. On `react-router`
and `astro-fullstack` only the server process is instrumented; no exporter
config or endpoint reaches a browser bundle.

**Configuration.** Document the supported subset of `OTEL_SERVICE_NAME`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, resource attributes
and sampling. Effect export configuration may require explicit parsing; do not
promise every standard OTel environment variable works. Endpoint absent means no
exporter and no remote attempt. Bound queues and export timeouts; flush within
the runtime's shutdown scope.

**Verification.** Record parent/child spans with an in-memory tracer. Check failed
request status, isolation between concurrent requests and graceful shutdown. A
loopback OTLP receiver (a small in-test HTTP server on an ephemeral port, not a
container) must receive a synthetic trace. An unavailable receiver must not fail
the request. With the endpoint unset, no exporter is constructed.

**Composition.** No hard `requires: [effect]`: the existing fragment adds testing
and guidance while these stacks already own runtime Effect. `grafana-lgtm` is
optional. If Sentry is also selected, start Sentry with error capture only; one
integration must own automatic tracing.

## Instrument the Python API with OpenTelemetry

**Proposed id:** `opentelemetry-python`. **Category:** tooling.
`applies_to: [python-react, python-api]`; `requires: []`. Lands in the same
batch as `grafana-lgtm`.

**Runtime dependencies:** `opentelemetry-api`, `opentelemetry-sdk`,
`opentelemetry-exporter-otlp-proto-http`,
`opentelemetry-instrumentation-fastapi`,
`opentelemetry-instrumentation-httpx`. Add
`opentelemetry-instrumentation-sqlalchemy` only for the composition that uses
SQLAlchemy through `postgres`. Existing pytest dependencies suffice for tests.
Official docs verify [FastAPI instrumentation](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/fastapi/fastapi.html)
and [Python exporter choices](https://opentelemetry.io/docs/languages/python/exporters/).

**Integration.** `backend/app/observability.py` constructs providers per app
factory/lifespan. Instrument the created app, not a global import-time singleton.
Keep structlog and add trace/span IDs through a processor. Instrument HTTPX and
conditionally SQLAlchemy. Exclude health and metrics endpoints. Recheck the
[current FastAPI OTel setup](https://fastapi.tiangolo.com/advanced/opentelemetry/)
before choosing framework initialization versus manual initialization; using both
would duplicate instrumentation.

**Configuration.** `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_TRACES_SAMPLER`,
`OTEL_TRACES_SAMPLER_ARG`, optional `OTEL_RESOURCE_ATTRIBUTES`. Explicitly disable
network export without an endpoint. Never put exporter credentials in frontend
variables.

**Verification.** Use the SDK's in-memory span exporter for parentage, exception
status and app-lifecycle tests. Run concurrent requests to detect context leaks.
Check provider shutdown and no network with normal test settings. Use a local
receiver for a small export test. No cloud account is needed.

## Add a local Grafana observability backend

**Proposed id:** `grafana-lgtm`. **Category:** tooling. Admit only stacks with
an OTLP SDK fragment: `typescript-api`, `astro-fullstack`, `react-router`,
`python-react` and `python-api`. `mobile-expo` is excluded until something on
its Hono API exports OTLP. It supports a development workflow, not a production
hosting claim. Its verify contributes only Docker-free checks (Compose config
validates, ports are project-derived); the ingestion check is an explicit
`telemetry:check` command, per the plan's service lifecycle rule.

**Dependencies/tools.** No application package. Require Docker with Compose.
Use `grafana/otel-lgtm`, which provides a local Collector/Grafana/Loki/Tempo/
Prometheus bundle. The agent chooses a current image tag during setup and records
it in the project. [Official development backend](https://github.com/grafana/docker-otel-lgtm).

**Integration.** Add a separately named Compose file/profile, dashboard
provisioning, endpoint examples and start/stop/status commands. Bind dashboard and
OTLP ports to loopback. Use a project-owned Compose name and configurable host
ports. The dashboard's usual 3000 port collides with several stack defaults;
choose another host port. OTLP HTTP normally uses 4318.

**Configuration.** Local OTLP endpoint in `.env.example`; project/port overrides
for concurrent benches. No cloud credentials. Do not require one particular SDK
fragment: the registry has no one-of dependency expression for Effect/Python/Node
instrumentation. Explain the instrumentation prerequisite and prove at least two
representative compositions.

**Verification.** Wait for readiness, emit a synthetic trace and metric, then
query the backend to prove ingestion. Teardown targets only this project's
containers/volumes. Ordinary application unit tests remain Docker-free. Resource
cost and image download time belong in the search card's caveats.

## Add Sentry web error reporting

**Proposed id:** `sentry-web`. **Category:** vendor. Explicit initial IDs:
`react-router`, `nextjs`, `sveltekit`, `astro-blog`, plus `react-vite` when it
lands. `python-react`'s React SPA and `astro-fullstack` join after a budget
check (`astro-fullstack` has about 700 words of headroom). Four framework SDKs
in 1,000 words is tight: if the branches stop sharing most of their text, split
into `sentry-web` (shared contract) plus per-framework notes under `files/docs/`.

**Runtime dependencies by branch:** `@sentry/react-router` for React Router
framework mode, `@sentry/nextjs` for Next.js, `@sentry/sveltekit` for SvelteKit,
`@sentry/react` for the React SPA, `@sentry/astro` for Astro.
**Build dependency:** `@sentry/vite-plugin` only where the framework SDK does not
already own source-map upload integration. Do not install all SDKs in every
project. The [official SDK repository](https://github.com/getsentry/sentry-javascript)
and [routing migration guidance](https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md)
distinguish framework and SPA integration.

**Integration.** Add framework-specific client/server initialization and the
existing root error boundary. DSN absent means disabled. Start with replay and
performance collection off. Preserve the stack's HTTP envelope; capture an
unhandled error once. Scrub authorization, cookies, request bodies and user text.

**Configuration.** Framework-visible DSN where needed, server DSN where needed,
`SENTRY_ENVIRONMENT` and a consistent release identifier. `SENTRY_ORG`,
`SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` are build/CI settings; the token never
reaches the client. Source-map upload runs only with credentials; public output
must follow the chosen private-map policy.

**Verification.** A custom/in-memory transport receives one deliberate error
with expected release/environment. Blank DSN sends nothing. A scrubber test uses
seeded secret fields. Production build succeeds without upload credentials.
Credentialed release upload and dashboard visibility are separate deployment
acceptance evidence.

**Composition.** `requires: []`; CI integration is conditional on `ci-github`.
If an OTel fragment owns traces, keep Sentry errors-only until a deliberate shared
provider integration is proved.

## Add Sentry Python error reporting

**Proposed id:** `sentry-python`. **Category:** vendor.
`applies_to: [python-react, python-api]`; `requires: []`.

**Runtime dependency:** `sentry-sdk[fastapi]`. No new test dependency. The
[official Python SDK](https://github.com/getsentry/sentry-python) supplies FastAPI
support.

**Integration/configuration.** Initialize from explicit settings in the existing
FastAPI factory/lifespan. One boundary owns reporting; do not capture through both
logging and the exception handler. Use `SENTRY_DSN`, `SENTRY_ENVIRONMENT`,
`SENTRY_RELEASE`. Disable PII/body collection and leave tracing off when OTel
owns it. Preserve existing sanitized error responses.

**Verification.** Custom SDK transport asserts exactly one captured exception,
sanitized payload and correct release identity. Blank DSN causes no network or
import-time side effects. Live project creation is a pending user action rather
than a prerequisite for tests.

## Add Pino to non-Effect servers

**Proposed id:** `pino`. **Category:** tooling. Initially
`applies_to: [mobile-expo]`, API branch only. Admit future plain Node APIs after
benching. Exclude Effect-owned logging stacks initially.

**Runtime dependency:** `pino`. **Development dependency:** `pino-pretty`.
The first Hono integration should use explicit middleware with existing Hono
request-ID support. Consider `hono-pino` only after a separate compatibility and
maintenance check; it is not a required dependency in this proposal.
`pino-http` belongs only to a Node `IncomingMessage` server branch and must not be
copied onto Bun/Hono's fetch request surface. [Pino documentation](https://getpino.io/)
and [pino-http API](https://github.com/pinojs/pino-http).

**Integration.** `apps/api/src/logging.ts` owns logger configuration. Middleware
validates/generates request ID, echoes it and logs route pattern/status/duration.
Log defects once. Production emits JSON stdout; development may pretty-print.
No application file sink by default. Use explicit serializers and Pino's
[built-in redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md)
without adding an obsolete redaction package.

**Configuration.** `LOG_LEVEL`, `NODE_ENV`; inject writable sink and deterministic
IDs/clock in tests. Redact authorization, cookies, passwords and tokens.

**Verification.** Parse emitted JSON, assert secret omission, level filtering,
request isolation, one completion record/error and graceful flush. Prove the
Bun API process works with the selected transport configuration.

## Expose Prometheus metrics (deferred)

Deferred: OTLP metrics through `effect-otlp` and `opentelemetry-python` cover
the first need, and a second metrics pipeline on the same hosts has no current
requester. The outline stays for when someone needs a scrape endpoint.

Prefer Effect-to-OTLP metrics for existing Effect stacks. For Prometheus scraping,
the installed Effect package also exports `PrometheusMetrics` from
`effect/observability`, with formatting and HTTP layer support. Use that native
path on Effect hosts so existing instruments retain one owner. Offer direct
Prometheus clients for non-Effect runtimes.
Prometheus documents its [client libraries](https://prometheus.io/docs/instrumenting/clientlibs/)
and [label/instrumentation practices](https://prometheus.io/docs/practices/instrumentation/).

### Node

**Proposed id:** `prometheus-node`. **Category:** tooling. Explicit initial IDs:
`typescript-api`, `astro-fullstack`, `react-router`, `mobile-expo`, server branches
only. **Runtime dependencies:** existing `effect` on Effect hosts, using its
`PrometheusMetrics` export; `prom-client` on the non-Effect `mobile-expo` API.
Existing Vitest stack supplies tests.
[Official Node client](https://github.com/prometheus/client_js).

Create a per-runtime registry and `GET /metrics` route. Record request counter and
duration histogram using method, route template and status class. Never use raw
URLs, request IDs or user IDs as labels. Keep the endpoint internal/private and
exclude health/metrics from request instrumentation. Document bind/access policy;
an application-specific environment switch can disable the route.

Verify content type, parsed counter increment, histogram observations, bounded
labels and separate registries for two app factories. Add `promtool` only if the
fragment also ships Prometheus server configuration or alert rules.

### Python

**Proposed id:** `prometheus-python`. **Category:** tooling.
`applies_to: [python-react]`; `requires: []`. **Runtime dependency:**
`prometheus-client`, using its ASGI integration plus explicit middleware. Avoid
adding an extra FastAPI convenience package before its value is demonstrated.
[Official Python client](https://github.com/prometheus/client_python).

Use the same metric/label contract as Node. Make the registry app-owned for tests.
Explicitly document multi-worker collection if deployment enables multiple
workers; a single-process fixture does not prove it. Verify the ASGI route and
registry isolation under pytest. Multiprocess support needs its own process-level
test before it is claimed.

## Report Expo crashes (deferred)

Deferred: its only meaningful proof needs a native build, a device and a Sentry
account, so ordinary verify can't establish it.

**Proposed id:** `sentry-expo`. **Category:** vendor.
`applies_to: [mobile-expo]`, app branch only; `requires: []`.

**Runtime dependency:** `@sentry/react-native`; use existing Expo/Metro toolchain.
Add `expo-updates` only when update identity is actually configured. EAS tooling
is optional unless the chosen native-build flow uses it. Expo's
[official guide](https://docs.expo.dev/guides/using-sentry/) covers the SDK,
configuration plugin, source maps and update integration.

Add Expo config plugin, Metro setup and app-root initialization. Use
`EXPO_PUBLIC_SENTRY_DSN`; keep `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and
`SENTRY_PROJECT` in build-secret settings. Match release/build/update identity.

Verify blank-DSN behavior and Expo config/build locally. A native development or
release build must prove crash capture and symbolication. Expo Go/browser success
cannot stand in for native-crash evidence. Device/account/build steps are explicit
pending acceptance work when unavailable.

## Improve native Workers observability

Prefer extending the `cloudflare-react-router` baseline when the change is only
native configuration. A proposed `workers-observability` fragment earns a separate
entry only if it adds independently useful sampling, export configuration and
verification guidance.

**Dependencies:** existing Wrangler and Cloudflare runtime; no additional Node
SDK. A later Sentry branch would use `@sentry/cloudflare`, plus `@sentry/react`
only for browser capture, and requires a separate integration proof. Native
[Workers observability](https://developers.cloudflare.com/workers/observability/)
and [Grafana OTLP export](https://developers.cloudflare.com/observability/export/opentelemetry/grafana-cloud/)
are supported platform paths.

Own the Wrangler observability patch, sampling choice and correlated structured
events. Local tests prove emitted events and configuration. Cloud ingestion and
dashboard visibility require a deployed worker; report those as deployment
acceptance, not a local pass. No filesystem log sinks or Node exporter assumptions.

## Improve Go logging with the standard library

Prefer a `go-cli` baseline improvement over another fragment unless users need
this independently. A proposed `slog` fragment has `applies_to: [go-cli]`, later
extended to a Go API.

**External dependencies:** none. Use `log/slog`, `encoding/json`, `io` and
`context` from the standard library. `internal/logging` returns an injected
`*slog.Logger`; `JSONHandler` for machine logs, `TextHandler` for readable stderr.
The [standard package](https://pkg.go.dev/log/slog) provides the runtime API.

Keep stdout owned by command output. Explicitly select levels and safe attributes;
use `LogValuer` or attribute replacement for sensitive values. Verify JSON/stderr
separation, filtering and secret omission with an in-memory writer. Zap/Zerolog
would be alternatives justified by a specific requirement, not extra defaults.

## Add an opt-in HTTP load smoke (deferred)

Deferred: an external tool with no host stack chosen and no performance
requirement to prove.

**Proposed id:** `k6`. **Category:** tooling. Start with explicit server-stack
IDs; extend as new server stacks are benched. `requires: []`.

**Tool:** external `k6` executable or official `grafana/k6` container. No npm
runtime dependency. Script imports are built-in `k6/http`, `k6` and `k6/metrics`.
Optional development package `@types/k6` supplies editor declarations.

Add `tests/load/smoke.js` and an opt-in `test:load` command. `BASE_URL` points at
an owned local test server by default. Use short duration/low concurrency for
verification and explicit manual profiles for real load. Data setup/cleanup uses
owned fixtures only. Define error-rate and response thresholds; checks alone do
not necessarily fail the process. [Official k6 threshold behavior](https://grafana.com/docs/k6/latest/using-k6/thresholds/).

Verify that a healthy target passes and an intentional threshold breach returns
nonzero. Keep meaningful performance budgets separate from brittle timing limits
on shared CI hosts.

## Later dependency outlines

These become candidates when their host stacks exist. They still need a fresh
implementation contract and compatibility proof.

| Candidate | Direct runtime dependencies | Host and proving slice |
| --- | --- | --- |
| `opentelemetry-node` | `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/sdk-metrics`, installed release's trace SDK, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-metrics-otlp-http`; targeted instrumentation or `@opentelemetry/auto-instrumentations-node` | Future plain Node/Fastify/Nest API; preload before application imports, prove propagation and export in the actual packaged ESM process |
| `opentelemetry-go` (Batch 4) | `go.opentelemetry.io/otel`, `go.opentelemetry.io/otel/sdk`, `go.opentelemetry.io/otel/sdk/metric`, `go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp`, `go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp`, `go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp` | `go-api`; context propagation through HTTP client/server, span failure, bounded shutdown and local OTLP export |
| `prometheus-go` (deferred) | Module `github.com/prometheus/client_golang`; imports `prometheus` and `prometheus/promhttp` below that module | Future Go API; private metrics endpoint, isolated registry, histogram/counter observation and bounded label cardinality |

The [Node getting-started guide](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)
and [exporter guide](https://opentelemetry.io/docs/languages/js/exporters/) identify
the SDK/exporter split and ESM initialization constraints. Exact trace-SDK
packaging is release-sensitive, so the author must resolve that direct dependency
from the selected installed SDK rather than freeze an old package name.

The [Go exporter guide](https://opentelemetry.io/docs/languages/go/exporters/)
documents OTLP packages and notes that `OTEL_SDK_DISABLED` is not automatically
supported by the Go SDK. Provide an explicit application disable switch. The
[Prometheus Go guide](https://prometheus.io/docs/guides/go-application/) verifies
the metrics handler dependency.

## Deferred ideas requiring separate research

These are not author-ready entries and are not included in an implementation
commitment.

- Grafana Cloud, Honeycomb, Axiom, Better Stack, Datadog and New Relic: first
  consider OTLP endpoint recipes within instrumentation guidance. Separate entries
  need a distinct deliverable such as a collector, dashboard or deployment
  integration. [Grafana's OTLP ingest](https://grafana.com/docs/opentelemetry/ingest/)
  confirms the standard-endpoint approach for that provider; the other providers
  need their own fresh source and dependency review.
- Loki/Alloy host log shipping: likely useful beside `docker-deploy`; research the
  current `grafana/alloy` image, configuration format, permissions, file/container
  discovery and project-owned lifecycle before proposing a fragment. This is host
  operations work and should not depend on a particular application logger.
- Sentry for Tauri: research Rust/native crash capture and symbolication, release
  packaging and browser/native ownership. A React-only recipe cannot claim native
  desktop crash coverage.
- OpenFeature/feature flags and uptime checks: useful separate capability areas;
  neither follows automatically from PostHog analytics or OTLP tracing. Research
  providers, direct dependencies and local verification before choosing entries.

## Requirements for an authoring handoff

Each accepted candidate needs the fragment skill's complete body, durable files,
portable agent guidance, draft search card and explicit compatibility list. Keep
cloud keys optional for local verification. Add entry-specific verify steps that
prove the capability, then run a fresh bench for each claimed runtime surface.

For every composition, name the owner of logs, traces, metrics and error capture.
Installing two SDKs must not produce duplicate request spans or duplicate error
events. Test graceful shutdown and unavailable backends. Record credentialed
production checks separately from locally proven behavior.
