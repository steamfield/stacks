# Phase 4.1b: Telemetry ingest and storage

Status: EXECUTED 2026-10-28

| Field | Value |
|---|---|
| Goal | `POST /v1/events` in `stacks-api` accepts anonymous event batches, validates each event on its own, accepts only released CLI versions, stores each event at most once in D1 through `effect/sql`, updates the per-project row in the same atomic batch, rewrites anything unofficial to `custom`, recomputes what the client claims, rate-limits by hashed network, keeps no raw IP, and lets no excluded event touch a project row |
| Traces to | "None of these are collected today." Success rows 1, 2 and 5. The trust job: "the user wants to start work in a project they don't have to audit first", which here means the server holds no more than the client promised to send |
| Depends on | 4.1a (the `TelemetryEvent` schema; this sub-phase starts after it is fixed), 4.0b (the API and its program structure), 4.0f (Workers, the bound D1 database, the D1 driver and the Workers test harness; D16), D17 |
| Blocks | 4.1c, 4.1d, and 4.2a through them |
| Decisions needed | D17 decides whether this ships. D16 is decided: Workers with D1, so storage exists only after 4.0f and collection never runs on the Node host |
| Settles | The ingest contract and its statuses, normalization, released-version and step-name checks, idempotent storage, which events update `projects`, the schema and migrations, rate limiting, network hashing, ASN capture, the store-backed `/healthz` |

## Scope

In:

- `POST /v1/events`, `GET /v1/schema/telemetry-event.v<N>.json` for each released schema version (4.1a's frozen snapshots), and the `/telemetry` privacy page, an Astro page in `stacks-api/apps/web` (what is collected, what never is, how long each is kept, how to opt out, with a link to the schema).
- The four ingest tags added to 4.0b's `apiErrorTable`, and `/healthz` backed by a store probe.
- `EventStore`, `RateLimiter`, `NetworkHasher` and `ReleasedVersions` services, each with a D1 implementation and an in-memory one for tests.
- Checked-in SQL migrations, applied by Wrangler locally and in tests.

Out:

- The scheduled entry: archive, pruning, hash expiry, official-name and released-version refresh (4.1c).
- Aggregates and public stats (4.2a).
- Any read endpoint over raw events.

## Design

### Where this fits

4.1a fixed the event schema and the client. This sub-phase is the write path and the tables. 4.1c adds the scheduled maintenance that keeps the tables within the retention promise and refreshes the lookup tables this sub-phase reads. [4.1d](phase-4.1d-telemetry-integrity-and-alerts-2026-10-30.md) applies exclusions added later, checks event sequences and recomputes `projects` rows. 4.2a reads `projects` and `events` to build stats.

### Contract

```
POST /v1/events
Content-Type: application/json
{ "events": [ <TelemetryEvent>, ... ] }   // 1 to 50 events, body at most 512 KiB
```

| Response | Tag (`apiErrorTable`, 4.0b) | When |
|---|---|---|
| `202 { "rejected": ["<eventId>", ...] }` | | The batch was read. Events that fail validation are listed (only UUID-shaped ids echoed) and never stored; the client deletes them |
| `400` envelope | `BadInput` | Not JSON, no `events` array, empty, or more than 50 |
| `405` envelope with `Allow: POST` | `MethodNotAllowed` | Any method other than `POST` on `/v1/events` (and other than `GET` or `HEAD` on read routes) |
| `413` envelope | `PayloadTooLarge` | Body over 512 KiB |
| `415` envelope | `UnsupportedMediaType` | Not `application/json` |
| `429` envelope with `Retry-After` | `RateLimited` (retryable) | Rate limited |
| `503` envelope, `retryable: true` | `Unavailable` | Store unavailable, or the hashing secret is missing |

The router itself has no 405: in the scaffolded stack a wrong method falls through to the 404 envelope. The 405 comes from 4.0b's server-level middleware: on a route miss it looks up the methods the `HttpApi` declares for that path and, when there are any, answers `MethodNotAllowed` with `Allow` listing them. 4.0b's acceptance test that pins `POST /healthz` to 404 changes to 405 with `Allow: GET` in the same commit. The 413 and 415 arrive the same way through that middleware: `HttpApiPayloadTooLarge` as a defect and the framework's own plain-text 415 response, both rewritten into the envelope.

The body cap is enforced on the bytes read, not on `Content-Length`: the handler reads the request stream and aborts with 413 as soon as the count passes 512 KiB, so a chunked body with no length header can't get past it. A `Content-Length` over the cap is refused before reading.

`GET /healthz` runs `SELECT 1` against the store. It returns 200 `{ "status": "ok" }` when that succeeds and 503 with the `Unavailable` envelope when it doesn't, so 4.1e's and 5.2's smoke checks and any uptime check test the database, not just the Worker.

Every non-202 keeps the batch in the client's spool, so a bad deploy can't make the field delete its data.

### Per-event handling

1. Strip unknown properties against the schema for the event's `schemaVersion`, then decode. Failure rejects that event only. An unknown `schemaVersion` is rejected per event (roadmap, Contracts: Schema versions, Telemetry event row). Validators for released schema versions are never removed.
2. Released versions. `cliVersion` must be a `major.minor.patch` string; anything else (including `dev`) is rejected. A well-formed version not in `released_versions` is a candidate for `excluded = 'unreleased_version'` (step 7) rather than rejected: a release published since the last refresh shouldn't lose its first day of events, and 4.1c re-includes rows whose version appears after the refresh. Excluded rows never count. A source build can't reach this point anyway (4.1a's release-build seam), so this is the server's own check, not the only one.
3. Normalize: any `stack`, fragment or step name not in `official_names` becomes `custom`; `fingerprint` is dropped if any entry is `custom`. The fragment list is then deduplicated, so `["custom", "custom"]` and repeated ids can't inflate attach rates, and the number of distinct non-official fragments is kept as `customCount`.
4. Step names. For a `verify` whose `stack` is official, a step name that `official_names` doesn't list for that stack (kind `step`, `stack` equal to it; 4.1c fills these from every composition in `v1/names.json`, so any released or indexed composition passes) makes the event a candidate for `excluded = 'implausible'`. A step the client already sent as `custom` (added by hand after scaffold, 4.1a) doesn't trigger this. Sequence rules (a verify with no scaffold, timings that don't fit) are 4.1d's.
5. Recompute: for `verify`, derive `outcome` from `scope`, `steps`, `stepsChanged` and `tamperCheck` with the same rule 1.3b uses, and reject the event if the client's value differs. Reject implausible values (negative durations).
6. Exclusions. An event whose install id, network hash or ASN matches a row in `exclusions` is a candidate for `excluded_install`, `excluded_network` or `excluded_asn`. The daily caps (below) make a scaffold over the cap a candidate for `cap`.
7. Classify. `ingest/classify.ts::classify` sets the one `excluded` column to the first candidate in this order, and to null when there is none: `excluded_install`, `excluded_network`, `excluded_asn`, then `unreleased_version`, then `cap`, then `implausible`. First match wins, so the column always names the strongest reason. The same function runs wherever a row's reason changes later: 4.1c may only clear `unreleased_version`, and when it does it re-runs `classify` without the version candidate, so a row moves to `cap` or `implausible` if one of those applies, never straight to null; 4.1d's exclusion and sequence steps re-run it with their candidates added or removed.
8. Store (below).

### Storage

`effect/sql` with its D1 driver package (the one 4.0f's spike found for `effect` 4.0.6, or the adapter it called for; roadmap, Other shared facts: New dependencies). D1 starts empty at 4.0f, so the first migration here creates every table and nothing is carried over from the Node host. Migrations are plain SQL files in `stacks-api/apps/api/migrations/`, applied with `wrangler d1 migrations apply` locally and by the test harness before each test file (with the Workers pool, its D1 migration helper; otherwise the Wrangler local runtime). Remote migrations are applied by a maintainer by hand before a deploy.

| Table | Columns |
|---|---|
| `events` | `event_id` PK, `batch_id`, `type`, `install_id`, `project_id`, `received_at`, `received_day`, `sent_at`, `cli_version`, `network_hash` (nullable; 4.1c nulls it after 30 days), `asn` (integer, `0` when unknown), `payload` JSON, `excluded` (nullable reason, set by `classify` in the order above: `excluded_install`, `excluded_network`, `excluded_asn`, `unreleased_version`, `cap`, `implausible`) |
| `projects` | (`install_id`, `project_id`) PK, `stack`, `fragments`, `preset`, `handoff`, `agent`, `scaffold_at` (the scaffold event's `received_at`), `scaffold_day`, `first_verify_at`, `first_green_at`, `verify_runs_to_green` (verify events up to and including the first green; null until green), `seconds_to_green`, `seconds_to_first_test_pass` |
| `official_names` | `kind` (stack, fragment, step), `name`, `stack` (nullable; for `step`, the stack it belongs to), `first_seen`, `last_seen`. Filled by 4.1c |
| `released_versions` | `version` PK, `seen_at` |
| `rate_counts` | (`network_hash`, `minute`) PK, `count` |
| `exclusions` | `kind` (`install`, `network`, `asn`), `value`, `reason`, `created_at` |

`projects` is keyed by install and project together, because project ids are client-chosen. Every column has a 4.2a reader: `agent` the per-agent breakdown, `preset` the per-preset breakdown, `fragments` the attach rates, `handoff` the entry-point share, `verify_runs_to_green` the verify runs before first green, and `scaffold_at` install maturity. Fields with no column (`without`, `source`, `fingerprint`) 4.2a reads from the scaffold event's `events.payload` within its 28-day window, which raw events outlive (90 days); no column is kept without a reader.

`asn` comes from the platform's request metadata (on Workers, `request.cf.asn`), never from a lookup of the IP. An autonomous system number names a provider, not a person, so it is kept as long as the row; it is the one network signal left after the hash expires, and it is what an ASN exclusion matches. The `/telemetry` page lists it.

Which events touch `projects`, decided here: an event stored with any `excluded` value never creates or updates a `projects` row. Over-cap scaffolds, implausible verifies, unreleased versions and excluded sources are kept in `events` for 4.1d's counts and for recomputation, and count nowhere public. When an exclusion is added or removed, or a version is re-included, the affected rows are rebuilt with `rebuildProject` (below) from raw events while those exist (under 90 days): by 4.1d's recheck queue, or for a re-included version by 4.1c directly until 4.1d lands. After 4.1c prunes the raw events, `projects` is final.

D1 has no interactive transactions, so each event's insert and its `projects` update are one D1 batch (which D1 runs atomically), keyed so a retry can't double-count:

```sql
INSERT OR IGNORE INTO events (event_id, batch_id, ...) VALUES (?1, ?2, ...);
INSERT INTO projects (...) SELECT ... WHERE EXISTS
  (SELECT 1 FROM events WHERE event_id = ?1 AND batch_id = ?2 AND excluded IS NULL)
  ON CONFLICT (install_id, project_id) DO UPDATE SET ...;   -- first_* columns only set when NULL
```

`batch_id` is a random id per request. An event stored with an `excluded` reason fails the guard the same way, so the write-time rule above holds inside the one atomic batch. When the event already existed, `INSERT OR IGNORE` leaves the old row with its old `batch_id`, the `EXISTS` guard is false, and the project row is untouched. This avoids relying on `changes()` across statements. If the driver doesn't expose D1's batch, the D1 `EventStore` calls the binding's `batch` directly for this one write and uses `effect/sql` for everything else; record which in the code's header comment.

`stacks-api/apps/api/src/store/projects.ts::rebuildProject` is owned here: it rebuilds one (install, project) row from that pair's events with `excluded` null, or deletes the row when no such scaffold remains, using the same column rules as the upsert above. Ingest doesn't call it; 4.1c calls it after re-including a version, and 4.1d's recheck calls it for every queued pair. A test builds rows incrementally through ingest and requires `rebuildProject` over the same stored events to produce identical rows.

### Abuse resistance

| Layer | Rule |
|---|---|
| Rate limit | 60 events per minute per network hash, counted per event including rejected ones, in `rate_counts` |
| Network identity | HMAC-SHA256 of the IPv4 /24 or IPv6 /64 prefix with the secret `NETWORK_HASH_KEY`; the raw IP is never stored or logged |
| Daily caps | At most 20 scaffolds per install and 20 per network per day count; the rest are `cap` candidates (step 7) |
| Plausibility | A `verify` for an official stack with a step name never listed for that stack is an `implausible` candidate (step 4 above); sequence checks are 4.1d's |
| Manual exclusion | The maintainers add an install id, network hash or ASN to `exclusions` with a reason; new events matching it are stored excluded, and 4.1d marks the older rows. Rows are marked, not deleted |

Decided here: one secret key, rotated only if it leaks, instead of a weekly salt. A weekly salt gives one network four hashes in a 28-day window, which breaks 4.2a's per-network capping for the windows it publishes; the 30-day hash expiry in 4.1c already bounds how long a network is linkable. The privacy page says so in those words: events from one network can be linked to each other for up to 30 days, then the link is deleted. The maintainers can still choose a rotating key ([open question 29](../../risks-and-open-questions.md#open-questions-for-the-maintainers)); that would also change 4.2a's network counting.

### Interfaces

```ts
export class EventStore extends Context.Service<EventStore, {
  readonly insert: (events: ReadonlyArray<NormalizedEvent>, network: NetworkHash, batchId: string) =>
    Effect.Effect<void, StoreUnavailable>;
  readonly officialNames: Effect.Effect<OfficialNames, StoreUnavailable>;
  readonly releasedVersions: Effect.Effect<ReadonlySet<string>, StoreUnavailable>;
  readonly rebuildProject: (key: ProjectKey) => Effect.Effect<void, StoreUnavailable>; // store/projects.ts::rebuildProject
}>()("stacks-api/EventStore") {
  static memory: () => Layer.Layer<EventStore>;
  static d1: Layer.Layer<EventStore, never, SqlClient.SqlClient>;
}
```

`RateLimiter` (`stacks-api/RateLimiter`) and `NetworkHasher` (`stacks-api/NetworkHasher`) follow the same pattern. `EventStore` covers the write path and the lookups ingest needs; the lease, `maintenance_state`, per-day counts and pruning belong to 4.1c's `MaintenanceStore` (`stacks-api/MaintenanceStore`), and the internal integrity tables to 4.1d's `IntegrityStore`. `apps/api/src/platform/worker.ts` provides the D1 implementations and the `SqlClient` layer from the binding; nothing else touches bindings. The Node entry provides only the in-memory store for local development and never serves ingest in production. `NETWORK_HASH_KEY` is read only in the API's `config.ts` and never logged. The schema route serves `TelemetryEvent`'s JSON Schema export; the privacy page is static text built with the site.

### Failure modes

| Case | Response |
|---|---|
| One bad event in 50 | 202 with that id in `rejected`; 49 stored |
| Same batch posted twice | 202 both times; stored once; project rows unchanged by the second |
| D1 down | 503; client keeps the batch |
| `official_names` empty (before 4.1c's first run) | Every name becomes `custom` and no step check runs (there is nothing official to check against); 4.1c's first scheduled run fills it, and 4.1e's launch order puts that run before the CLI release that turns collection on |
| Store down | `/healthz` 503; ingest 503 |
| Secret missing | 503 on ingest rather than storing unhashed networks |

### Decided here

- Per-event rejection, never whole-batch; only schema failures let the client drop data.
- The server decides what's official and what a verify outcome was. A modified client can lie about its own runs but can't make a custom stack count as official or a changed verify count as green.
- No free-text field exists in the schema.

## Files and areas touched

| Path | Change |
|---|---|
| `stacks-api/apps/api/src/handlers/events.ts`, `stacks-api/packages/contract/src/api.ts` | Route and group |
| `stacks-api/apps/api/src/ingest/` | `normalize.ts`, `recompute.ts`, `versions.ts`, `steps.ts`, `classify.ts` (the `excluded` precedence), `body.ts` (streamed byte cap) |
| `stacks-api/packages/contract/src/errors.ts` | `MethodNotAllowed`, `PayloadTooLarge`, `UnsupportedMediaType`, `RateLimited` rows |
| `stacks-api/apps/api/src/handlers/health.ts` | Store probe |
| `stacks-api/apps/api/src/store/` | `EventStore`, `RateLimiter`, `NetworkHasher` (memory and D1); `projects.ts` (the upsert's column rules and `rebuildProject`) |
| `stacks-api/apps/api/migrations/` | SQL migrations |
| `stacks-api/apps/web/src/pages/telemetry.astro` | Privacy page |
| `stacks-api/apps/api/src/config.ts`, `apps/api/wrangler.jsonc` | Secret and limits (the D1 binding is 4.0f's) |
| `stacks-api/apps/api/package.json` | The D1 driver package, if 4.0f didn't already add it (never this repository's root catalog) |
| `stacks-api/apps/api/tests/ingest.test.ts` | New |
| `stacks-api/.claude/rules/api/` | Never store or log a raw IP; no free-text fields |
| `stacks-api/AGENTS.md` | Ingest invariants; how to run the API with local D1 |

## Acceptance tests

Through a real local HTTP server with the in-memory store, and again under the local Workers runtime with local D1 and migrations applied.

- 50 valid events: 202, `rejected: []`, each stored once; posting again changes no row in `events` or `projects`.
- One malformed event: its id in `rejected`, the rest stored.
- Two `verify` events for one project posted in two batches, the second retried: `first_green_at` set once, from the first green.
- Unknown stack and fragment ids stored as `custom`; fingerprint dropped.
- A verify claiming `green` with a failed step, or with `stepsChanged: 1`, is rejected.
- `cliVersion: "dev"` rejected; `cliVersion: "9.9.9"` (not released) stored with `excluded = 'unreleased_version'`.
- The 61st event from one network in a minute gets 429 with `Retry-After` and the `RateLimited` envelope with `retryable: true`.
- `GET /v1/events` gets 405 with `Allow: POST`; `text/plain` gets 415; a 600 KiB body gets 413 both with an honest `Content-Length` and as a chunked body with no length header, and the chunked one is cut off without being read to the end.
- With the store failing, `/healthz` returns 503 with the `Unavailable` envelope; healthy, 200.
- A verify for an official stack whose steps are all listed for it is stored with `excluded` null; one with an extra unlisted step name is stored `implausible` and leaves `projects` untouched; a step sent as `custom` is not implausible.
- A fragment list `["a", "a", "x-unofficial", "y-unofficial"]` is stored as `["a", "custom"]` with `customCount: 2`.
- An over-cap scaffold, an implausible verify, an unreleased-version event and an event from an excluded install, network and ASN each leave no `projects` row; the same event without the reason creates one.
- Precedence: an over-cap scaffold from an excluded install with an unreleased version is stored `excluded_install`; the same event from an unexcluded install is `unreleased_version`; with a released version, `cap`. Re-running `classify` without the version candidate on an over-cap `unreleased_version` row gives `cap`.
- `rebuildProject` over stored events reproduces every `projects` row ingest built, column for column.
- `asn` is stored from the request metadata fixture, `0` when absent; an ASN in `exclusions` marks a new event `excluded_asn`.
- No stored row or log line contains the request IP (scan everything written).
- Missing `NETWORK_HASH_KEY`: 503, nothing stored.
- The 4.1a client against this server: queued events arrive, the spool empties, debug output matches stored payloads.

## Exit criteria

- D17 decided. Acceptance tests pass; `bun run check` green in `stacks-api`, and from this repository's root for any change here.
- Migrations apply cleanly to an empty local D1 and are idempotent.
- `stacks-api/AGENTS.md` documents the ingest invariants.

## What this plan may get wrong

- 2026-10-27 (maintainers, amended D16): this sub-phase no longer waits on 4.0f. It runs on the Node host with SQLite through `effect/sql`'s SQLite driver for Node, in place of D1. Read every "D1" here as "the store", reached only through `SqlClient`: `EventStore.d1` becomes `EventStore.sql`, migrations stay plain SQL files under `stacks-api/apps/api/migrations/`, applied by a small migration runner at startup and by each test file over a fresh database file, with no Wrangler. Write only SQL D1 also accepts, and keep each event's insert and project update in one batch (here a single transaction over the batch statements), so 4.0f swaps the driver and platform entry. Until `@steamfield/stacks-format` is published, `TelemetryEvent` reaches the API as a copy beside the contract with a comment to replace it, as the site does for the index schemas. The database path comes from config (`STACKS_DB_PATH`), never a default next to the code. Under the roadmap's "API route map", the frozen schemas are the documents `v1/schemas/telemetry-event/v<N>.json`, not `/v1/schema/telemetry-event.v<N>.json`; `events` is its own contract group.

- 2026-10-28: the in-memory implementations existed because the Node entry couldn't reach D1. With SQLite on Node, each test gets a migrated database file in a temp dir, so `EventStore`, `RateLimiter` and `ReleasedVersions` have only the `sql` implementation and the acceptance tests run once, against it. A memory copy would restate every ingest invariant with nothing in production to keep it honest, and inspecting it would need test-only handles exported from `src/`.
- 2026-10-28 (executed): the plan didn't say where the database lives outside the container. Requiring `STACKS_DB_PATH` everywhere broke a fresh clone's `bun run dev`, so development defaults to the gitignored `.dev/data/telemetry.sqlite` and only production requires the variable (`DatabasePathRequired` at startup). The 405 rule also changed two existing assertions: `POST /healthz` was 404 in `health.test.ts` and `static.test.ts` and is now 405 with `Allow: GET`.
- Caps and plausibility rules are guesses until real data exists. They are config, and changing them marks or unmarks rows rather than needing a migration.
- Step-name checks are only as good as `v1/names.json`. A stack whose composition rules changed between releases may list names an old CLI never sent, which is harmless; one that loses a name it shipped would mark real runs implausible, which is why names are only ever added ([4.0e](phase-4.0e-official-names-and-directory-2026-10-30.md)).
- 2026-10-27: the 405 assumed the router answers a wrong method itself. The `astro-api` stack's router gives the 404 envelope for any miss, so the server-level middleware derives the 405 and `Allow` from the `HttpApi` definition. If looking up the declared methods per path proves awkward in Effect 4.0.6, a wrong method stays a 404 and this row and its acceptance test go.
- A D1 row counter for rate limits costs a write per request. At expected volume that's fine; if not, use the platform's rate-limit binding behind the same `RateLimiter` service.
- `effect/sql`'s D1 support in Effect 4 may be thin. The spike in 4.0f should have said so; if it didn't, the fallback above (raw batch for the one atomic write) keeps this sub-phase moving.
