# Phase 4.2a: Stats rollup and routes

Status: EXECUTED 2026-10-28 (on SQLite on the Node host, amended D16; the wire shapes are the provisional `StatsSummary` and `StatsDetail` the site builds against)

| Field | Value |
|---|---|
| Goal | A scheduled rollup turns stored telemetry into per-stack and per-fragment window metrics over finalized UTC days, caps each contributor's share, suppresses small cells, holds public numbers back until enough stacks have enough projects, and serves them from the stats routes (`GET /v1/stats/summary`, `GET /v1/stacks/:id/stats`, `GET /v1/fragments/:id/stats`) with the last ledger run beside them |
| Traces to | Success table: "Fraction of `new --sandbox` runs that reach a green `verify` with no user intervention", "Median time from `new` to green `verify`", "Stacks and fragments in `~/.stacks` and third-party sources". The coding agent "runs `list --json`, picks a stack"; its frustration is "ambiguity". Assumption 5 ("Watch whether people use `new` from a terminal or ask their agent to run it"), D9 |
| Depends on | 4.1c (the scheduled entry, `maintenance_lease`, `maintenance_state`, `registry_snapshots`), 4.0c (each index entry's `lastRun`), 4.1d (exclusions applied and `projects` rechecked before counting; `installs` for install maturity), D17 |
| Blocks | 4.2b, 4.2c, 4.2e, 4.2f, 4.2g |
| Decisions needed | D17. If collection is opt-in or declined, this sub-phase is skipped and 4.2b shows ledger results only. New for the maintainers: the publishing gate thresholds and the cap values below (proposed values); [open question 30](../../risks-and-open-questions.md#open-questions-for-the-maintainers) (capping instead of suppressing concentrated cells) and [open question 31](../../risks-and-open-questions.md#open-questions-for-the-maintainers) (per-agent green rate as a breakdown); [open question 33](../../risks-and-open-questions.md#open-questions-for-the-maintainers) (rounding published counts to 5); [open question 38](../../risks-and-open-questions.md#open-questions-for-the-maintainers) (no window longer than 28 days) |
| Settles | Metric definitions, windows, the weekly series stride, time filtering and selection (`window`, `interval`, `from`, `to`, `sort`, `limit`, `cursor`, `kind`, `previous`), capping, suppression and rounding, the publishing gate, the rule for totals and shares over suppressed cells, the `StatsSummary` and `StatsDetail` schemas, the `population` label, the routes and the summary's cursor pagination, their caching and who reads each |

## Scope

In:

- An hourly and a daily rollup step in the Worker's scheduled entry writing `window_metrics`, both under 4.1c's `maintenance_lease`.
- Wilson intervals, per-contributor caps, suppression and the publishing gate.
- `StatsSummary` and `StatsDetail` schemas in `packages/format` (additive).
- `GET /v1/stats/summary`, `GET /v1/stacks/:id/stats`, `GET /v1/fragments/:id/stats`.

Out:

- `stats` in the CLI, in `show` and on the directory pages (4.2b).
- Sorted directory views, trending, tag and fragment pages, co-installed fragment lift (4.2c).
- Dependency metrics (4.2e).
- Internal counts by event type, error code, os or Node major (4.1d's `daily_metrics`, never on a public route).
- Ratings, reviews, accounts, per-user or per-project views, ranking agents against each other.

## Design

### Where this fits

4.1b and 4.1c store and maintain events, and 4.1d applies exclusions, rechecks `projects` and tracks install maturity. This sub-phase turns the cleaned rows into numbers and decides which numbers are fit to publish. Every route has a named reader:

| Route or table | Read by |
|---|---|
| `GET /v1/stats/summary` | `list --json` and human `list` (4.2b) |
| `GET /v1/stacks/:id/stats` | `show <stack> --json` and human `show` (4.2b) |
| `GET /v1/fragments/:id/stats` | `show <fragment> --json` and human `show` (4.2b) |
| `window_metrics` | The directory stats sections (4.2b) and sorted pages (4.2c), read through the stats routes by the site build in `stacks-api/apps/web` and by its islands at view time |
| `window`, `interval`, `from`, `to` on the detail routes | The stack page's history chart island (4.2f), which asks for 90 days, 180 days or a year of points |
| `previous` on summary entries | The browse pages (4.2c) and any client that shows change against the last window, the way trending-data APIs report it |
| `sort`, `limit`, `kind` on the summary | The site build's browse pages (4.2c: most used, highest success, trending) and API clients that want the top entries without sorting the whole list |
| `cursor` and `nextCursor` on the summary | The site build, which follows `nextCursor` until the last page, and API clients reading past one page |
| `upper` on every green-rate value | Every interval the site draws or writes (`RateMark`'s whisker, `StatLine`'s `86-95%`, 4.2f) and `list --json`'s `greenRateUpper` (4.2b) |
| `projects` per `byPreset` cell and the weekly per-preset projects series | The stack page's weekly projects by preset and its sandbox share (4.2f) |
| `projects` and `medianMinutesToGreen` per `byAgent` cell | The agent pages' share of that agent's projects and median time to green per stack (4.2c, 4.2f) |
| `byComposition` cells | The stack page's composition table (4.2f) |
| The fragment detail's weekly series, `byStack` and `oftenUsedWith` | The fragment page's weekly projects by stack, its per-stack counts, kept and attach rates and with-and-without green rates, and its "often used with" list (4.2c, 4.2f) |

A route or metric with no reader in this table is not built.

### Definitions

| Term | Meaning |
|---|---|
| Project | A distinct (install, telemetry project) row in `projects` whose install is mature: `installs.first_seen_at <= projects.scaffold_at - 24h` (4.1d). 4.1b never writes `projects` from an excluded event, and 4.1d's recheck removes rows that later exclusions cover, so no exclusion check is repeated here |
| Attempted | A project with at least one verify that isn't env blocked (a `failed` run whose failing steps all have `failureKind: "env"`) |
| Green project | At least one verify with outcome `green` (the `RunRecord` rule from 1.3b: full scope, `tamperCheck: "full"`, steps unchanged). `changed` and `partial` never count |
| Time to green | `seconds_to_green` on the project row |
| Time to first passing test | `seconds_to_first_test_pass` (the problem statement's measure for the time-pressure user) |
| No-verify share | Projects with no verify event, over all projects |
| Finalized day | A UTC receive day that has ended. The current day is never published |
| Window | Trailing 7 and 28 finalized UTC days, ending at the last finalized day, counted as distinct projects, never as a sum of events |
| Contributor | An install id, or a network hash (from the project's scaffold event in `events`) |

Every response and page says the numbers describe "stacks projects", not the ecosystem.

### Windows

Proposed here: only 7- and 28-day windows exist, and nothing longer is computed ([open question 38](../../risks-and-open-questions.md#open-questions-for-the-maintainers) asks the maintainers to confirm). A 90-day window would have no reader in the table above, and network hashes expire after 30 days (4.1c), so a longer cell couldn't apply the network cap below. Long-run trends come from the weekly series of 28-day values in `StatsDetail` (Time filtering, below), which keeps every point fully checkable.

Windows end at the last finalized day so a spike has at least the rest of a day to be caught by 4.1d's anomaly flags before any number based on it is public.

### Time filtering

Added 2026-10-27. Clients filter by time the way a trending-data API usually lets them, within what suppression allows:

| Parameter | Values | Effect |
|---|---|---|
| `window` | `7` or `28` (default `28`) | Which trailing window every value in the response describes, on the summary and detail routes. Anything else is `400 BadInput` |
| `interval` | `7` or `28` days (default `7`), on the detail routes | Spacing of the series points that come back: `7` returns every stored point, `28` every fourth one (counted back from the latest), so with `window=28` the points are non-overlapping. Anything else is `400 BadInput` |
| `from`, `to` | `YYYY-MM-DD`, inclusive, on the detail routes | Which stored series points come back: points whose end day falls in the range. Default: the 365 days ending at `through`. A span over 366 days, `from` after `to`, or a malformed date is `400 BadInput`; a range before the first stored point returns an empty series |
| `sort` | `lower` (default: green-rate Wilson lower bound), `projects`, `green` (point estimate), `trending` (4.2c's score; `400 BadInput` until 4.2c adds it) or `id`, on the summary | Order of `items`. Every order uses exact values and puts entries whose sort value is suppressed after the rest, by id, so the order reveals nothing about a suppressed cell beyond "suppressed"; ties break by id |
| `limit` | 1 to 200 (default 200), on the summary | Page size, after sorting. Over 200 is `400 BadInput` |
| `cursor` | The opaque `nextCursor` from the previous page, on the summary | Where the page starts. The response is `{ items, nextCursor? }`, with `nextCursor` omitted on the last page. The cursor is base64url of the last item's id and the rollup's `generatedAt`, decoded through a schema; it never carries the sort value, because an exact count or bound in a decodable cursor would undo rounding and suppression. The handler finds that id in the same stored order and resumes after it. A cursor that doesn't decode, or that was issued for an earlier rollup, is `400 BadInput`, so a client restarts from the first page rather than mixing two rollups |
| `kind` | `stack` or `fragment` (default both), on the summary | Which entries |

Decided here: no arbitrary date range is ever aggregated. A request can only choose which already-computed, already-suppressed cells it sees, and every parameter above is a selection or an ordering over stored cells. Aggregating `[from, to]` on demand would let anyone take two ranges that differ by one day and subtract them, recovering a single day's cell, often one or two projects, below every threshold; suppression would mean nothing. Selecting stored points gives a client no number it couldn't get by fetching the whole series and filtering it.

The series is published at a 7-day stride: stored series points end only on stride days (each UTC Sunday), which is what `interval=7` returns. A daily series had a weaker form of the differencing problem: two adjacent points of a 28-day window differ by one day in and one day out, so their difference is a net flow of a day, which can be small, and a daily `window=7` series published small cells every day. The thresholds don't stop that, because each point passes them on its own. At a 7-day stride adjacent 28-day points differ by a week in and a week out, and `window=7` points don't overlap at all, so each published 7-day point is a whole cell under the thresholds. Published counts are also rounded (below).

The summary and `previous` still describe the windows ending at the last finalized day, which moves daily; someone who fetches the summary every day can still difference consecutive days. Rounding blunts that, and the residual is recorded under "What this plan may get wrong".

Each summary entry carries `previous`: the same values (`projects`, `greenRate`) for the window of the same length that ends where the current one starts, so the two don't overlap. It is a stored cell under the same suppression, not a computed difference; a client computes the change from the two values.

### Rounding

Added 2026-10-27, proposed ([open question 33](../../risks-and-open-questions.md#open-questions-for-the-maintainers)). Counts in every public payload (`projects`, `sample`, and any count in a breakdown) are rounded to the nearest 5; rates and Wilson bounds to two decimal places (whole percents). Thresholds, orderings and the gate use exact values; only the encoded output is rounded, in `stats/encode.ts`, so stored rows stay exact and the rule can change without a recompute.

### Metrics per stack

| Question | Metric | Where |
|---|---|---|
| Is anyone using it | Projects per window | Summary, detail |
| Does it work | Green rate: green over attempted, with a 95% Wilson interval. Every green-rate value, wherever it appears (summary entries, `previous`, the detail, series points and every breakdown cell), is `{ value, lower, upper, sample, suppressed }` | Summary, detail |
| How hard is it for the agent | Median and p75 time to green; median time to first passing test; median verify runs before first green | Summary (median to green), detail |
| Where does it break | Share of failed runs before first green in which each step failed | Detail |
| Is it the stack or the machine | Env-blocked share, separately | Detail |
| How many stop before verifying | No-verify share, always beside the green rate | Summary, detail |
| How many scaffolds fail outright | Scaffold failure share: 4.1a `error` events with `command: "new"` over `new` events plus those `error` events, by error `code`. Shown beside the no-verify share so a failed `new` isn't read as a user who stopped | Detail, per stack and in the global row (see below) |
| Do people change the defaults | `--without` rate per default fragment; attach rate per optional fragment | Detail |
| Does the preset matter | Projects, green rate and median time to green per `preset` value (from `projects.preset`), as a breakdown inside one stack under the same caps and suppression; this is the `--sandbox` measure. The weekly series gains a `preset` dimension: 7-day projects per preset at each stride day, under the same caps and suppression | Detail (`byPreset`, the per-preset series) |
| Which composition broke | One cell per composition `fingerprint` (from the `new` event's payload; custom entries carry none): `{ fingerprint, with, without, greenRate, firstSeen, lastSeen, changes }`. `with` and `without` are the fragments added to and dropped from the stack's defaults, from the same payload (`fragments` against the defaults, and `without`). `firstSeen` and `lastSeen` are the first and last stride days on which the composition had a stored cell in `window_metrics`, since raw events last only 90 days (4.1c). `changes` are the registry-change markers inside that span, so a drop can be tied to one composition | Detail (`byComposition`) |
| Does it work with my agent | Projects, green rate and median time to green per `agent` value (from `projects.agent`), as a breakdown inside one stack, under the same caps and suppression. The values are the `DetectedAgent` ids the CLI records (roadmap, Contracts: Agent ids); an agent the CLI doesn't detect, Gemini for one, is recorded as `other`, so no other name can appear. Never sorted or compared across stacks, and no route lists agents in order of green rate ([open question 31](../../risks-and-open-questions.md#open-questions-for-the-maintainers)) | Detail (`byAgent`) |
| How do people arrive (D9) | Share of `new` events by `handoff` kind, and by `source` attribution (absent counts as `unknown`) | Detail; the global row also in the summary's `entryPoints` |
| Does looking lead to using | Pick rate: distinct mature installs that sent a `new` for the stack within 7 days after a `show` event for it, over distinct mature installs that sent that `show` | Detail |

Fragments get projects per window, attach rate per stack, and the green rate of compositions that include them. Added 2026-10-27, for the fragment page: a weekly series of 7-day projects including the fragment, overall and per stack (a `(fragment, stack)` dimension); `byStack`, one cell per stack it applies to, `{ stack, default, projects, attachRate | keptRate, withWithout }`, where a default fragment carries `keptRate` (1 minus its `--without` rate on that stack) and an optional one `attachRate`, and `withWithout` is the green rate of that stack's projects with the fragment against those without it, published only when both cells pass the rate thresholds (4.2e's rule for dependencies). Every cell uses the same caps and suppression. 4.2c adds `oftenUsedWith` to the fragment detail with its `cooccur` dimension, as it adds `trending` to the summary.

The scaffold failure share is computed per stack from 4.1a's `error` events, which carry `stack` when the stack resolved to an official id; failures that happened before a stack resolved (an unknown id, a usage error) are counted globally. Global rows use the reserved id `_all` in `window_metrics` and appear in `StatsDetail` for every stack under `global`.

### Caps, suppression and the publishing gate

Concentration is handled by capping each contributor's share of a cell rather than suppressing the cell ([open question 30](../../risks-and-open-questions.md#open-questions-for-the-maintainers)). Suppressing a cell that one install dominates means one heavy user, or a maintainer's own traffic, can blank out a stack's stats; capping keeps the cell and stops that one contributor from moving it.

| Rule | Value |
|---|---|
| Install cap | In each cell, at most 3 projects per install count, the earliest by `scaffold_day` and then by project id, so the choice is deterministic |
| Effective sample | `min(capped projects, 3 × distinct networks)` among the cell's projects. Every threshold below, and the Wilson interval's `n`, use the effective sample; the rate itself is computed over the capped projects |
| Any count | Hidden below an effective sample of 5 projects |
| Any rate | Hidden unless the effective attempted sample is at least 20, with at least 5 green and at least 5 not green |
| Ordering | By default the summary's `items` are ordered by the green rate's Wilson lower bound, highest first, then entries with a suppressed rate, then by id. `sort` selects another order over the same stored values (Time filtering, above) |
| Publishing gate | No public stats until at least 3 stacks each have an effective attempted sample of 20 in one 28-day window. Before then, `summary` returns `published: false` with ledger results only |

Suppressed values come back as `null` with `suppressed: true`, so clients don't need the thresholds.

Added 2026-10-27: totals and shares never reveal a suppressed cell. If a total came from the global `_all` row while one stack's cell was suppressed, the total minus the published cells would recover it. So no public total sums cells some of which are suppressed. A share, a rank or an "others" bucket is computed over the published cells only and captioned "of stacks with published counts". A true total is published only when the suppressed remainder (the total minus the published cells) is 0 or is itself at least the count threshold (an effective sample of 5). The rule applies wherever the response or a page sums cells: shares of all projects, a stack's rank by use, an agent's projects by stack, a fragment's projects by stack.

Maintainer and automated traffic is kept out before capping: bench and canary runs send nothing (2.0b and 5.1 set `DO_NOT_TRACK=1`), and 4.1e's smoke install id is in `exclusions`. The cap is the backstop for anything that still gets through.

### Rollup

Two steps in the scheduled entry, both run only while holding 4.1c's `maintenance_lease`. A run that can't take the lease logs `lease_held` and exits; the next trigger retries. Neither step reads a day that hasn't ended.

| Step | When | Recomputes |
|---|---|---|
| Hourly | Every hour (a cron added to 4.1c's daily one) | The 7- and 28-day windows ending at the last finalized day, so events that clients flushed late still land in it |
| Daily | In 4.1c's daily run, after 4.1d's exclusion and recheck steps | Every window ending in the last 28 finalized days, so exclusions, rechecks and released-version changes reach every number still being shown. Older series points are kept as computed |

Distinct networks for a window are counted when that window is first computed by the hourly step. At that point every day in it is at most 28 days old, inside the 30-day hash life (4.1c), so every scaffold event still has its hash. The count is stored in the row's payload, and later recomputes by the daily step reuse it (capped at the new project count) instead of recounting hashes that may have expired since.

Each step reads `projects` and `events` through `effect/sql` and writes `window_metrics(day, window, dimension, name, payload)`, where `day` is the window's last day; rerunning a day replaces its rows. Rows ending in the last 56 finalized days are kept for every day, so the current window, `previous` and 4.2c's trending inputs (the 28-day window ending 7 days back) always exist; the daily step deletes older rows that don't end on a stride day, so the stored series is weekly. It also writes the gate result. After a successful run the hourly step writes `maintenance_state.last_rollup` (the time it finished). 4.1d's daily alert reads it and raises a stale-rollup flag when it is more than 3 hours old.

`projects` holds what every project has (stack, fragments, handoff, agent, `preset`, `scaffold_at`, the verify timings and `verify_runs_to_green`, 4.1b). The breakdowns that need more come from the scaffold event itself: `without`, `source` and the composition `fingerprint` are read from the project's `new` event's `events.payload` within the 28-day window, where raw events always still exist (90-day retention, 4.1c). This sub-phase adds no `projects` column.

Registry-change markers come from 4.1c's `registry_snapshots`: for each stack, every snapshot in which that stack's recorded entry (its fragment set, its verify step names, and its bundle digest when the snapshot records one) differs from the previous snapshot is a marker `{ day, digest }`. The weekly series in `StatsDetail` carries them, each marker keeping its exact day, so a drop in green rate can be tied to a content change.

### Routes

```
GET /v1/stats/summary?window=28
200 {
  "generatedAt": "...", "through": "2026-10-25", "population": "stacks projects",
  "window": 28, "published": true,
  "entryPoints": { "handoff": { "launch": 0.41, ... }, "source": { "skill": 0.22, ... } },
  "items": [{
    "id": "go-cli", "kind": "stack",
    "projects": { "value": 215, "suppressed": false },
    "greenRate": { "value": 0.91, "lower": 0.86, "upper": 0.95, "sample": 180, "suppressed": false },
    "noVerifyShare": { "value": 0.12, "suppressed": false },
    "medianMinutesToGreen": { "value": 14, "suppressed": false },
    "lastRun": { ... }          // the index entry's lastRun (4.0c), unchanged
  }],
  "nextCursor": "..."           // omitted on the last page
}
GET /v1/stats/summary?window=28&sort=projects&limit=10&kind=stack   -> StatsSummary
GET /v1/stats/summary?window=28&cursor=...                         -> the next page
GET /v1/stacks/:id/stats?window=28&interval=7&from=2026-04-01&to=2026-10-25  -> StatsDetail
GET /v1/fragments/:id/stats?window=28&interval=7&from=...&to=...    -> StatsDetail (fragment fields)
```

No `/v1` route ends in a path param (the API's routing rule: a trailing param would capture a static document's path), so each detail route sits under its resource and ends in the literal `stats`.

`population` is one of two literals: `"stacks projects"`, or `"seeded development data"` when the store holds 4.2g's seed marker (complete or not) or any `projects` row carries 4.2g's reserved seeded install-id form. `stats/encode.ts` checks both, so a store copied without its marker row still labels itself. Every client prints it, so seeded numbers label themselves wherever they appear.

Summary entries also carry `previous` (`{ projects, greenRate }`, same shapes) as described under Time filtering. `GET /v1/stats/summary?window=28&sort=projects&limit=10&kind=stack` is the most-used list.

`StatsDetail` for a stack: the summary row; both windows; a weekly series (7-day stride, thinned by `interval`) of the requested window's projects and green rate (with its Wilson bounds) for every computed end day between `from` and `to`, with `changes` markers, and the 7-day projects per preset at the same points; step failure shares; env-blocked share; fragment `--without` and attach rates; `byAgent` (projects, green rate and median time to green per agent); `byPreset` (projects, green rate and median time to green per preset) and `byComposition` (the cells above) when their fields are sent; `entryPoints` for the stack; `pickRate`; the stack's scaffold failure share by code; and `global` (scaffold failure share by code, the global entry-point shares). For a fragment: projects, the weekly series overall and per stack, `byStack`, and the green rate of compositions including it. Every value uses the `{ value, suppressed }` shape, and every green rate carries `lower` and `upper`.

`lastRun` is read from the static index through the assets binding, so the summary never disagrees with the index. Responses carry `Cache-Control: public, max-age=3600, stale-while-revalidate=3600` and an `ETag` over the encoded body, and answer `If-None-Match` with 304; the API's default is `no-store`, so each stats route declares this itself. The query string is part of the cache key, and only the declared parameters are accepted (an unknown parameter is `400 BadInput`, so caches can't be filled with junk variants). Unknown or malformed ids return the `NotFound` envelope. Errors use the shared envelope. No route ends in a path param or a file extension.

## Files and areas touched

| Path | Change |
|---|---|
| `stacks-api/apps/api/src/stats/` | `rollup.ts`, `wilson.ts`, `cap.ts`, `suppress.ts`, `gate.ts`, `markers.ts`, `encode.ts` (rounding and the `population` label at output) |
| `stacks-api/apps/api/src/handlers/stats.ts`, `stacks-api/packages/contract/src/api.ts` | Routes, in the contract both apps import |
| `stacks-api/apps/api/migrations/` | `window_metrics` table |
| `stacks-api/apps/api/src/platform/worker.ts`, `wrangler.jsonc` | Hourly cron; daily step added after 4.1d's steps |
| `packages/format/src/stats.ts` | `StatsSummary`, `StatsDetail` |
| `stacks-api/apps/api/tests/stats.test.ts` | New |
| `stacks-api/AGENTS.md` | Metric definitions in the words above |

## Acceptance tests

- Over a seeded store: green rate, Wilson bounds, median and p75 match hand-computed values; twenty verify events in one project count once.
- Every published green-rate value (summary entries, `previous`, series points, `byPreset`, `byAgent`, `byComposition`, a fragment's `byStack`) has `upper` equal to the hand-computed Wilson upper bound, rounded to two decimals; a suppressed one has `lower` and `upper` null.
- An effective attempted sample of 19: `greenRate: null, suppressed: true`. 4 not-green: rate suppressed.
- One install with 30 projects in a cell of 100: it counts 3, and the cell is published, not suppressed. One network holding 40 of 50 projects across 3 networks: effective sample 9, so the rate is suppressed but the count is shown.
- A project from an install first seen 2 hours before its scaffold is not counted; the same install's later project, scaffolded 25 hours after it was first seen, is.
- Two qualifying stacks: `published: false`, ledger results only. Three: `published: true`.
- A `changed` or `partial` verify never makes a project green.
- Events received today change no `window_metrics` row; the summary's `through` is yesterday.
- No `window_metrics` row has a window other than 7 or 28.
- The summary's `items` order: highest Wilson lower bound first, suppressed rates after, ties by id.
- Cursor pagination: with `limit=2` over five entries, following `nextCursor` returns every entry once, in the same order as one unpaged request, and the last page has no `nextCursor`; the decoded cursor holds only an id and `generatedAt`, never a count or a bound; a malformed cursor, or one issued before the latest rollup, is `400 BadInput`.
- Totals and shares: a fixture where one of four stacks' counts is suppressed publishes no total of all projects, and every share and "others" value is over the three published cells; with that cell's remainder at 0, or at 5 or more across several suppressed cells, the true total is published.
- `byPreset` for a stack scaffolded with `default` and `sandbox` presets returns both, each with `projects`, under suppression rules, and the series carries 7-day projects per preset at each stride day; `without` and `source` shares match seeded `new` event payloads; the median verify runs before first green matches seeded `verify` events.
- A successful hourly run sets `maintenance_state.last_rollup`; a run that fails or can't take the lease leaves it unchanged.
- `byAgent` for a stack with two agents returns both, each with `projects` and `medianMinutesToGreen`, under suppression rules; no route returns agents sorted by green rate; a seeded project recorded with agent `other` appears under `other`, and no other id than a `DetectedAgent` value appears.
- `byComposition` over seeded `new` events with the defaults, the defaults plus one optional fragment, and the defaults minus one returns three cells with the matching `with` and `without`; a composition whose stored cells span two stride days months apart has those as `firstSeen` and `lastSeen` after its raw events are pruned; a marker inside that span is in its `changes`.
- A fragment detail over seeded projects in two stacks returns a weekly series per stack and a `byStack` cell for each, with `keptRate` where the fragment is a default and `attachRate` where it is optional; `withWithout` is published only where both cells pass the rate thresholds.
- Seeded `error` events give the scaffold failure share by code for their stack, and events with no stack only under `global`; seeded `show` and `new` events give the expected pick rate, and a `new` 8 days after the `show` doesn't count.
- `entryPoints` matches seeded `handoff` and `source` values, with absent `source` as `unknown`.
- Two `registry_snapshots` rows where `go-cli` gained a step: one marker on the snapshot's day in `go-cli`'s series; none in another stack's.
- A rollup started while a fixture holds `maintenance_lease` writes nothing and logs `lease_held`.
- With `TestClock` moved 10 days on and hashes for the oldest days nulled, the daily step's recompute of an earlier window keeps the stored distinct-network count and its effective sample.
- Rerunning the rollup for a day gives identical rows; after 4.1d excludes an install and rechecks, the daily step changes only the windows that install's projects fall in.
- Under the local Workers runtime, the hourly trigger writes `window_metrics` and `GET /v1/stats/summary` and `GET /v1/stacks/:id/stats` return them with the cache header.
- `window=7` returns 7-day values on the summary and a series of 7-day points on the detail route; `window=90`, `window=abc` and an unknown parameter return `400 BadInput`.
- After the daily step, no stored row older than 56 finalized days ends on a day other than a stride day (a UTC Sunday); the detail series has one point per stride day; `interval=28` returns every fourth point counted back from the latest, and with `window=28` no two returned points overlap; `interval=14` is `400 BadInput`.
- `previous` on a summary entry equals the stored cell for the window ending the day before the current window starts, suppressed under the same rules.
- `sort=projects&limit=3&kind=stack` returns the three stacks with the most effective projects, exact values deciding the order, entries with a suppressed count after the rest by id; `sort=trending` before 4.2c is `400 BadInput`; `limit=0`, `limit=201` and `kind=app` are `400 BadInput`.
- The contract has no route ending in a path param: `GET /v1/stacks/go-cli/stats` answers, and `GET /v1/stats/stacks/go-cli` is the `NotFound` envelope.
- `from=2026-09-01&to=2026-09-30` returns exactly the stored points with end days in September; `from` after `to`, a span of 367 days and `from=2026-13-01` return `400 BadInput`; no request causes a window to be computed that the rollup didn't store (the handler reads `window_metrics` only).
- A cell of 212 projects is published as 210 and a sample of 183 as 185; a rate of 0.9137 as 0.91; the gate and ordering use the exact values (a fixture where rounding would reorder two entries keeps the exact order).
- A repeated request with the response's `ETag` in `If-None-Match` gets 304 with no body.
- With 4.2g's seed marker in the store (`complete` true or false), `population` is `"seeded development data"`; with no marker but one `projects` row carrying the reserved seeded install-id form, also `"seeded development data"`; with neither, `"stacks projects"`.

## Exit criteria

- Acceptance tests pass; `bun run check` green in `stacks-api`, and from this repository's root for the `StatsSummary` and `StatsDetail` schemas added to `packages/format` (published before the API uses them).
- The maintainers agree the gate thresholds and cap values, and answer open questions 30 and 31.
- The publishing gate is computed by the rollup, never set by hand.

## What this plan may get wrong

- 2026-10-27 (maintainers: REST conventions, roadmap "API route map"): `GET /v1/stats/summary` is `GET /v1/stats`, the collection of per-entry stats, and the detail routes' params are `{stackId}` and `{fragmentId}`. The summary `sort` values are field paths with a direction: `lower` is `-greenRate.lower` (still the default), `projects` is `-projects`, `green` is `-greenRate`, `trending` is `-trending.score` and `id` stays `id`. Read every example here with those names. Storage is SQLite on the Node host (amended D16; 4.1b's dated line), and the hourly trigger is a Node timer in `apps/api/src/platform/` running the same rollup program under 4.1c's lease, so read "the local Workers runtime" in the tests as the Node server with a temporary database file.

- The gate may take a long time to meet. That is information about adoption, and the ledger results still give clients something true.
- The no-verify share still mixes people who stopped with sandboxes that blocked telemetry (4.1a). The scaffold failure share separates failed `new` runs per stack only when the failure happened after the stack resolved; earlier failures stay global.
- Capping at 3 projects per install and `3 × networks` are guesses. They are config: changing them recomputes windows on the next daily step.
- Registry-change markers are only as fine as `registry_snapshots`: a prose-only edit shows up only if the snapshot records bundle digests.
- Recomputing 28 end days of 28-day windows daily may get slow on D1. If it does, compute daily partials and sum distinct project ids per window from them.
- 2026-10-27: the routes had no time parameters, and a request for trending-API-style filtering assumed 7-, 28- and 90-day windows existed; only 7 and 28 ever did. `window`, `interval`, `from` and `to` now select stored cells, and published counts are rounded to 5. Rounding alone didn't stop differencing between adjacent daily points, and `window=7` published a daily 7-day series of small cells, so the series is now stored and published at a 7-day stride. The summary still moves daily, so a client polling it every day can difference consecutive days' windows; rounding blunts that, and if the maintainers want it closed, the summary's `through` should advance only on stride days too, at the cost of numbers up to a week old (which would also change 4.2f's stale rule). If they reject rounding (open question 33), the residual risk is larger.
- 2026-10-27: `stacks-api/.claude/rules/api/effect-api.md` puts each store in `api/services/<Name>Store.ts` (an in-memory layer and a SQL layer needing only `SqlClient`); `apps/api/src` has no `services/` folder yet. This plan's `stats/` and `store/` paths predate that rule ([open question 37](../../risks-and-open-questions.md#open-questions-for-the-maintainers)). Follow whichever the maintainers settle when this executes.
- 2026-10-27: the route lacked what a standard trending-data API offers (an `interval`, change against the previous window, `sort`, `limit` and `kind` on the summary). They are added as selections and orderings over stored cells; none aggregates anything new.
- 2026-10-27: the detail routes were `GET /v1/stats/stacks/:id` and `GET /v1/stats/fragments/:id`, which end in a path param against the API's routing rule, and the summary returned `entries` with a `limit` and no cursor, against its list rule. The routes are now `GET /v1/stacks/:id/stats` and `GET /v1/fragments/:id/stats`, and the summary returns `{ items, nextCursor? }`. One difference from that rule remains: its cursor encodes the last item's sort key and id, and here it encodes the id and the rollup's `generatedAt` only, because the sort key is an exact, unrounded value. Resuming after an id costs a scan of the stored order, which is small.
- 2026-10-27: a review of the site's design mocks found no upper interval bound (every mock draws `86-95%` and whiskers), no complement rule for totals, and breakdown cells too thin for the pages (`byPreset` and `byAgent` had no `projects`, `byComposition` no fields, the fragment detail no series or per-stack cells). Those are added above, each with its reader. Still open for the maintainers: a published count of failed runs before first green (for an `n=` on step failures) and counting `add` events into a fragment's projects.
- 2026-10-27: the mocks show stars (counts on every row and page, a "Starred" view, an avatar). The site leaves them out, and no route counts them, per roadmap "Won't have" ("Ratings, reviews, accounts").
- 2026-10-27: `StatsSummary` and `StatsDetail` are written ahead of this sub-phase, provisionally, so 4.2f's pages can be built on fixtures (4.2f, 2026-10-27). When this sub-phase executes, its routes encode those schemas; a change to them updates the site's fixtures and tests in the same change.
- 2026-10-27: the provisional schemas settle what the prose left open. A suppressed cell's `value` is `null`, and a suppressed green rate nulls `lower`, `upper` and `sample`. An unpublished response carries the header and ledger identities with no metrics. `previous` is required. The detail echoes `interval`, `from` and `to` and carries both windows under `windows["7"]` and `windows["28"]`. Breakdowns are keyed arrays, required and possibly empty; step-failure and error-code shares are records. A fragment's `withWithout` cells publish together or not at all, and a default fragment carries `keptRate` where an optional one carries `attachRate`. One difference from the prose: `entryPoints` follows the route example's plain share maps, with suppressed categories omitted, not `{ value, suppressed }` cells.
- 2026-10-28: on the Node host (amended D16), the hourly and daily rollups are steps of 4.1c's `maintain` under its lease, driven by its Node timer in `apps/api/src/platform/`; there is no `worker.ts`, `wrangler.jsonc` or cron trigger, and "under the local Workers runtime" in the acceptance tests means the Node server over a SQLite file. Tests use SQLite with migrations on a fresh file per test and `TestClock`, with no in-memory store; events enter through the ingest program and 4.1d's steps, so counts come from rows those steps checked. The routes follow the 2026-10-27 REST line above (`GET /v1/stats`, `{stackId}`, `{fragmentId}`), and the response schemas are the published `StatsSummary` and `StatsDetail` from `@steamfield/stacks-format`.
- 2026-10-28: those schemas have no total, rank or "others" field, so no route publishes a total of all projects, and the totals rule's first half holds by construction. Shares are computed over published cells only, and the acceptance test for totals checks that. Publishing the true total when the suppressed remainder is 0 or at least 5 waits until a page needs a total and a schema field carries it; that field is a `@steamfield/stacks-format` change, tested here when it lands. The reserved seeded install-id form is 4.2g's (its 2026-10-28 line: a version 8 UUID with prefix `5eed5eed`).
- 2026-10-28 (after execution, manual QA over a seed of the bundled registry): the median and p75 minute metrics publish unrounded floats (`26.28333333333333`); `noVerifyShare` and the minute medians publish on cells whose `projects` is 5 or whose `greenRate` is suppressed, so a small cell's shares are visible; a `BadInput` envelope names no parameter or expected values; the OpenAPI document declares `window` and `interval` as string enums `"7"`/`"28"` while responses carry numbers; one week of python-react's seeded series has a suppressed `greenRate` beside 75 projects, unexplained. Each wants a failing test, then a fix. Every response also changes shape under D38 (columnar lists).
- 2026-10-28 (diagnosis): python-react's suppressed week is correct. It is the 28-day cell ending 2026-09-06, with 77 projects (75 after rounding), 70 attempted and 66 green. Only 4 attempts were not green, below the rate rule's minimum of 5 (`stats/suppress.ts`), so no rollup change is needed. The seed's active-scale profile should keep its storylines clear of that boundary.
- 2026-10-28 (D38 execution): `StatsSummary` and `StatsDetail` change in place in `@steamfield/stacks-format` 0.3.0, a breaking change to schemas 0.1.0 published, which the 0.x minor carries. Their list fields use the format package's `Columnar` schema: the encoded side is the column object, the decoded side the same rows as before, so `stats/encode.ts` and every reader keep row types and only the wire changes.
- 2026-10-28 (landed): the columnar stats lists are on this repository's `main` (Q1b). In `stacks-api`, the QA fixes are on `main`: minute metrics are rounded, shares and medians are suppressed on small cells, and `BadInput` names the parameter and its expected values, with `window` and `interval` numeric in OpenAPI. The API's wire changes when it picks up 0.3.0.
- 2026-10-28 (landed, stacks-api): the API depends on `@steamfield/stacks-format` 0.3.0 and serves columnar stats lists; Effect's default OpenAPI already documents the encoded object-of-arrays shape, so no document transform was needed. The site decodes with format's `StatsSummary`, `StatsDetail`, `StatsDeps` and `StatsDep`; its provisional schema copies are deleted, and its fixtures store columnar wire bodies. Built page text is unchanged.
