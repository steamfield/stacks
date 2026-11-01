# stacks-api architecture review and RFC

Date: 2026-10-31. Status: EXECUTED 2026-10-31 on stacks-api `refactor/api-architecture`, merged to its `main`. A5 landed differently from the text below: the stub npm client stays in `platform/maintenance.ts` (`maintenanceWithVersions`, now built on the shared `maintenanceWith`), because a tagged seed test (`tests/seed-entry-acceptance.test.ts`, 4.2g#10) forbids any network client in the seed's source. A code review of the branch also moved the rule text to name the migration runner as the one SQL outside `store/` and the pure reconcile and flag functions kept beside their queries.

Repository: `stacks-api`, the hosted API's separate checkout, reviewed at `fix/effect-error-audit` (the Effect error-handling fixes, which change no module boundaries). Scope: `apps/api/src` and `packages/contract/src`, with a lighter look at `apps/web/src`, the seed scripts and how they reach the API. Lens: the `ce:architecting-systems` Structure, Coupling and Boundaries references, with the repo's own rules taking precedence (`AGENTS.md`, `.claude/rules/api/effect-api.md` "Where a resource's pieces go" and "Services and the runtime").

## Assessment

The repo is well organized, and nothing here calls for restructuring. The workspace boundaries are real and enforced: the contract imports only `effect` and `@steamfield/stacks-format`, the site never imports the API, and `biome-plugins/boundaries.grit` confines runtime imports, `process`, `fetch`, `Config.*`, ambient time and `Effect.run*` to `platform/` and `config.ts`, each rule probed by a hook test. The API follows one resource layout (contract group → handler → service → store → migration → test) that `effect-api.md` documents and the three resources (events, stats, search) follow. Handlers are thin, services yield their dependencies once in the layer, and every route is tested through real HTTP on both a Node listener and a web handler.

What drifted is local, and the proposals below are moves, not a redesign. The most useful one is A1: SQL the rules place in `store/` lives in `integrity/`, and nothing enforces where SQL or the database driver may be imported. The rest put a cross-cutting port where readers will look for it, remove a duplicated function, and keep seed-only code out of a production module.

The directory graph has cycles (`store ↔ integrity`, `store ↔ stats`, `store ↔ maintenance`, `stats ↔ maintenance`), and most of them come from edges the layering intends: a store importing the domain types it returns, and orchestration in `integrity/index.ts`, `integrity/recheck.ts` and `stats/rollup.ts` calling stores. Removing them would mean splitting orchestration out of the domain directories, which isn't worth it (see "Out of scope"). Only A3 removes one (`stats ↔ maintenance`); no proposal is justified by cycles.

## How the API is layered today

Measured from imports in `apps/api/src`:

| Directory | Role per `effect-api.md` | Imports from |
| --- | --- | --- |
| `handlers/` | presentation | `services/`, `stats/cache.ts`, and (health only) stores and `integrity/policy.ts` |
| `services/` | application | `store/`, `stats/`, `ingest/`, `maintenance/names.ts` |
| `ingest/` | pure rules | nothing in `src/` |
| `stats/` | pure rules, `rollup.ts` orchestration, two I/O modules | `store/` (including `errors.ts`), `ingest/`, `integrity/policy.ts`, `maintenance/names.ts`, `config.ts` |
| `integrity/` | pure rules, orchestration, and five SQL modules | `store/`, `ingest/` |
| `store/` | SQL repositories | `ingest/`, `stats/`, `integrity/`, `maintenance/archive.ts` |
| `maintenance/` | scheduled orchestration | `store/`, `stats/`, `integrity/`, `ingest/` |
| `platform/` | Node entry and adapters | everything it wires |

## Proposals

Each is behavior-neutral; the existing suites are the regression check, run before and after.

### A1. SQL lives in `store/`, and lint keeps it there

`effect-api.md` says domain logic is "pure rules as plain functions in the domain's own directory (`ingest/`, `stats/`, `integrity/`)" and that the store is "the repository: interface in domain types and a `sql` layer that requires only `SqlClient`". Five integrity modules take a `SqlClient` and run SQL: `integrity/exclusions.ts` (`reconcile`, 14 statements), `flags.ts` (`writeFlags`, `rewriteEventFlags`, 12), `installs.ts` (2), `metrics.ts` (2) and `sequence.ts` (1). `store/integrity.ts` wraps three of them. `stats/names.ts::currentNames` (two statements, called only by `store/stats.ts`) is the one other SQL outside `store/` and `platform/`.

Move:

- The five modules go to `store/` under the flat prefix the store already uses for non-store SQL helpers (`integrity-evidence.ts`, `stats-selection.ts`, `projects.ts`): `store/integrity-exclusions.ts`, `integrity-flags.ts`, `integrity-installs.ts`, `integrity-metrics.ts`, `integrity-sequence.ts`.
- `AnomalyFlag` (schema and type) moves from `flags.ts` to `integrity/flags.ts` as its only content, since `integrity/alert.ts` uses it and the store imports it from there.
- The pure functions inside the moved modules stay with their SQL on purpose: `exclusions.ts::baseCandidates`, `exclusionCandidate` and the branching in `reconcileRow`, and `flags.ts::healthFlags` and `datedFlags`, each read query results in the same transaction, and pulling them apart would add an interface between a query and the one function that reads it. `integrity/policy.ts` keeps every threshold they use.
- `currentNames` moves into `store/stats.ts`.
- `integrity/` keeps `policy.ts`, `alert.ts`, `flags.ts` (now the schema), and the orchestration in `index.ts` and `recheck.ts`.
- Importers outside `src`: `apps/api/scripts/unseed.ts` (`rewriteEventFlags`, `writeMetrics`). No test imports a moved module.

Enforce, in `biome-plugins/boundaries.grit` with the same `apps/api/src` filename scope as the existing rules:

- `effect/sql` and its subpaths only under `apps/api/src/store/` and `apps/api/src/platform/` (`platform/migrations.ts` and `sqlite.ts` qualify). Matching `import type` too is intended.
- `@effect/sql-*` driver packages only under `apps/api/src/platform/`. Today the runtime-import rule matches only `@effect/platform-*`, so "Nothing outside `api/platform/` opens a database" in `effect-api.md` is unenforced.
- Probes: a denied row (`apps/api/src/services/sample.ts` importing `effect/sql`) and permitted rows for `store/` and `platform/` in the second `it.each` of `tests/hooks/boundaries-lint.test.ts`, plus a denied driver import from `store/`. `.claude/hooks/guard-boundaries.ts` mirrors only some Grit rules; this one stays lint-only, like the time and run rules.

Docs: the AGENTS.md architecture-map lines for `integrity/` and `store/` and the "Code structure" Grit bullet; `apps/api/README.md` "Layout" rows for `src/store/` and `src/integrity/`; `apps/api/tests/fixtures/integrity/README.md`, which cites `src/integrity/flags.ts`; and `effect-api.md` cites the new rule beside "Nothing outside `api/platform/` opens a database".

### A2. Pure stats code doesn't get its types or rules from the store

`stats/recompute.ts` imports `type StatsEvent` and `stats/markers.ts` imports `type StatsSnapshots` from `store/stats.ts`. The reverse misplacement sits in the same file: `store/stats.ts::collectProjects` is a pure stats rule over `StatsEvent`, and the seed's compute module (`scripts/seed/rollup-compute.ts`) imports it from the store.

- `StatsEvent` and `collectProjects` move to `stats/` together (`stats/model.ts` for the type; `collectProjects` beside the code that uses it).
- `markers.ts` declares the narrow shape it reads (`digest`, `captured_at`, `names`) instead of importing the store's derived row type, which stays in the store; the store's rows don't become a domain type.
- `stats/rollup.ts` keeps importing `StatsStore`: it is orchestration.

### A3. `IndexAssets` gets its own module

The `IndexAssets` service, `IndexAssetsFailed` and their result types are declared in `maintenance/names.ts`, beside `refreshNames`. Seven `src` modules import them (`services/Events.ts`, `Search.ts`, `Stats.ts`, `stats/entry-assets.ts`, `platform/index-assets.ts`, `platform/server.ts`, `platform/maintenance.ts`), so a reader looking for how search reads signed documents lands in the maintenance module. Moving the port also removes the `stats ↔ maintenance` cycle (`stats/entry-assets.ts` → `maintenance/names.ts`, `maintenance/maintain.ts` → `stats/rollup.ts`).

Move it to `src/index-assets.ts`, beside `config.ts`, the other cross-cutting port whose implementation the platform provides; `refreshNames` stays in `maintenance/names.ts`. Blast radius outside `src`: about fifteen test files (helpers `targets`, `server`, `stats`, `search-fixture`, `seed`, `seed-runner`, `database`, `telemetry`, `deps`, `deps-trends`; tests `dev-registry`, `integrity-routes-acceptance`, `stats-trending`, `errors`, `index-assets`) and `scripts/seed/input.ts`; each is an import path change. The AGENTS.md map line for `apps/api/src/` names the port.

### A4. One function flattens official names

`maintenance/names.ts::flatten` and `stats/names.ts::flattenOfficialNames` are the same loop; the first removes duplicates. No consumer can tell them apart: `nameForStats` and `stepFailureShares` use `.some`, `publishedRegistry` and `fragmentNames` build Sets, `services/Stats.ts` reads only emptiness, and `official_names` has a unique index. Keep the deduplicating one, in `ingest/normalize.ts` beside the `OfficialName` type, and use it in both places; `refreshNames` also computes it twice (`flatten(result.names)` on two lines) and should compute it once. A plain de-duplication with no behavior change.

### A5. The stub npm client leaves the production module

`platform/maintenance.ts::maintenanceWithVersions` (a stub `HttpClient` serving a fixed version list) is used only by `scripts/seed/simulate.ts::seedServices`; tests reach it only through the seed. It also duplicates `MaintenanceLive`'s wiring of `VersionRefresh`. Replace both with one exported factory in `platform/maintenance.ts` that takes the HTTP client layer: `MaintenanceLive` passes `FetchHttpClient.layer`, and `scripts/seed/` builds the stub client and passes it. One composition stays in production; only the stub leaves.

## Reviewed and left as they are

- `handlers/health.ts` calls `EventStore.probe`, `MaintenanceStore.getState` and `integrity/policy.ts::maintenanceFresh` directly, where the rule says a handler calls a service. A `Health` service would be one method of indirection over two store calls.
- `stats/cache.ts::cached` (ETag and cache headers, used only by `handlers/stats.ts`) is HTTP response-shaping in `stats/`. Moving it buys nothing today; if it moves, it inlines into `handlers/stats.ts`, keeping the one-file-per-resource handler convention.
- `stats/registry.ts` (reads the signed index from disk) and `stats/entry-assets.ts` (verified bundle reads through `IndexAssets`) are I/O inside `stats/`, with four seed-script importers; moving them is churn across `scripts/seed/` for a cleaner listing.
- `StatsStore.sourceRows` (raw `received_at`, `network_hash`, `payload` rows), `StatsStore.dependencySourceJson` and the exported `store/stats.ts::sourceRows`/`SourceRows` exist for `scripts/seed/rollups.ts` only, and expose rows where the rule says a store never does. They feed a worker pool across a thread boundary (`dependencySourceJson`'s comment), where a decoded domain shape would be serialized again; keep them, documented as seed-only at their declarations, alongside `EventStore.bulkSql`.
- The seed and `apps/api/scripts/unseed.ts` import deep paths in `apps/api/src`: the API's own tooling, run in-process on purpose (`scripts/seed/README.md`).
- `services/Search.ts` keeps mutable caches in the layer closure under a semaphore.
- `apps/web/src` separates pages, islands, components, `lib/` (view logic and the typed client) and `data/` (build-time readers), with lint keeping `fetch` and `Effect.run*` in `lib/`. Not reviewed file by file.
- `packages/contract` (533 lines) is one group per resource with shared schemas and one error table.

## Work order

After `fix/effect-error-audit` merges. One branch, one commit per proposal, in this order: A1 with its lint rules (moves `currentNames` into `store/stats.ts`), A2 (edits `store/stats.ts` and `stats/`), A4 (edits `stats/names.ts`), A3 (most importers, pure path changes), A5. Each commit runs lint, typecheck and the affected test files; the full gate (`bun run check`) once at the end. Each commit carries its doc updates (listed under each proposal).

## Out of scope

Splitting `apps/api/src` into vertical slices (`events/`, `stats/`, `search/` each with handler, service and store), or splitting orchestration out of `integrity/` and `stats/` to make the directory graph acyclic. The current layering is documented, followed by every resource, and the remaining cycles are between a directory's orchestration and the store it calls; changing the convention would touch most files for no failure it fixes.

## Review revisions

A devil's-advocate pass checked every claim against the code. Changes from it: dropped the claim that the proposals remove the directory cycles (there are four and three survive by design) and stopped justifying anything by cycles; corrected the layering table; A1 now uses the store's flat `integrity-*` prefix, makes `AnomalyFlag`'s move definite, keeps the pure reconcile and flag functions with their SQL on purpose, adds a driver-import rule, names the real importers (`unseed.ts`, no tests) and the missing docs; A2 keeps the row type in the store and takes `collectProjects` along; A3 lists its real importers and fifteen-file test blast radius; A4 is a plain de-duplication, since no consumer observes duplicates; A5 becomes a factory taking the client layer, because `maintenanceServices` isn't exported and moving the stub would duplicate the wiring; A6 (moving `stats/cache.ts`) dropped to "left as they are"; the seed-only `StatsStore` methods are listed there with their reason.
