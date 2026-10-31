# Phase 4.1c: Telemetry maintenance and retention

Status: EXECUTED 2026-10-28 (on SQLite on the Node host, amended D16)

| Field | Value |
|---|---|
| Goal | The Worker's scheduled entry keeps the telemetry store within its retention promise and its lookup tables current: it archives each day of raw events to private storage, prunes a day only after its archive is complete and its counts match, expires network hashes after 30 days, refreshes the official-name and released-version tables from the signed names file and npm, keeps a history of registry snapshots, runs under a lease so two runs never overlap, and records when it last succeeded |
| Traces to | The trust job: "the user wants to start work in a project they don't have to audit first", which here means data is kept only as long as promised. "None of these are collected today" (the data this keeps usable) |
| Depends on | 4.1b (the tables, services and `rebuildProject`), [4.0e](phase-4.0e-official-names-and-directory-2026-10-30.md) (the signed `v1/names.json` the official names come from; its key is 4.0c's `INDEX_PUBLIC_KEYS`) |
| Blocks | 4.1d, 4.2a |
| Decisions needed | D17. D16 is decided (Workers, with R2 for the archive), and this sub-phase starts after 4.0f |
| Settles | The maintenance schedule, the lease shared with every scheduled step, the last-success marker, the archive format, the prune-after-verify rule, hash expiry, registry snapshots, and where official names and released versions come from |

## Scope

In:

- The maintenance program behind 4.0f's `scheduled` export in `apps/api/src/platform/worker.ts`, and a cron trigger in `apps/api/wrangler.jsonc` (host config, not CI).
- An `Archive` service (R2 and in-memory).
- A `maintain` program: take the lease; archive, verify, prune; expire hashes; refresh `official_names` and `registry_snapshots`; refresh `released_versions` and queue the rows it newly covers for 4.1d; drop old `rate_counts`; write `last_success`; release the lease.
- `maintenance_lease`, `maintenance_state` and `registry_snapshots` tables, and the `MaintenanceStore` service over them and the per-day counts and deletes the steps need.

Out:

- Rollups (4.2a adds its own hourly step to the same scheduled entry, under the same lease).
- Applying exclusions, sequence checks, recomputing `projects`, anomaly flags and alerts (4.1d, which adds its steps to `maintain` before the archive step).
- Any public read of the archive. It is private and exists for recomputing aggregates.
- CI-driven jobs (phase 5 has none for this; the schedule runs on the host).

## Design

### Where this fits

4.1b writes rows. This sub-phase is the only thing that deletes rows or nulls their hashes, so the retention promise on the `/telemetry` page is enforced in one place. [4.1d](phase-4.1d-telemetry-integrity-and-alerts-2026-10-30.md) adds steps to the same `maintain` program, ahead of the archive step, that mark rows excluded and recompute `projects`; it never deletes. 4.2a adds an hourly rollup to the same scheduled entry, under the same lease, and reads the tables this keeps clean.

### Schedule

One cron trigger, daily at 03:00 UTC, runs `maintain(now)`. Each step is idempotent and independent: a failure in one is logged and the others still run. Each run's `MaintenanceReport` (per-step outcome and counts) is one structured log line.

### Lease and last success

Idempotent steps are not enough on their own: 4.2a's hourly rollup shares this scheduled entry, and the platform can retry a run that timed out while the first is still going, so two runs could rewrite the same archive object or window rows at once. Every scheduled program therefore runs inside one lease:

| Table | Columns |
|---|---|
| `maintenance_lease` | `name` PK (`scheduled`), `holder` (a random id per run), `expires_at` |
| `maintenance_state` | `key` PK, `value`, `updated_at`. Keys: `last_success` (when `maintain` last finished with every step `ok`), `last_rollup` (4.2a), `names_digest`, `names_last_outcome` (the official-names step's last outcome: `ok`, `unchanged`, `invalid` or `missing`), `lease_held_count` (consecutive scheduled runs that found the lease held) |

The lease is taken with one conditional upsert (`INSERT ... ON CONFLICT (name) DO UPDATE SET holder = ?, expires_at = ? WHERE maintenance_lease.expires_at < ?now`) and counts as held only if the row then names this run's holder. It expires after 20 minutes, longer than the platform's 15-minute limit for a scheduled run, so a crashed run frees it on its own. It is released in a finalizer (`Effect.ensuring`) whether the run succeeds, fails or is interrupted, by deleting the row only where `holder` matches. A run that can't take it increments `lease_held_count`, logs `lease_held` with the current holder's expiry and exits without doing anything else. A run that takes it leaves `lease_held_count` as it is while its program runs, so 4.1d's integrity step can read the streak, and resets it to 0 after the program finishes. The hourly rollup skips its hour in that case; the next hour recomputes it.

`last_success` is written only when every step reported `ok`. A silently dead cron and a healthy one differ only in this value; 4.1d raises an alert when it is older than 26 hours.

### Steps

| Step | Rule |
|---|---|
| Archive | For each `received_day` older than 7 days and not yet archived: write `events/<day>.ndjson.gz` to the private bucket, one line per row with `network_hash` removed, and object metadata `{ rows, excludedRows }` |
| Verify and prune | For each day older than 90 days: read the archive object's metadata; delete that day's rows only if the object exists and its `rows` and `excludedRows` equal the current counts for that day in `events`. From [4.2d](phase-4.2d-dependency-telemetry-client-and-ingest-2026-10-30.md) on, the same D1 batch also deletes the `event_deps` rows of the pruned events, in `stacks-api/apps/api/src/maintenance/maintain.ts`. Otherwise leave the rows and log `archive_mismatch` |
| Expire hashes | `UPDATE events SET network_hash = NULL WHERE received_day < now - 30 days`; delete `rate_counts` older than one day |
| Official names | Read `v1/names.json` from the Worker's own static assets binding and verify it with `INDEX_PUBLIC_KEYS` (4.0c). Write `names_last_outcome` (`invalid` for a bad signature, `missing` for no file, `unchanged` when the digest equals `names_digest`, else `ok`). If its digest differs from `names_digest`, insert a `registry_snapshots` row and upsert every stack and fragment id, and every step name with the stack it belongs to, setting `first_seen` on insert and `last_seen` to now for every name still present. Names are never removed, so a withdrawn stack's history keeps counting as official |
| Released versions | Fetch the npm registry document for `@steamfield/stacks` (D34) and upsert every published version; then, for rows with `excluded = 'unreleased_version'` whose `cli_version` is now listed, re-run 4.1b's `classify` without the version candidate (the only reason this step may clear) and call 4.1b's `rebuildProject` for each affected (install, project) pair. 4.1d changes this step to add the pairs to its `recheck_queue` instead of rebuilding them here. If npm is unreachable, keep the table and retry tomorrow |

### Registry snapshots

`registry_snapshots(digest PK, captured_at, payload)` keeps every verified `OfficialNames` payload the job has seen, written only when the digest changes. It is the history that makes the step-name check in 4.1b (a name listed for the stack in any composition ever official) and 4.1d's composition checks possible, and it is where 4.2a reads when a stack's content changed, to mark its daily series. `official_names` is the flattened lookup; the snapshots are the record of when each composition existed. Snapshots are small (names only) and kept indefinitely.

Archive runs before prune on purpose, with a seven-day gap: a day is archived long before it is old enough to prune, so the prune step normally only has to check. A day that failed to archive is retried every night and never pruned until it succeeds. Rows that changed after archiving (an exclusion added, a version re-included) make the counts differ; the archive step rewrites a day's object when its counts no longer match, before the prune step looks at it.

The 90-day cutoff stays: raw rows are deleted after 90 days, and `projects` and 4.2a's aggregates are kept. `projects` holds no network hash and no payload.

### Interfaces

```ts
export class Archive extends Context.Service<Archive, {
  readonly put: (key: string, body: Uint8Array, meta: ArchiveMeta) => Effect.Effect<void, ArchiveFailed>;
  readonly head: (key: string) => Effect.Effect<Option.Option<ArchiveMeta>, ArchiveFailed>;
}>()("stacks-api/Archive") {
  static memory: () => Layer.Layer<Archive>;
}

export class MaintenanceStore extends Context.Service<MaintenanceStore, {
  readonly takeLease: (name: "scheduled", holder: string, now: Date) => Effect.Effect<boolean, StoreUnavailable>;
  readonly releaseLease: (name: "scheduled", holder: string) => Effect.Effect<void, StoreUnavailable>;
  readonly getState: (key: MaintenanceKey) => Effect.Effect<Option.Option<string>, StoreUnavailable>;
  readonly setState: (key: MaintenanceKey, value: string, now: Date) => Effect.Effect<void, StoreUnavailable>;
  readonly dayCounts: (day: string) => Effect.Effect<{ rows: number; excludedRows: number }, StoreUnavailable>;
  readonly dayRows: (day: string) => Stream.Stream<ArchivedRow, StoreUnavailable>;
  readonly pruneDay: (day: string) => Effect.Effect<number, StoreUnavailable>;
  readonly expireHashes: (before: string) => Effect.Effect<number, StoreUnavailable>;
}>()("stacks-api/MaintenanceStore") {
  static memory: () => Layer.Layer<MaintenanceStore>;
  static d1: Layer.Layer<MaintenanceStore, never, SqlClient.SqlClient>;
}

export const withLease: <A, E, R>(name: "scheduled", now: Date, program: Effect.Effect<A, E, R>) =>
  Effect.Effect<Option.Option<A>, E | StoreUnavailable, R | MaintenanceStore>; // None when the lease is held

export const maintain: (now: Date) => Effect.Effect<MaintenanceReport, never,
  EventStore | MaintenanceStore | Archive | IndexAssets | HttpClient.HttpClient>;
```

`apps/api/src/platform/worker.ts` provides R2 for `Archive`, the assets binding for `IndexAssets`, and `IndexAssets` reads signed files from the static assets and verifies each with `INDEX_PUBLIC_KEYS` before returning it: `v1/names.json` here, and `v1/allowlist.json` for 4.2d's ingest. The same file runs `maintain` from `scheduled` with the time the trigger passed in. Tests drive `maintain` directly with `TestClock` and the in-memory services, and once under the local Workers runtime with its scheduled-test mode.

### Failure modes

| Case | Result |
|---|---|
| R2 write fails | That day stays unarchived and unpruned; retried tomorrow |
| Archive counts don't match | Rows kept; `archive_mismatch` logged; the next run rewrites the object |
| Names file signature fails, or the file is missing | `official_names` and `registry_snapshots` unchanged; logged; `last_success` not written, so 4.1d alerts if it persists |
| Lease held by another run | Nothing done; `lease_held` logged |
| Run dies mid-way | Lease expires after 20 minutes; `last_success` keeps its old value |
| npm unreachable | `released_versions` unchanged; excluded rows stay excluded one more day |
| The whole job fails to start | Nothing deleted; the next run catches up, since every step works on "all days older than N" |

## Files and areas touched

| Path | Change |
|---|---|
| `stacks-api/apps/api/src/maintenance/` | `maintain.ts`, `archive.ts`, `names.ts`, `versions.ts`, `lease.ts` |
| `stacks-api/apps/api/src/store/maintenance.ts` | `MaintenanceStore` (memory and D1) |
| `stacks-api/apps/api/migrations/` | `maintenance_lease`, `maintenance_state`, `registry_snapshots` |
| `stacks-api/apps/api/src/platform/worker.ts`, `apps/api/wrangler.jsonc` | `scheduled` runs `maintain`; cron, R2 binding |
| `stacks-api/apps/api/tests/maintenance.test.ts` | New |
| `stacks-api/apps/web/src/pages/telemetry.astro` | Retention text: 30 days for network hashes, 90 days for raw events, private archive |
| `stacks-api/AGENTS.md` | The retention rule |

## Acceptance tests

- With `TestClock` at day 100 and events on days 1 to 100: days 1 to 92 archived (older than 7 days); days 1 to 9 pruned (older than 90 days); every archive object's metadata matches what was pruned.
- R2 failing for day 5: day 5's rows still present after the run; the next run (R2 healthy) archives and then prunes it.
- An exclusion added to day 4 after it was archived: the next run rewrites day 4's object before pruning, and the pruned count matches the new object.
- A tampered archive object whose `rows` is one less than the table: rows kept, `archive_mismatch` in the `MaintenanceReport`.
- No archived line contains `network_hash`.
- Network hashes null for rows older than 30 days; none for newer rows.
- A `v1/names.json` served by the assets fixture adds its stack, fragment and per-stack step names to `official_names` and one `registry_snapshots` row; running again with the same file adds no snapshot and only moves `last_seen`; a new file with one more step adds a second snapshot and keeps every earlier name; a file with a bad signature changes nothing but `names_last_outcome`, which reads `invalid`.
- Lease: two `maintain` runs started together under `TestClock`: exactly one does the work, the other reports `lease_held`; a run that fails mid-way releases the lease in its finalizer; a lease left by a crashed run (no finalizer) is still held at 15 minutes and taken again after 20. Two runs that find the lease held set `lease_held_count` to 2; the next run that takes it leaves 2 in place while its program runs and writes 0 when it finishes.
- `last_success` is written after a fully `ok` run and not after a run with one failed step.
- A fixture npm document listing `9.9.9` re-includes rows stored with `excluded = 'unreleased_version'` and `cli_version = '9.9.9'` and builds their `projects` rows with `rebuildProject`; one such row that was also over the daily cap becomes `cap` and builds no row; no row with any other reason changes.
- Under the local Workers runtime, triggering the scheduled handler runs `maintain` and logs one report line.

## Exit criteria

- Acceptance tests pass; `bun run check` green in `stacks-api`.
- The `/telemetry` page states the retention rules exactly as implemented.
- After the first deploy, one scheduled run has completed, `official_names` and `released_versions` are filled and `last_success` is set before any CLI release turns collection on (checked by 4.1e's procedure).

## What this plan may get wrong

- 2026-10-27 (amended D16): runs on the Node host's SQLite store (4.1b's dated line). The scheduled entry is a Node timer in `apps/api/src/platform/` that runs the same `maintain` program on the planned schedule under its lease; Workers' cron trigger replaces it at 4.0f. The archive goes to a local directory from config until object storage exists.
- 2026-10-28: as in 4.1b, no in-memory services. `Archive` has the directory implementation only, and tests use a real temp directory, so "R2 failing for day 5" is a real filesystem failure for that day. Stores are SQLite with migrations on a fresh file per test; the new tables arrive as a migration. Tests drive `maintain(now)` with `TestClock`, plus one check that the platform timer starts and stops with the server's scope; there is no local Workers run. npm is answered by a local HTTP server in the test.
- 2026-10-28 (implementation): a row whose network hash expired or whose project history was pruned can't be re-checked, so it stays `unreleased_version`, is counted in the report's `leftExcluded` and `leftByReason`, and the step stays ok. Production requires `STACKS_ARCHIVE_DIR` (`ArchivePathRequired`), as 4.1b requires `STACKS_DB_PATH`. Archive metadata whose line counts disagree with the file is kept and logged as `archive_mismatch` rather than rewritten. The platform timer logs a failed run (a defect included) and keeps its schedule; only interruption ends it.

- Reading npm from the scheduled job adds an outside dependency to the server. It's one request a day; a publish-time push is an optional later speed-up.
- Count matching proves the archive has the right number of rows, not the right rows. A digest of the day's rows would be stronger; add it if the archive is ever used for more than recomputing aggregates.
- One gzip object per day assumes a day of events fits in Worker memory. At 512 KiB per batch and 60 events per minute per network that holds well past launch volume, but there is no hard ceiling: if a day's rows pass about 50 MB compressed, split the object into numbered parts with a small manifest carrying the counts, and verify the parts' total before pruning.
- A 20-minute lease assumes scheduled runs finish inside the platform's 15-minute limit. If a run ever outlives its lease, a second run could start; the finalizer only deletes the row it holds, so the overlap is bounded to one run, and 4.1d's alert on `lease_held` streaks makes it visible.
- A daily schedule means pruning can run up to a day late. The promise on the privacy page says "after 90 days", not "at 90 days".
