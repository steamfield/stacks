# Phase 4.2b: Stats in the CLI and the directory

Status: EXECUTED 2026-10-28 (the CLI half, tests 1-9; the site section, tests 10-11, moved to 4.2f's frontend work)

| Field | Value |
|---|---|
| Goal | Agents see per-stack stats in `list --json`, and the detail for one entry (step failures, per-agent breakdown, weekly series with content-change markers) in `show --json`, from cached, bounded fetches that never fail a command, and people see a stats section on each directory page, built into the static site in `stacks-api/apps/web` from the stats routes, dated, with an explicit "not enough runs yet" state when there is nothing to show |
| Traces to | The coding agent "runs `list --json`, picks a stack" and its frustration is "ambiguity". Success rows 1 and 2 across users |
| Depends on | 4.2a (the stats routes and `window_metrics`), 4.0d (the cached-fetch rules this reuses), 4.0e (the directory pages in `apps/web` and their stats section component), 3.1a (`show` and `ShowReport`) |
| Blocks | 4.2c's telemetry views, 4.2f |
| Decisions needed | D17. If declined, this sub-phase is skipped: the directory already shows ledger results (4.0e) and `list --json` already shows `lastRun` (4.0d) |
| Settles | The `stats` field in `list --json` and `show --json`; the agent guide's rule for using it; how stats reach the static pages (at build time, with an island for anything fresher); what a page says when it has no numbers |

## Scope

In:

- A `Stats` service in the CLI fetching `/v1/stats/summary` and `/v1/{stacks,fragments}/:id/stats` with 4.0d's cache, deadline and backoff rules.
- `stats` on each `list --json` item and one line in human `list`; `stats` on `show --json` from the detail route and a few lines in human `show`.
- One sentence in the no-argument agent guide (1.4).
- The stats section of each directory stack page and the index page in `stacks-api/apps/web`, filled at site build time from the stats routes: the numbers, the per-step failure breakdown, the date they were computed, or a fixed "not enough runs yet" sentence. The site is rebuilt and redeployed after each index deploy and after each daily rollup.

Out:

- New metrics or suppression rules (4.2a owns them).
- Rendering pages in the Worker. The API serves only JSON routes and static files.
- Sorted list pages, tag pages, fragment pages and pages for removed stacks (4.2c).

## Design

### Where this fits

4.2a computes and gates the numbers. This sub-phase shows them in two places. The Astro directory from 4.0e stays the source of every page; this adds only the stats section.

### CLI

The fetch follows 4.0d's rules exactly (cite, don't copy: 24-hour TTL, 1,500 ms deadline, 10-minute failure backoff, 24-hour backoff on 404, nothing under `--offline`, nothing during `verify`). Each cached resource has its own body file and its own state file, under `$XDG_CACHE_HOME/stacks/stats/`: the summary is `summary.json` with `summary.state.json`, and each detail is `<kind>-<id>.json` with `<kind>-<id>.state.json`. A state file has 4.0d's `state.json` shape (`{ url, cachedAt, lastAttempt, lastOutcome, backoffUntil }`), so backoff after a failed detail fetch applies to that entry only. The response is decoded with `StatsSummary` from `packages/format`; a decode failure is treated like a network failure. The summary is paged (`{ items, nextCursor? }`, 4.2a); the service follows `nextCursor` within the same deadline and caches the joined items as one body, and a failed or expired page counts as a failed fetch of the whole summary.

When `published` is true and the summary has the id, each `list --json` item gains:

```json
"stats": { "window": 28, "through": "2026-10-25", "population": "stacks projects",
           "projects": 215, "greenRate": 0.91, "greenRateLower": 0.86, "greenRateUpper": 0.95,
           "sample": 180, "noVerifyShare": 0.12, "medianMinutesToGreen": 14 }
```

with suppressed values as `null`. `greenRateUpper` and `sample` (the green rate's effective attempted sample, 4.2a) were added 2026-10-27 so an agent can quote the interval and `n` it reports; both are additive, under the same rules as the `packages/format` fields they mirror. `population` and `through` are the summary's (4.2a), repeated per item so an agent quoting one stack's numbers has their label and date with them; seeded development data (4.2g) says so here. When the summary is unavailable or unpublished, the field is absent, never an error or a warning. Stats are fetched only from `AppConfig.apiUrl`, which `config.ts` takes from a constant `DEFAULT_API_URL` that `bin.ts` passes in, the same way it passes `INDEX_PUBLIC_KEYS` (4.0d). No env variable or setting can change it in a release build; only the test helper passes a different value, pointing at a local server, and a source build (`AppConfig.releaseBuild` false) also accepts a loopback `STACKS_DEV_API_URL` for the seeded local API (4.2g). With a non-default `STACKS_INDEX_URL`, no stats are fetched, since they would describe a different set of entries. 4.2d sends dependency reports to the same `apiUrl`. Human and agent `list` add `green 91% (n=180)` when unsuppressed, and `green 91% (n=180, seeded)` when `population` is `"seeded development data"`, so a seeded number never appears in text output without its label.

### `show`

`show <id>` (3.1a) fetches `GET /v1/stacks/:id/stats` or `/v1/fragments/:id/stats` under the same rules, cached per entry as described above, and only for entries whose origin is `bundled` or `index`: a user, project or source copy is not what the numbers describe, the same rule 3.1a uses for `lastRun`. `ShowReport` gains an optional `stats` field (additive, decoded with `StatsDetail` from `packages/format`): the summary numbers, `population`, `through`, step failure shares, `byAgent`, `pickRate` and the weekly series (4.2a's 7-day stride) with its `changes` markers, suppressed values as `null`. Absent when the fetch fails, the summary is unpublished, or the origin doesn't qualify. Human and agent `show` add the summary line (ending `, seeded` inside its `n=` parenthesis for seeded data, as in `list`), the three steps that fail most before first green, and, when the latest marker is newer than the window start, `content changed <date>`.

The detail route is what makes `show` useful to a stack author: which step breaks, and whether the break started when the content changed.

The agent guide gains one sentence: "When two stacks fit equally well, prefer the higher `stats.greenRateLower` and say why; if neither has stats, prefer the more recent `lastRun`."

### Directory stats

The pages stay static files built by `apps/web`. At build time, behind the `STATS_ENABLED` site switch (roadmap, Contracts: Site feature switches), the site fetches `GET /v1/stats/summary` (every page, following `nextCursor`) and `GET /v1/stacks/:id/stats` for each indexed stack through `HttpApiClient` over `packages/contract`, decodes them with `StatsSummary` and `StatsDetail`, and fills each page's stats section component:

1. Published with values: projects, green rate with interval, median time to green, no-verify share, the per-step failure shares before first green, the population label, and "computed <generatedAt>, through <through>". Astro escapes every value.
2. Unpublished, or every value suppressed: one fixed sentence, "Not enough runs yet to publish numbers for this stack.", followed by the last ledger run line the page already has, so a page with no numbers doesn't look broken.
3. Stats routes unreachable during the build: the build fails rather than publishing pages that silently dropped their numbers; the previous deploy stays live.

The index page `/` gets one cell per stack the same way, with the fixed sentence shortened to "not enough runs yet". Pages keep 4.0e's `_headers` rule (`public, max-age=300`).

The site is rebuilt after each index deploy and after each daily rollup (4.2a), by a scheduled job in `stacks-api`'s own CI, or by a maintainer by hand until that exists. A stack page also carries one small island that fetches `GET /v1/stacks/:id/stats` at view time and replaces the section when the response's `through` is newer than the built one, so a page is never more than a rollup behind; with JavaScript off or the fetch failing, the built section stays.

This sub-phase builds the section's data path and its three states with plain markup. How the section looks, which chart answers which question, and the rest of the stack page's stats layout belong to [4.2f](../../phases/phase-4.2f-stats-pages-and-charts.md), which rebuilds `StatsSection` from its components and merges this freshness island into its one history-chart island.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/core/stats.ts` | `Stats` service |
| `packages/cli/src/config.ts`, `src/bin.ts`, `tests/helpers/cli.ts` | `AppConfig.apiUrl` from `DEFAULT_API_URL`, passed by `bin.ts`; the test helper passes the local server's URL |
| `packages/cli/src/commands/list.ts`, `show.ts`, `src/core/guide.ts` | `stats` fields, show lines, guide sentence |
| `packages/cli/src/schemas/` | `list --json` item and `ShowReport` gain optional `stats` |
| `stacks-api/apps/web/src/components/StatsSection.astro`, `src/components/StatsRefresh.tsx`, `src/lib/stats-data.ts` | The built section, the view-time island, the build-time fetch |
| `stacks-api/apps/web/astro.config.mjs`, `apps/web/src/site-config.ts` | The `STATS_ENABLED` switch (`astro:env` `envField`, `context: "server"`) |
| `packages/cli/tests/` and `stacks-api/apps/web/tests/` | New, one set in each repository |
| `packages/cli/README.md` | The `stats` field |

## Acceptance tests

1. CLI against a real local stats server: `list --json` items gain `stats`, with `greenRateUpper` and `sample` equal to the summary's `greenRate.upper` and `greenRate.sample`, and both `null` when the rate is suppressed; a summary served in two pages gives the same `stats` as one page; with the server down, hanging, returning bad JSON, or under `--offline`, stdout equals the output without the feature except the absent field, and the command finishes within 1.5 s of the offline run.
2. `published: false`: no `stats` field.
3. A second `list` within 10 minutes of a failure makes no request. A failed detail fetch for one entry backs off only that entry's state file.
4. No env variable changes the stats host of a release build: with only `STACKS_API_URL`, `STACKS_DEV_API_URL` or similar set and `releaseBuild: true`, requests still go to `AppConfig.apiUrl` (4.2g tests the source-build case).
5. With `STACKS_INDEX_URL` set to a non-default host: no stats request.
6. `verify` makes no stats request.
7. `show go-cli --json` against the local server has `stats` that decodes with `StatsDetail`, including `byAgent` and the series with a seeded change marker; with the server down, `show --json` equals the output without the feature minus the field. A user-directory copy of `go-cli` makes no detail request and has no `stats`.
8. Human `show` prints the three most-failing steps and `content changed <date>` for a seeded marker inside the window.
9. Against a server reporting `population: "seeded development data"`, human and agent `list` print `green 91% (n=180, seeded)` and `show` prints `seeded` in its summary line; with `"stacks projects"`, neither prints `seeded`.
10. Site, built against a local API with seeded metrics: `/stacks/go-cli/index.html` contains the stats section, the per-step failure shares and the computed and through dates; with the gate unmet, the section is the fixed "Not enough runs yet" sentence and the rest of the page is unchanged; a stack name or step name containing `<` in a fixture is escaped; with the API down, the build fails; with `STATS_ENABLED` off, no page has a stats section and no stats request is made.
11. The island, given a response with a newer `through`, replaces the section; given an older one or a failed fetch, leaves it.

## Exit criteria

- Acceptance tests pass; `bun run check` green from this repository's root and in `stacks-api`.
- `AGENTS.md`, the CLI README, `stacks-api/AGENTS.md` and the directory's about text define every metric in 4.2a's words.

## What this plan may get wrong

- 2026-10-27 (roadmap "API route map"): the summary route is `GET /v1/stats`, not `/v1/stats/summary`, and its `sort` values are `-greenRate.lower` (default), `-greenRate`, `-projects`, `-trending.score` and `id`. The site's build-time reader (`stacks-api/apps/web/src/data/read-stats.ts`) and its fixture server still use the old names and move with the site work.

- A stack author may want the daily series as a chart. With the site in Astro that is one more island over the detail route; it is left out until someone asks, and the series is in `show --json` for anyone who wants to plot it. 2026-10-27: the maintainers asked; [4.2f](../../phases/phase-4.2f-stats-pages-and-charts.md) draws it, as a static chart with one island.
- 2026-10-27: `stats` carried only `greenRate` and `greenRateLower`, so an agent asked to quote a stack's interval and `n` couldn't from `list --json`; `greenRateUpper` and `sample` are added. The detail routes moved to `/v1/stacks/:id/stats` and `/v1/fragments/:id/stats`, and the summary is paged (4.2a).
- 2026-10-28 (execution): this run builds the CLI half only (tests 1-9, in this repository); the site's stats section (tests 10-11) is the frontend work in `stacks-api/apps/web` that 4.2f already carries. The routes are columnar under D38 (`@steamfield/stacks-format` 0.3.0's `Columnar` schemas decode to rows, so the cache holds decoded rows). `AppConfig.apiUrl` and the loopback `STACKS_DEV_API_URL` already exist (4.5e); this adds `DEFAULT_API_URL`, still unset until a host exists, so a release build fetches no stats yet. The fetch reuses one cached-fetch module extracted from 4.0d's remote index, shared with 4.2d's allowlist. Acceptance tests are numbered from this date; the plan carries no traced line because tests 10-11 live in `stacks-api`.
- 2026-10-28 (landed): the CLI half is on `main`. `core/stats.ts` owns the summary paging, the per-entry detail cache and backoff, and `--offline`. `core/stats-text.ts` renders the one stats line that `list` and `show` share. Build-time facts reach config as one `Build` value (`releaseBuild`, `defaultApiUrl`) from `bin.ts`, and tests and scripts use `SOURCE_BUILD`. The stats test fixtures are columnar on the wire, so test values built from rows are checked with `Schema.toType`.
- Agents may ignore `stats`. Test with a bench run (2.0b) where two stacks fit and see whether the pick and its explanation change before promoting it.
- 2026-10-27: the plan rendered stats into the pages in the Worker by replacing a marker, with no client JavaScript. Under D35 the pages are an Astro site built at build time, so the Worker renders nothing and fresher numbers come from an island. A rebuild per daily rollup costs one CI run a day; if that becomes a burden, rely on the island and rebuild only after index deploys.
