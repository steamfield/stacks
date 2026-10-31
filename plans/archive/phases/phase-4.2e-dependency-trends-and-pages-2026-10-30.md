# Phase 4.2e: Dependency trends and pages

Status: EXECUTED 2026-10-28 (D25 decided; the maintainers review the allowlist names)

| Field | Value |
|---|---|
| Goal | The rollup turns 4.2d's dependency reports into per-dependency and per-ecosystem numbers (how many projects use it, which majors, how that is moving, what it is used with, how it does per stack), under 4.2a's caps, suppression and publishing gate, and the directory in `stacks-api/apps/web` shows them on static pages built from two dependency stats routes, and in a dependencies section on each stack page |
| Traces to | Assumption 2, "version-less prose rots much more slowly than versioned templates": a stack author sees which majors agents install today for their stack, and when that shifts, without rerunning anything. The stack author: "a way to know a stack still produces a working project without running it by hand" |
| Depends on | 4.2d (the dependency reports and tables), 4.2a (the rollup, caps, suppression, gate and lease), 4.2b (the build-time stats fetch and rebuild schedule), 4.2f (the charts and states the pages render through: major shares as 100% stacked bars and areas, transitions as a `from → to` table, lift as a bar list), 4.2c soft (the browse links; without it the pages stand alone) |
| Blocks | Nothing |
| Decisions needed | D25 and D17, through 4.2d. The thresholds below reuse 4.2a's; any new one is listed here for the maintainers |
| Settles | Dependency metrics and their definitions, transitions, co-installed dependency lift, the dependency pages, and the two dependency stats routes the site reads |

## Scope

In:

- New dimensions in 4.2a's daily rollup step: `dep`, `dep_major`, `dep_stack`, `dep_transition`, `dep_cooccur`, `ecosystem`.
- `GET /v1/deps/:ecosystem/stats` (the ecosystem's numbers and its dependencies with their metrics) and `GET /v1/deps/:ecosystem/:name/stats` (one dependency's metrics), returning `StatsDeps` and `StatsDep` from `packages/format` (additive), with the same `{ value, suppressed }` shape and gate as 4.2a's routes, and 4.2a's `interval`, `from` and `to` parameters on `/v1/deps/:ecosystem/:name/stats`, which select stored series points of the major shares and never aggregate a new range. The site build is their named reader (the major-share area chart 4.2f specifies draws over time from them); the CLI doesn't call them.
- Astro pages in `stacks-api/apps/web` at `/deps/`, `/deps/<ecosystem>/`, `/deps/<ecosystem>/<name>/`, built from those routes, and a dependencies section on `/stacks/<id>/` from the stack detail route's added `deps` field.

Out:

- Dependency numbers in the CLI.
- Dependency numbers in `list --json` or `show`.
- Advisories, licenses or any data about a dependency that doesn't come from these reports, apart from 4.5f's reviewed plain-language cards (D40).

## Design

### Where this fits

4.2d stores which allowlisted dependencies each project reported, with a per-project history in `project_deps`. This sub-phase computes from that history only. It adds no table beyond `window_metrics` rows and changes no rule of 4.2a's.

### Definitions

| Term | Meaning |
|---|---|
| Reporting project | A 4.2a project (mature install, not excluded) with at least one `project_deps` row whose `last_seen_day` is in the window |
| Uses X | A reporting project with a row for dependency X seen in the window |
| Major share | Among projects using X, the share on each major, by the row with the latest `last_seen_day` |
| Adoption | A project that reported in an earlier window without X and reports X in this one |
| Drop | A project that reported X in an earlier window, reports in this one, and no longer reports X |
| Major transition | A project whose rows for X show major A, then major B with a later `first_seen_day`, with B seen in this window |

Only 28-day windows over finalized days, as in 4.2a. Adoption, drop and transitions compare with any earlier report of the same project, which `project_deps` keeps past the 90-day raw prune.

### Metrics

| Question | Metric | Shown on |
|---|---|---|
| Who uses it | Reporting projects using X; share of reporting projects per stack using X | Dependency page; stack page section |
| Which version do agents install | Major share for X, overall and per stack | Dependency page; stack page section |
| Is it moving | Adoptions, drops and major transitions (A to B) per window, with the series of 28-day values at 4.2a's 7-day stride, selectable by `interval`, `from` and `to` | Dependency page |
| What goes with it | Co-installed lift `P(Y | X) / P(Y)` over reporting projects, shown when both are used by an effective sample of 5 and lift is above 1, top five | Dependency page |
| Does it work | Green rate of the stack's projects using X against those not using X, per stack, only when both cells pass 4.2a's rate thresholds | Stack page section |
| Ecosystem | Reporting projects per ecosystem; top dependencies by projects; recent major transitions | `/deps/<ecosystem>/` |

Every count and rate uses 4.2a's install cap and effective sample, its suppression rules and its publishing gate; which pages answer is set out under Pages below. Every page says the numbers describe "stacks projects", not the ecosystem.

The stack page section is the reason this exists: it tells a stack author, for example, that most of their stack's projects now land on a new major of the framework the prose describes, and whether those projects go green as often. 2.2's rot checks look at the entry; this looks at what agents actually built from it.

### Pages

- `/deps/`: one link per ecosystem with its project count.
- `/deps/<ecosystem>/`: top 50 dependencies by reporting projects, recent major transitions, links to each dependency page.
- `/deps/<ecosystem>/<name>/`: the metrics above, the stacks whose projects use it most, and the computed and through dates.
- `/stacks/<id>/`: a dependencies section component added to 4.0e's stack page, filled with the stack's top dependencies, their major shares and the with-and-without green rates, from an optional `deps` field on `StatsDetail` (additive).

All are built by the site at build time and rebuilt on 4.2b's schedule, every value escaped by Astro (package names come from the allowlist, but are escaped anyway), with 4.0e's `_headers` page rule and no island. The site builds a page for every allowlisted name in the signed allowlist (4.2d), so which dependency pages exist, decided here:

| Case | Page |
|---|---|
| Name not on the current allowlist | Not built: the static 404 |
| Allowlisted name, publishing gate not met | Built with 4.2b's fixed sentence, "Not enough runs yet to publish numbers for this dependency." |
| Allowlisted name, gate met, every cell suppressed (including a name no project reported) | Built with the same fixed sentence |
| Allowlisted name, gate met, some cell published | Built with the published cells, suppressed ones shown as hidden |

The routes answer the same cases: 404 `NotFound` for a name not on the allowlist, otherwise 200 with every value suppressed or published. The pages are behind the `DEPS_ENABLED` site switch (roadmap, Contracts: Site feature switches), the same way 4.2c's views use `STATS_ENABLED`: when it is off, no `/deps/*` page is built, the paths return the static 404, and the stack page's dependencies section is empty.

## Files and areas touched

| Path | Change |
|---|---|
| `stacks-api/apps/api/src/stats/deps.ts`, `src/stats/rollup.ts` | Dependency dimensions in the daily step |
| `stacks-api/apps/api/src/handlers/deps.ts`, `stacks-api/packages/contract/src/api.ts` | The two dependency stats routes and `deps` on the stack detail route |
| `packages/format/src/stats.ts` | `StatsDeps`, `StatsDep`, optional `StatsDetail.deps` (additive, published before the API uses them) |
| `stacks-api/apps/web/src/pages/deps/`, `src/components/DepsSection.astro` | The pages and the stack page section |
| `stacks-api/apps/web/astro.config.mjs`, `apps/web/src/site-config.ts` | The `DEPS_ENABLED` switch (`astro:env` `envField`, `context: "server"`) |
| `stacks-api/apps/api/tests/deps-stats.test.ts`, `apps/web/tests/deps-pages.test.ts` | New |
| `stacks-api/AGENTS.md`, the directory's about text | Definitions in the words above |

## Acceptance tests

1. Over seeded `project_deps`: projects using a dependency, major shares, adoption, drop and transition counts match hand computations; a project reporting the same major twice counts once.
2. A project whose first report was 120 days ago (raw events pruned) and whose latest shows a new major counts as a transition.
3. One install with 20 projects using X counts 3; a dependency with an effective sample under 5 is suppressed on every page.
4. Lift over a seeded window matches a hand computation; a pair under the sample floor is not shown.
5. The with-and-without green rate appears only when both cells pass the rate thresholds.
6. Before the publishing gate is met, the built `/deps/npm/react/` shows the fixed sentence.
7. An allowlisted dependency no project reported, after the gate is met, shows the fixed sentence; a name not on the allowlist has no page and `GET /v1/deps/npm/<name>/stats` returns 404; with `DEPS_ENABLED` off, no `/deps/` page is built, `/deps/npm/` returns the static 404, and no built page's nav links to Dependencies (4.2c's nav rule), while with it on every page's nav does; a name with `<` in a fixture is escaped; no built dependency page contains a `<script>` other than the theme toggle and the copy script (4.0e).
8. Only the `/v1/deps/.../stats` routes and `StatsDetail.deps` carry dependency numbers; every response decodes with its `packages/format` schema.
9. On the Node server over a temporary SQLite file, one `maintain` run's daily rollup step writes the dependency rows and `GET /v1/deps/npm/stats` returns them with the cache header; the site built against that server renders them on `/deps/npm/`.
10. `GET /v1/deps/npm/react/stats?from=2026-09-01&to=2026-09-30` returns exactly the stored points with end days in September; `interval=28` returns every fourth; a span over 366 days, `from` after `to` or a malformed date is `400 BadInput`, as on 4.2a's routes.
11. Page checks, built through 4.2f's components: a dependency page shows its transitions as a `from → to` table with counts and renders no sankey; every green-rate value has its interval and `n` and every major share figure names its population (4.2f test 3's scan); Axe (through Playwright) reports no violations on `/deps/npm/` and a dependency page, in light and dark.

## Exit criteria

- Acceptance tests pass; `bun run check` green in `stacks-api`, and from this repository's root for the `packages/format` additions.
- The directory's about text (`/stats/about/`, 4.2f) and `stacks-api/AGENTS.md` define every dependency metric.
- A maintainer reviews `/deps/npm/` and a dependency page in both themes and on a phone width, as 4.2f's exit criteria do for the stack page.

## What this plan may get wrong

- With few stacks and a 7-day report spacing, dependency cells will be small for a long time. The gate and suppression handle that; the pages may stay at "Not enough runs yet" well after stack stats are public.
- Adoption and drop depend on projects that keep reporting. A project that stops verifying looks like neither, which undercounts drops; the definitions say so on the page.
- 2026-10-27: the plan had no dependency route, because the Worker rendered the pages from `window_metrics` directly. Under D35 the pages are built by the site, which needs the numbers over HTTP, so two read routes and `StatsDetail.deps` exist with the site build as their reader.
- 2026-10-27: the routes were `GET /v1/stats/deps/:ecosystem` and `/v1/stats/deps/:ecosystem/:name`, which end in a path param against the API's routing rule. They are now `GET /v1/deps/:ecosystem/stats` and `GET /v1/deps/:ecosystem/:name/stats`, under the resource and ending in a literal, as 4.2a's detail routes are.
- The with-and-without green rate invites a causal reading it doesn't support. The page states it is a comparison of projects, not an effect of the dependency.
- 2026-10-28 (execution): D25 is decided. On the Node host (amended D16) the dimensions are steps of 4.2a's daily rollup inside 4.1c's `maintain`, over SQLite, and acceptance test 9 (numbered with the rest on this date) reads that way. Under D38 every list in `StatsDeps`, `StatsDep` and `StatsDetail.deps` (dependencies, major shares, transitions, co-installed lift, per-stack cells, series) is columnar, through the format package's `Columnar` schema, and those schemas ship in `@steamfield/stacks-format` 0.3.0 with the stats changes. The site already has the dependency pages, `DEPS_ENABLED` and a provisional local copy of these schemas (`apps/web/src/data/deps-schema.ts`, the frontend work on fixtures); the format schemas start from that shape, and this sub-phase replaces the copy and points the pages at the real routes rather than building them again. The rollup reads only `project_deps`, so it is built and tested on seeded rows before 4.2d's ingest lands.
- 2026-10-28 (execution): a suppressed dependency stays in the ecosystem and stack lists with its cells suppressed, as the stats summary keeps a suppressed entry's row, so a list's membership doesn't move with the threshold; its allowlisted detail route returns 200 with suppressed cells.
- 2026-10-28 (landed, stacks-api): the rollup dimensions (dep, dep_major, ecosystem, adoption, drop, transitions, co-installed lift, dep_stack with and without rates) and both routes are on `main`. The routes are in the Stats contract group, return format 0.3.0's columnar `StatsDeps` and `StatsDep`, and add `deps` to a published stack detail. A malformed query returns `BadInput` with the same details as the stats detail route. The routes read the allowlist through `IndexAssets.allowlist`: an off-allowlist name is a 404, and a missing or invalid allowlist is a 503. Remaining: the site reads the allowlist from the index directory instead of a nonexistent `/v1/allowlist` route (A8), and the seed sends v2 events so a seeded store publishes these cells (A9).
- 2026-10-28 (landed, stacks-api): both remaining items are on `main`. The `/deps` pages read the signed allowlist from the index output (`v1/allowlist.json`) and the numbers from the two routes, and the seed sends v2 events, so a seeded store publishes every dependency cell. Left for the maintainers: reviewing the allowlist names (`packages/cli/registry/allowlist.json`).
- 2026-10-29 (D40, 4.5f): dependency pages also show the signed plain-language card from `v1/deps.json`, which exists before any telemetry publishes. `DEPS_ENABLED` gating the whole `/deps/*` tree no longer fits: the stacks-api follow-up builds the pages from the cards with the switch off, hides only their stats sections, and changes acceptance test 7 to match.
