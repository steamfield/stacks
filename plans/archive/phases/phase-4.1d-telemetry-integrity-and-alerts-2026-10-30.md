# Phase 4.1d: Telemetry integrity and alerts

Status: EXECUTED 2026-10-28 (on SQLite on the Node host, amended D16)

| Field | Value |
|---|---|
| Goal | Before anything is published, the scheduled job keeps stored telemetry honest: it applies exclusions added after events arrived, checks event sequences, recomputes the affected `projects` rows, counts a project only from an install first seen at least 24 hours before its scaffold, keeps internal daily counts, flags anomalies, and writes one structured alert line when something needs a maintainer |
| Traces to | "None of these are collected today" (numbers that are collected have to be right before they are shown). The trust job: "the user wants to start work in a project they don't have to audit first", which for public stats means a stack's green rate can't be stuffed. Success rows 1 and 5 across users |
| Depends on | [4.1c](phase-4.1c-telemetry-maintenance-and-retention-2026-10-30.md) (the scheduled entry, the lease, `last_success`, `registry_snapshots`), [4.1b](phase-4.1b-telemetry-ingest-and-storage-2026-10-30.md) (the tables and the write-time rule), D17 |
| Blocks | [4.2a](phase-4.2a-stats-rollup-and-routes-2026-10-30.md) (public numbers read only rows this has checked), [4.1e](phase-4.1e-telemetry-launch-and-runbook-2026-10-30.md) |
| Decisions needed | D17 (if declined, this is dropped with the rest of 4.1). The thresholds below are proposed values for the maintainers |
| Settles | How later exclusions reach stored rows and `projects`; the sequence rules; install maturity; the internal count and flag tables; the alert line; the escalation path if abuse gets past caps |

## Scope

In:

- Maintenance steps added to 4.1c's `maintain`, run before its archive step so archives are written over rows already marked: apply exclusions, run sequence checks, work the recheck queue, update `installs`, write `daily_metrics`, write `anomaly_flags`, emit the alert.
- Tables `recheck_queue`, `daily_metrics`, `anomaly_flags`, `installs`.
- The install-maturity rule, applied by 4.2a.

Out:

- Any public route or page that reads these tables. They are internal. The maintainers read them with the read-only queries in 4.1e's runbook.
- Where alerts are routed (4.1e decides the destination; this sub-phase only writes the line).
- Proof-of-work or any client-side challenge. Named below as the next step if needed, not built.
- Deleting rows. Only 4.1c deletes.

## Design

### Where this fits

4.1b stores every event, marks the ones it can judge on arrival, and lets only unmarked events build `projects`. Some judgments can only be made later: an exclusion the maintainers add after a spike, a verify whose scaffold event never came, a version re-included by 4.1c. This sub-phase makes those judgments inside the same scheduled run and under the same lease, then counts and flags what it saw. 4.2a reads `projects` and `events` only after this has run.

### Steps, in order

| Step | Rule |
|---|---|
| Apply exclusions | For each `exclusions` row created or removed since the last run, re-run 4.1b's `classify` on matching `events` rows still present with the exclusion candidate added or removed (`excluded_install`, `excluded_network`, `excluded_asn`; network matches only rows whose hash hasn't expired, ASN matches any), so the precedence in 4.1b holds. Every (install, project) pair whose rows changed goes into `recheck_queue` with reason `exclusion` |
| Sequence checks | Over events received since the last run, plus verifies received 48 to 72 hours ago that are still unmarked (so a verify that only becomes judgeable once its scaffold has had 48 hours is examined once more), add the `implausible` candidate through `classify` and queue the pair: a `verify` with a project id whose install has no stored `new` or `add` for that project (checked once the scaffold has had 48 hours to arrive, so a late batch isn't punished); `secondsSinceScaffold` larger than the gap between the scaffold's `sent_at` and the verify's `sent_at` plus 10 minutes of clock skew, or negative; a verify whose step names don't match any composition of its stack in one `registry_snapshots` payload (4.1b only checked names one by one) |
| Recheck | Work `recheck_queue` in batches of 500 pairs per run: call 4.1b's `EventStore.rebuildProject` for each pair, which rebuilds the row from that pair's unexcluded raw events or deletes it when no unexcluded scaffold remains. From 4.2d the same rebuild also recomputes the pair's `project_deps` rows. Pairs whose raw events are already pruned (older than 90 days) are dropped from the queue with a count in the `IntegrityReport`: `projects` is final after pruning |
| Installs | Upsert `installs(install_id, first_seen_at, last_seen_day, days_seen)` from the day's unexcluded events; `first_seen_at` is the earliest `received_at` of the install's unexcluded events |
| Daily metrics | Rebuild yesterday's and today's `daily_metrics(day, metric, dims, count)` rows: events by type, CLI version, `os`, `nodeMajor`, agent and `targetAgents`; exclusions by reason; error events by code and command; verify failures by step name; scaffolds by `origin` and `nonOfficial` kind. Events 4.1b rejected are never stored, so they aren't counted here; their volume shows in the platform's request logs |
| Anomaly flags | Write `anomaly_flags(day, kind, cell, details)` per the table below |
| Alert | One structured log line with field `alert` (below) when any flag was raised today or a health condition fails |

The recheck rule is the same rule 4.1b uses at write time: excluded events never build a project. Doing it in batches keeps a large exclusion from overrunning a scheduled run; the queue carries over.

### Install maturity

A project counts in public metrics only when its install was first seen at least 24 hours before the project's scaffold: `installs.first_seen_at <= projects.scaffold_at - 24 hours`. 4.2a (and 4.2c's trending) apply the rule by joining `installs`; nothing is deleted or marked, so the rule can change without a migration. It makes a one-shot stuffing burst wait a day before its projects count, which is the window in which a flag reaches a maintainer, and the 4.2a rule of publishing only finalized days adds another.

### Anomaly kinds (proposed thresholds)

| Kind | Raised when |
|---|---|
| `concentrated_contributor` | One install, network hash or ASN contributes over 20% of a stack's projects in the trailing 7 days, with at least 10 projects. 4.2a caps such contributors; this tells a maintainer it happened |
| `sequence_spike` | Implausible marks on a day exceed 5% of verify events and 20 events |
| `uniform_durations` | Over 20 green verifies for one stack in a day whose step duration buckets are all identical |
| `error_spike` | One `error` code for one CLI version more than triples against its trailing 7-day daily mean, with at least 10 events (a broken release) |
| `names_refresh_failed` | `maintenance_state.names_last_outcome` is `invalid` or `missing`. Integrity runs before 4.1c's names step, so this reports the most recent completed names step, normally the previous run's |
| `stale_success` | `maintenance_state.last_success` older than 26 hours |
| `lease_held_streak` | `maintenance_state.lease_held_count` is 3 or more: three consecutive scheduled runs exited with `lease_held` (4.1c's `withLease` keeps the count until the run holding the lease finishes) |
| `recheck_backlog` | `recheck_queue` holds more than 10,000 pairs |
| `stale_rollup` | Once [4.2a](phase-4.2a-stats-rollup-and-routes-2026-10-30.md) has landed: `maintenance_state.last_rollup` more than 3 hours old |
| `test` | Raised only by 4.1e's `scripts/queries/test-flag.sql`, which inserts it for today; checks that alert routing works |

### The alert line

```json
{ "level": "warn", "alert": { "day": "2026-11-02", "flags": [{ "kind": "error_spike", "cell": "new/TargetNotEmpty/0.4.0", "details": { "count": 41, "mean": 9.2 } }] } }
```

`alert` is the one stable field a log destination filters on; its shape is closed (`kind` from the table, `cell` a string of ids and tags, `details` numbers only). No install id, network hash or ASN appears in it: a flag on a contributor names the cell and the share, and the maintainer looks the contributor up with 4.1e's queries. A run with no flags writes no `alert` field. `stale_success` can't be raised by a run that isn't happening, so 4.1e also sets an external check on `/healthz` and on the age of `last_success` (exposed only as a boolean `maintenanceFresh` in the `/healthz` body, no timestamps).

### Escalation if stuffing gets past this

Caps (4.1b), maturity and capping (4.2a) make one machine or network expensive to fake at scale. If flags show coordinated installs across many networks anyway, the next step is a proof-of-work challenge when an install sends its first batch (the server returns a puzzle, the client solves it once and stores the token with its install id). It costs honest clients a second of CPU once. It isn't built because nothing so far says it's needed, and it changes 4.1a's protocol, which is a new schema version.

### Interfaces

```ts
export const integrity: (now: Date) => Effect.Effect<IntegrityReport, never, EventStore | IntegrityStore>;

export class IntegrityStore extends Context.Service<IntegrityStore, {
  readonly markExcluded: (match: ExclusionMatch | SequenceMatch, change: "add" | "remove") =>
    Effect.Effect<ReadonlyArray<ProjectKey>, StoreUnavailable>; // re-runs classify on matching rows; returns changed pairs
  readonly upsertInstalls: (day: string) => Effect.Effect<void, StoreUnavailable>;
  readonly queue: (pairs: ReadonlyArray<ProjectKey>, reason: RecheckReason) => Effect.Effect<void, StoreUnavailable>;
  readonly takeBatch: (size: number) => Effect.Effect<ReadonlyArray<ProjectKey>, StoreUnavailable>;
  readonly writeMetrics: (day: string, rows: ReadonlyArray<DailyMetric>) => Effect.Effect<void, StoreUnavailable>;
  readonly writeFlags: (day: string, flags: ReadonlyArray<AnomalyFlag>) => Effect.Effect<void, StoreUnavailable>;
}>()("stacks-api/IntegrityStore") {
  static memory: () => Layer.Layer<IntegrityStore>;
  static d1: Layer.Layer<IntegrityStore, never, SqlClient.SqlClient>;
}
```

`maintain` (4.1c) calls `integrity` first inside the lease. The `projects` rebuild is 4.1b's `store/projects.ts::rebuildProject`, reached through `EventStore.rebuildProject`; this sub-phase doesn't change it. 4.1c's released-versions step changes here from rebuilding re-included pairs directly to adding them to `recheck_queue` with reason `version`.

## Files and areas touched

| Path | Change |
|---|---|
| `stacks-api/apps/api/src/integrity/` | `exclusions.ts`, `sequence.ts`, `recheck.ts`, `installs.ts`, `metrics.ts`, `flags.ts`, `alert.ts`, `index.ts` |
| `stacks-api/apps/api/src/store/integrity.ts` | `IntegrityStore` (memory and D1) |
| `stacks-api/apps/api/src/maintenance/maintain.ts`, `versions.ts` | `maintain` calls `integrity` before the archive step; the released-versions step enqueues re-included pairs instead of calling `rebuildProject` |
| `stacks-api/apps/api/src/handlers/health.ts` | `maintenanceFresh` boolean |
| `stacks-api/apps/api/migrations/` | `recheck_queue`, `daily_metrics`, `anomaly_flags`, `installs` |
| `stacks-api/apps/api/tests/integrity.test.ts` | New |
| `stacks-api/.claude/rules/api/` | These tables have no public route; alert lines carry no ids |
| `stacks-api/AGENTS.md` | The integrity steps and the alert field |

## Acceptance tests

With the in-memory stores and `TestClock`, and once under the local Workers runtime with local D1:

- An install excluded after it sent a scaffold and a green verify: after the next run its events are `excluded_install`, its `projects` row is gone, and a later archive of that day carries the new counts (4.1c rewrites it).
- Removing that exclusion: the rows are unmarked and the `projects` row comes back identical to the original.
- A verify with no scaffold for its project: unmarked after 24 hours, `implausible` after 48; a scaffold arriving at hour 30 keeps it valid. A verify received just before a run, whose scaffold never arrives, is marked by a later run from the 48-to-72-hour pass even though it is no longer "since the last run".
- `secondsSinceScaffold` of 7,200 with a `sent_at` gap of 600 seconds: `implausible`. A gap of 7,100 seconds (inside skew): valid.
- A verify whose step names are each official for the stack but belong to two different compositions that never existed together: `implausible`.
- 4.1c re-including a version queues its pairs; the next run builds their `projects` rows.
- 1,200 queued pairs: 500 processed per run, the rest carried over, none lost; a pair older than 90 days is dropped and counted.
- A project scaffolded 2 hours after its install was first seen is excluded by the maturity join; a project from the same install scaffolded 25 hours after it was first seen is counted.
- An over-cap `unreleased_version` row whose install is then excluded becomes `excluded_install`; removing the exclusion returns it to `unreleased_version`, not null.
- Each anomaly kind except `test` is raised by a seeded fixture and not by the same fixture one step under its threshold; `test` is raised only by `test-flag.sql`. `names_last_outcome = 'invalid'` raises `names_refresh_failed`; `lease_held_count = 3` raises `lease_held_streak`.
- A run with one flag logs exactly one line with an `alert` field matching the closed schema; scanning it finds no install id, network hash or ASN. A run with no flags logs no `alert` field.
- `last_success` set 27 hours before the run raises `stale_success`; `/healthz` reports `maintenanceFresh: false`.
- No route in `packages/contract/src/api.ts` reads `daily_metrics`, `anomaly_flags`, `installs` or `recheck_queue` (a test over the route table's service dependencies).

## Exit criteria

- Acceptance tests pass; `bun run check` green in `stacks-api`.
- The maintainers agree the anomaly thresholds and the maturity rule, or change them in this file.
- One scheduled run under the local Workers runtime completes `integrity` and 4.1c's steps inside one lease.

## What this plan may get wrong

- The 48-hour wait for a missing scaffold is a guess about how late spooled batches arrive (4.1a keeps events up to 7 days). If many verifies are marked and later unmarked, raise it toward 7 days.
- Rebuilding `projects` from raw events only works for 90 days. An exclusion added later than that can't change what a project contributed, only what future windows count. That's stated on the privacy page as "aggregates are final after 90 days".
- `daily_metrics` by `os`, `nodeMajor` and `targetAgents` is only useful if someone reads it. 4.1e's runbook lists the queries; if a quarter passes with no decision drawn from them, drop those fields from 4.1a's next schema version.
- Thresholds were chosen before any data exists. They are config; changing them changes only future flags.
- 2026-10-28: as in 4.1b and 4.1c, there are no in-memory stores and no local Workers run. "With the in-memory stores ... and once under the local Workers runtime" means SQLite with migrations on a fresh file per test, `TestClock`, and `maintain(now)` called directly; the four tables arrive as a migration. Events reach the store through the ingest program, so the write-time rules apply; the anomaly fixtures (`test-flag.sql` among them) are SQL applied to the test database, because they describe stored state. `/healthz`'s `maintenanceFresh` is checked over real HTTP.
- 2026-10-28 (executed): the body's design held, with three additions the code needed. Verdicts whose evidence normalization or 30-day hash expiry erases (cap, implausible, network) are kept in `event_verdicts`, deleted with their events, so a later exclusion change can't silently undo them. Retention defers a day that still has queued pairs, so a pending correction isn't pruned before its rebuild. The daily flags keep a completed-day checkpoint, so a run at 03:00 still evaluates the whole previous day. The thresholds stay one constant in `stacks-api` (`integrity/policy.ts::INTEGRITY_POLICY`), not configuration keys, until a deployment needs to vary them.
