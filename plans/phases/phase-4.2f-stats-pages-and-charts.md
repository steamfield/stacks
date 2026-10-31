# Phase 4.2f: Stats pages and charts

Status: IN PROGRESS 2026-10-27, fixture-first ahead of D17 (see the 2026-10-27 execution line in "What this plan may get wrong"): the stats schemas first, then the site

| Field | Value |
|---|---|
| Goal | The directory's stats read as one designed product: every stats number answers a named question for a named reader, through the chart that answers it best, with its population, window and sample size beside it, an honest state when it is suppressed, unpublished or stale, a text and table equivalent for every chart, and no client JavaScript except where interaction earns it. This sub-phase builds the shared stats components and the stack page's stats; 4.2c and 4.2e build their pages from those components |
| Traces to | The developer who starts projects often: "a stack that matches how they'd build it". The coding agent "runs `list --json`, picks a stack" (the page is where its human checks that pick). The stack author: "a way to know a stack still produces a working project without running it by hand". Success rows 1, 2 and 4 made visible. Not the demo: telemetry comes after 4.0f, after the demo (D16), and the demo's evidence minute uses ledger runs on 4.0e's pages ([DEMO_OUTLINE](../../product/DEMO_OUTLINE.md)) |
| Depends on | 4.2b (the build-time stats fetch, `STATS_ENABLED`, the stats section it fills and the freshness island), 4.2a (`StatsSummary`, `StatsDetail` and the `window`, `interval`, `from`, `to` parameters), 4.2g (seeded local data the pages are built and reviewed against), 4.0e (the directory pages, site layout and the site's design tokens in `styles/global.css`) |
| Blocks | 4.2c's telemetry views and 4.2e, which render through this sub-phase's components and own their own page tests |
| Decisions needed | D17, through 4.2a. [Open question 34](../risks-and-open-questions.md#open-questions-for-the-maintainers) (the per-agent dot plot shows agents side by side on one stack; it follows open question 31's answer) |
| Settles | The question each stats page answers and for whom, the chart for each question (the table below, which 4.2c and 4.2e follow), the stack page's stats layout, the suppressed, unpublished, stale and seeded states, the chart palette, how OpenChart is used (static SVG at build time, one island), accessibility and performance budgets. The site's design tokens are 4.0e's, so the telemetry-free pages have them without D17 |

## Scope

In:

- The visual system for stats in `stacks-api/apps/web`, over 4.0e's design tokens: the chart palette, number formatting, and the components every stats page uses (`StatLine`, `Figure`, `RateMark`, `CountBar`, `Spark`, `SuppressedNote`, `StatsState`), each tested on a fixture page.
- The layout and charts of the stats section on `/stacks/<id>/` (4.2b's section).
- The question-to-chart table below for every stats page. 4.2c (`/` ordering, `/browse/*`, `/fragments/<id>/` stats, `/agents/<agent>/`) and 4.2e (`/deps/*`, the stack page's dependencies section) build their pages from these components and own those pages' tests.
- A method page, `/stats/about/`, holding every definition in 4.2a's and 4.2b's words (4.2b and 4.2e's exit criteria ask for "the directory's about text"; this is where it lives). 4.2c and 4.2e add their own sections to it.
- Static SVG charts rendered at build time with OpenChart, and one island: the stack page's history chart.

Out:

- New metrics, windows or routes. Every number comes from 4.2a, 4.2c or 4.2e as published, already capped, suppressed and rounded.
- Comparing agents across stacks on any page (open question 31).
- Site search, client-side filters and user-chosen date ranges beyond the history chart's three presets. Search is 4.5c's, in the CLI.
- Visit analytics (roadmap, Won't have).
- A sankey for dependency major transitions. A table answers the question (below); a sankey needs client JavaScript and its static renderer doesn't cover it.

## Design

### Who reads which page

| Reader | Arrives from | Job on the page |
|---|---|---|
| Engineer choosing what to try | A search result, a link in their agent's explanation, the directory home | "Does this fit what I'm building, and does it actually work?" Decide in under a minute whether to try it |
| The agent's human | The agent's recommendation ("91% green, n=180") | "Is what my agent told me true, and is there a catch?" The page shows the same numbers `list --json` and `show --json` carry, labelled the same way |
| Stack author | Their own stack's page, after a content change | "Where does my stack break, and did my change break it?" |

The page order follows that ranking: fit and outcome first, diagnosis below. Agents read the JSON routes, not these pages.

### Question, chart, page

| Question | Reader | Chart | Page |
|---|---|---|---|
| Which stacks work, and how sure is that? | Engineer | Table, one row per stack: green rate as a dot with its Wilson interval as a whisker on one shared 0-100% axis (`RateMark`), `n=` beside it | `/`, `/browse/highest-success/`, tag pages |
| Which are used? Is it alive? | Engineer | Same table: projects in the window as a bar on one shared scale (`CountBar`), and a 26-week sparkline of the 28-day projects (`Spark`) | `/`, `/browse/most-used/` |
| What is rising? | Engineer | Table ordered by trending score: this week's projects against the average week of the prior 28 days as two short bars, the score as text | `/browse/trending/` |
| Will it work for me? | Engineer, agent's human | One sentence with the window's numbers (`StatLine`), then green rate per preset as a dot plot with intervals | Stack page, top |
| Will it work with my agent? | Engineer, agent's human | Dot plot with intervals, one row per agent, alphabetical, never sorted by rate. Rows are only the `DetectedAgent` ids the CLI records (`claude`, `codex`, `opencode`, `cursor`, `other`); an agent it doesn't detect is counted under `other`, never shown by its own name | Stack page |
| How long does it take? | Engineer | Median and p75 time to green as a range bar on a minutes axis, median time to first passing test as a tick on the same axis, median verify runs before green as text | Stack page |
| Is it getting better or worse? Did a change break it? | Stack author, engineer | Line of the 28-day green rate at each weekly series point (4.2a's 7-day stride) with the Wilson interval as a band, content-change markers as dashed vertical rules labelled with their date; below it, sharing the x axis, the weekly 7-day projects as bars stacked by preset (4.2a's per-preset series), with the same markers. Two charts, never a dual axis | Stack page, the one island |
| Where does it break? | Stack author | Horizontal bar list of each step's failure share before first green, sorted by share; the env-blocked share as its own labelled bar under a rule, so the machine and the stack aren't summed | Stack page |
| Which composition broke? | Stack author | Table per composition fingerprint (4.2a's `byComposition` cells): the fragments it adds to and drops from the defaults ("defaults + goreleaser"), green rate mark, `n`, first and last day seen, and whether a change marker falls in its life | Stack page, collapsed `<details>` |
| What do people change? | Engineer, stack author | Bar list: kept rate for each default fragment (1 minus its `--without` rate), attach rate for each optional one, two groups under one axis | Stack page |
| Which dependencies, which majors? | Stack author | 100% stacked bar per dependency for major shares; with-and-without green rates as paired rate marks only where both cells publish (4.2e) | Stack page dependencies section, `/deps/<ecosystem>/<name>/` |
| How is a dependency moving? | Stack author | Line of the major shares over time (stacked area, 100%), and a table of transitions `from → to` with project counts | `/deps/<ecosystem>/<name>/` |
| What goes with this fragment or dependency? | Engineer | Bar list of lift, labelled as "2.1× as likely", at most three for fragments and five for dependencies | `/fragments/<id>/`, `/deps/<ecosystem>/<name>/` |
| Who uses this fragment, and with which stack? | Engineer, fragment author | Weekly 7-day projects including the fragment as bars stacked by stack (the fragment detail's per-stack series), then a table per stack (4.2a's `byStack`): 28-day projects, kept rate where it is a default or attach rate where it is optional | `/fragments/<id>/` |
| Do projects with this fragment go green as often? | Engineer, fragment author | Paired rate marks per stack, with and without the fragment, only where both cells publish (`byStack[].withWithout`), under the fixed caption "This compares projects; it isn't an effect of the fragment." | `/fragments/<id>/` |
| What else does this job? | Engineer | Table of the other fragments in the same `category` that apply to the same stacks, each with its attach rate mark when published (4.2c) | `/fragments/<id>/` |
| Which stacks work with my agent? | Engineer | Table of stacks by that agent's green-rate lower bound, rate mark and `n`, with that agent's median time to green and projects on each stack (4.2a's `byAgent` cells); any share of the agent's projects is over published cells only, captioned "of stacks with published counts" (4.2a) | `/agents/<agent>/` |

Three rules hold on every chart:

- Green rates always carry their Wilson interval (4.2a's `lower` and `upper`) and `n` (the effective attempted sample 4.2a publishes as `sample`). A bare green-rate percentage never appears. Shares that 4.2a publishes without an interval (no-verify share, step failure shares, entry-point shares, kept and attach rates, major shares) are labelled as shares of a named population, and the figure's caption gives that population's count where 4.2a publishes one: the window's `projects` for the no-verify share and the kept and attach rates, the projects using the dependency (4.2e) for major shares. Step failure and entry-point shares have no published denominator, so their caption names what they are a share of ("of failed runs before first green", "of `new` runs") without a count.
- Popularity and success are separate marks in separate columns. No page combines them into one score.
- No chart uses green and red to judge a stack. Status colors appear only for a real status: a ledger run's `pass` or `fail`.
- A total, share, rank or "others" bucket follows 4.2a's rule for totals and shares: over published cells only, captioned "of stacks with published counts", unless 4.2a publishes the true total.

### Stack page layout

Top to bottom, inside 4.0e's page (name, description, copy command, verify steps, last ledger run, which stay first):

1. `StatLine`: "Among stacks projects in the 28 days through 25 Oct 2026: 215 projects; 91% reached a green verify (86-95%, n=180); median 14 minutes to green; 12% never ran verify." Values that are suppressed drop out of the sentence and the sentence says which ("Time to green: not enough runs yet").
2. History (island): the 28-day green rate with its band and markers, and beneath it the weekly projects by preset.
3. By preset, by agent.
4. Time to green.
5. Where it breaks.
6. What people change.
7. Dependencies (4.2e).
8. By composition (collapsed).
9. Provenance footer: "Computed <generatedAt>, through <through>. Numbers describe stacks projects, not the ecosystem. How these are computed" (link to `/stats/about/`).

On a phone width each chart takes the full width and the dot plots keep one row per category; nothing scrolls sideways. Tables collapse to two columns (name, rate mark) with the rest in a row's `<details>`.

### States

Every number can be `suppressed`, and a page can be built before any number exists. Each state has one rendering, owned by `StatsState`:

| State | Rendering |
|---|---|
| `STATS_ENABLED` off | No stats section, no stats-ordered pages (4.2b, 4.2c). Nothing says stats are missing |
| Gate unmet (`published: false`) | 4.2b's fixed sentence, then the ledger line. No chart frame, no placeholder line, no zero |
| Published, every value in one chart suppressed | The chart is replaced by one line: "Not enough runs in this breakdown yet." The method page says what "enough" means |
| Published, some values suppressed | A suppressed bar or dot becomes a labelled empty row, "hidden: too few projects", in the same position; a suppressed series point is a gap in the line, never interpolated; a suppressed table cell shows "–" with a footnote |
| Stale: `through` more than 3 days before today | A notice above the section: "These numbers run through <date>; the daily update is late." The built page applies the rule against the build date, so on a page without an island the notice is build-relative and the method page says so. The stack page's island applies the same rule again at view time against the viewer's clock (UTC), so a stack page nobody rebuilt still shows the notice once its script runs |
| Seeded data (`population` is `"seeded development data"`, 4.2a, 4.2g) | A banner on every page: "Development data. These numbers are generated, not real usage." The production build fails instead (4.2g) |
| Removed stack | The last published window with its `through` date (4.2c) |

The fixed sentences are constants in one module, so the tests compare them exactly.

### Labels and numbers

- Population and window on every figure: the caption names "stacks projects" and "28 days through <date>". A figure taken out of context by a screenshot still says what it counts.
- Counts are shown as published, already rounded to 5 by 4.2a; the method page says so. Rates are whole percents; intervals are written `86-95%`.
- Minutes under 120 are minutes, longer is hours with one decimal.
- Dates are written `25 Oct 2026` in text and `Oct 25` on axes, in UTC, and the method page says the day is UTC.
- Chart titles label the data ("Green rate, 28-day window"), at most 60 characters. The `StatLine` and each figure's summary sentence say the finding; titles don't.
- Numbers use the monospace face with tabular figures, so columns align.

### Design tokens and the chart palette

The site's design tokens (colors, type, spacing, layout widths, the theme toggle) are owned by [4.0e](../archive/phases/phase-4.0e-official-names-and-directory-2026-10-30.md), in `apps/web/src/styles/global.css`, where `stacks-api/.claude/rules/web/astro.md` puts shared tokens. 4.0e owns them because its directory pages ship without D17 and before any stats exist; a token set owned here would leave 4.0e's and 4.2c's telemetry-free pages waiting on the D17 chain or restyled later. This sub-phase uses those tokens and adds only the chart palette below, as variables in the same file plus the hex values in `src/lib/charts/palette.ts`. Two stats-only rules: chart annotations are no smaller than 12px, and the dot plots take two columns on wide screens.

Chart palette: one accent hue carries every single-series chart (light `#0891b2`, dark `#22d3ee`), its interval band at 20% opacity, other context in `muted-foreground`. Categorical series (major shares, the composition table's marks) use, in order, light `#06b6d4 #e29e47 #4170cb #b2417f #3ca368 #a584dc` and dark `#22d3ee #f9be78 #6591e1 #d771a4 #6ebf8c #bca1ed`, and label each series directly at its end rather than through a legend. Gridlines on the value axis only (`rgba(0,0,0,0.05)` light, `rgba(255,255,255,0.10)` dark). A test checks each chart color against 4.0e's `background` and `card` tokens for WCAG AA (3:1 for marks, 4.5:1 for chart text); 4.0e's own test covers the text tokens.

### OpenChart, and what it doesn't cover

OpenChart fits the full charts: its line and area marks with `y`/`y2` draw the interval band, `rule` annotations draw the change markers, its range mark draws the time-to-green bar, and its bar list draws the ranked bars. It renders SVG, generates alt text and a screen-reader data table, and takes a theme object of hex values.

How it is used here, decided:

- Packages: `@opendata-ai/openchart-vanilla` (the static renderer) and `@opendata-ai/openchart-react` (the island), on the stable 8.x line (8.9.1 when this was written).
- Build time, static SVG. Each full chart is rendered once per theme during `astro build` with the vanilla package's static renderer (`renderStaticSVG(spec, { width, height, theme, darkMode: "force" or "off", watermark: false })`), and the two SVGs are inlined, one hidden by CSS according to the theme. The static renderer needs its `happy-dom` peer dependency (already a dev dependency of `apps/web` for its tests) and swaps a global `document`, so `src/lib/charts/render.ts` renders charts one at a time behind one queue; never in parallel.
- Ids. 8.x's `StaticRenderOptions` has no `idPrefix`, and element ids come from a module-global counter, so they depend on render order and collide when two figures share a page. `render.ts` therefore resets that counter before each figure where the package lets it, and always post-processes the SVG: every `id` is renamed to `<figure prefix>-<n>` in order of first appearance, and every reference to it (`url(#…)`, `href="#…"`, `xlink:href`, `aria-labelledby`, `aria-describedby`) is rewritten to match. The prefix comes from the page and chart name. The renaming alone makes ids independent of render order; tests 12 and 13 check both properties. When 9.x, which adds `idPrefix` (9.0.0-rc.2 has it), is stable, the post-processing is replaced by the option.
- Specs are built by pure functions in `src/lib/charts/specs.ts` from decoded `StatsDetail` values, so a test can assert a spec without rendering it. Colors come from the token values above as hex, because a spec can't read CSS variables.
- In-table marks (`RateMark`, `CountBar`, `Spark`) are not OpenChart. They are a few lines of Astro emitting SVG from one shared scale per table, because every row must share an axis exactly and a page of dozens of rows would mean dozens of renders. They use the same tokens.
- The one island is the stack page's history chart: `client:visible`, importing the React package lazily through one module so no other island pulls OpenChart onto the eager path. It adds hover values and three range presets (90 days, 180 days, one year), fetching `GET /v1/stacks/:id/stats?from=&to=` (4.2a). Before it loads, with JavaScript off, or when the fetch fails, the static 180-day SVG and its table stay. It merges with 4.2b's freshness island: one island per stack page, not two.

What doesn't fit, and what is used instead: OpenChart's table, sankey and graph specs render only in the browser, so tables are plain Astro tables and transitions are a table. When this was written the newest stable release was 8.9.1, which already has `renderStaticSVG` and the `happy-dom` peer; only `idPrefix` is new in 9.0, which was at release candidate 2.

### Accessibility

- Every chart is a `<figure>` with its title, a one-sentence summary generated from the same values (the finding in words), and a `<details>` holding the data as a table with the same rounding. The static SVG carries `role="img"` and an `aria-label` from that summary; OpenChart's own hidden table is turned off in static output so a screen reader doesn't read the data twice.
- Static charts have no hover script. What a tooltip would show is in the figure's `<details>` table, and each mark (bar, dot, point) carries an SVG `<title>` with its label and value as rounded for the page, so a pointer hover still shows it with JavaScript off. Only the history island has interactive hover.
- A figure offering two spans (12 weeks and since launch, say) is a CSS-only radio pair over two static SVGs, each with its own `<details>` table: the inputs are real radio buttons with labels, the unchecked span is hidden by a `:checked` sibling rule, and no script is involved.
- Color is never the only channel: series are labelled directly, change markers carry a text label, suppressed rows say "hidden".
- The island is keyboard operable (range presets are buttons; the hover value is also reachable by arrow keys through OpenChart's keyboard navigation) and announces the selected range.
- No motion: static SVG has none, and the island disables animation under `prefers-reduced-motion`.
- Contrast is checked by the palette test; focus rings use `primary`.

### Performance

- Pages are static HTML. No component here emits a script; the browse pages and tag, fragment, agent and dependency pages that 4.2c and 4.2e build from them ship no JavaScript beyond 4.0e's theme toggle and copy script, which those sub-phases test on their pages. The stack page adds only its one island.
- Budget: a stack page's HTML and CSS at most 120 KB compressed with its inline SVGs; the island's chunk loads only when the history chart scrolls into view.
- Build: the site build fetches each stats route once per stack (4.2b already does) and renders charts sequentially; budget 3 minutes for 100 entries on a laptop, measured by the build and printed.

### Before any data exists

Three moments, in order:

1. No telemetry decision or `STATS_ENABLED` off: the directory is 4.0e's and 4.2c's telemetry-free pages, styled by 4.0e's tokens; this sub-phase changes nothing on them.
2. Collection on, gate unmet: every stack page shows the fixed sentence and its ledger line; the browse pages that need stats aren't built.
3. Gate met for some stacks: only cells that publish are drawn; a stack below the thresholds keeps the fixed sentence while its neighbours have charts.

Development and review happen against 4.2g's seeded local API (`bun run dev:stats`), so every chart and every suppressed state can be seen before real data exists. The seed is built to produce each state (a stack under the gate, a stack with one suppressed agent, a content change) on purpose.

## Files and areas touched

| Path | Change |
|---|---|
| `stacks-api/apps/web/src/styles/global.css` | The chart palette variables beside 4.0e's tokens |
| `stacks-api/apps/web/src/components/stats/` | `StatLine`, `Figure`, `RateMark`, `CountBar`, `Spark`, `SuppressedNote`, `StatsState`, `HistoryChart.tsx` (the island) |
| `stacks-api/apps/web/src/pages/dev/stats-components.astro` | A fixture page rendering every component in every state, built only outside the production build, for the component tests and review |
| `stacks-api/apps/web/src/components/StatsSection.astro` | 4.2b's section, rebuilt from the components above |
| `stacks-api/apps/web/src/lib/charts/` | `specs.ts` (pure spec builders), `render.ts` (the sequential static renderer), `palette.ts`, `format.ts` (numbers, dates, minutes) |
| `stacks-api/apps/web/src/lib/stats-text.ts` | The fixed sentences and summary-sentence builders |
| `stacks-api/apps/web/src/pages/stats/about.astro` | The method page |
| `stacks-api/apps/web/package.json` | `@opendata-ai/openchart-vanilla` and `@opendata-ai/openchart-react`, stable 8.x |
| `stacks-api/apps/web/tests/` | Spec, state, palette, accessibility and page tests |
| `stacks-api/AGENTS.md` | "Stats pages" section: the chart table above, the state table, the island rule |

## Acceptance tests

Site tests build `apps/web` against a local API filled in process by 4.2g's `simulate.ts` with a fixed seed value (never the `bun run seed` entry, which refuses under `CI`), or against fixture routes where a state needs exact values. They cover the stack page and the components' fixture page; 4.2c and 4.2e test the pages they build from these components.

1. The stack page for a seeded published stack contains, in order, the `StatLine`, the history figure, by preset, by agent, time to green, where it breaks, what people change and the provenance footer; each figure has a title, a summary sentence and a `<details>` table whose values equal the route's.
2. `StatLine` for fixture values reads exactly "Among stacks projects in the 28 days through 25 Oct 2026: 215 projects; 91% reached a green verify (86-95%, n=180); median 14 minutes to green; 12% never ran verify."
3. Every green-rate value on the built stack page and the components' fixture page (the values `RateMark` and `StatLine` render, marked `data-stat="green-rate"`) has a Wilson interval and an `n` within the same figure or row; a scan of the built HTML for a marked value without either fails. Every share figure's caption names its population. 4.2c and 4.2e run the same scan over their pages.
4. The by-agent dot plot lists agents alphabetically whatever their rates; the stack page never lists agents in rate order.
5. A fixture with every by-agent value suppressed renders "Not enough runs in this breakdown yet." and no SVG for that figure.
6. A fixture with one suppressed agent renders its row as "hidden: too few projects" in alphabetical position, and no zero-length bar.
7. A fixture series with suppressed points renders a line with gaps at those points (the spec's data has nulls there, and no point is interpolated).
8. A change marker in the fixture series appears as a labelled rule on the history chart and as a row in the composition table's "change in life" column.
9. With `published: false`, the stack page shows 4.2b's fixed sentence and the ledger line, and no `<figure>` in the stats section.
10. With `through` four days before the build date, the stale notice appears; with one day, it doesn't.
10a. A stack page built with `through` one day before the build date, opened (Playwright) with the browser clock five days after the build, shows the stale notice once the island runs; with JavaScript off it doesn't.
11. With `population: "seeded development data"`, the stack page and the fixture page carry the banner; a production build (4.2g's production flag) fails.
12. The static SVG for a chart is identical across two builds with the same data, and identical when the figures on a page are rendered in a different order (the id post-processing removes the global counter's effect).
13. No two figures on one page share an SVG id, and every `url(#…)` and `href="#…"` in a figure resolves to an id inside the same figure.
14. The stack page contains exactly one island and no `<script>` other than the island's, the theme toggle and the copy script (4.0e), and no component on the fixture page emits a `<script>`.
15. With JavaScript disabled (Playwright), the stack page shows the static history chart and its table; with it enabled and the range set to one year, the island requests `from` one year before `through` and redraws.
16. Every chart color passes the contrast test at AA against 4.0e's background tokens.
17. Axe (through Playwright) reports no violations on the stack page and the components' fixture page, in light and dark.
18. A stack page built from seeded data is under the 120 KB compressed budget; the build prints its chart render time and stays within budget for the seeded registry.
19. The transitions component renders a table of `from → to` with counts and no sankey (on the fixture page; 4.2e tests it on its dependency pages).
19a. Every mark in every static SVG on the stack page and the fixture page has an SVG `<title>` whose value equals the matching cell of its figure's `<details>` table.
19b. A two-span figure on the fixture page, with JavaScript disabled (Playwright), shows the first span, shows the second after its radio label is clicked, and is operable by keyboard.
19c. The history figure's lower chart is the weekly projects stacked by preset, its points equal the per-preset series in the route's response, and it shares the green-rate chart's markers.
19d. The fragment with-and-without figure on the fixture page renders paired rate marks only for stacks where both cells publish, with the caption "This compares projects; it isn't an effect of the fragment." from the fixed-sentence module.

### Realistic edge cases

20. A stack name or step name containing `<` or `&` is escaped in the HTML, in the SVG text and in the `aria-label`.
21. A step name 80 characters long is truncated with an ellipsis in the bar list and shown whole in the table.
22. A stack with one agent and one preset still renders both dot plots without a broken axis (a single row with its interval).
23. A green rate of 100% with an interval of 97-100% draws the whisker inside the axis; a rate of 0% likewise.
24. A series whose whole range is suppressed except one point draws that point as a dot, not a line.
25. A theme toggle before the island loads leaves the static SVG and the island in the same theme.
26. The history island receiving an older `through` than the static chart's keeps the static chart (4.2b's freshness rule).

## Exit criteria

- Acceptance tests pass; `bun run check` green in `stacks-api`.
- A maintainer reviews the stack page and the components' fixture page built from seeded data in both themes and on a phone width, and records the review in this file. 4.2c and 4.2e review their own pages the same way.
- `/stats/about/` defines every metric in 4.2a's and 4.2b's words; 4.2c and 4.2e add theirs.

## What this plan may get wrong

- The static renderer swapping a global `document` may break under Astro's build concurrency. The queue serializes calls inside one build worker; if Astro renders pages in several workers, render charts in a pre-build step into files the pages import, and record it here.
- Rendering every chart in two themes doubles inline SVG. If pages exceed the budget, render light only and invert through CSS filters for dark, or move more charts behind the island.
- The interval band and change markers may crowd a 28-day series with frequent content changes. If more than five markers fall in the visible range, they collapse into a tick strip under the axis with the dates in the table.
- Readers may still read the by-agent plot as agents compared (open question 34). If the maintainers say so, it goes, and the per-agent numbers stay only in `show --json`.
- One island may not be enough: a stack author may want to compare two windows. Nothing reads that yet; add it when someone asks.
- 2026-10-27: the plan named a `renderStaticSVG` `idPrefix` option and called the packages a release candidate. `idPrefix` exists only in 9.0.0-rc.2; stable 8.9.1 has the static renderer but numbers ids from a global counter. The plan now uses 8.x with id post-processing; move to `idPrefix` once 9.x is stable, and if 8.x gives no way to reset the counter, rely on the renaming alone (test 12 still holds).
- 2026-10-27: a review of the site's design mocks against this plan. The mocks' stack page has no history chart: its render code still computes the green-rate line, band and markers, but the exported template never draws them, which reads as an export loss rather than a design choice. The green-rate history stays the stack page's one island, and the mocks' weekly projects by preset replace the 28-day projects line beneath it. The mocks also use hover tooltips and a 12-week / since-launch toggle; hover is replaced by each figure's `<details>` table and an SVG `<title>` per mark, and the toggle by a CSS-only radio pair, so the only page scripts stay the theme toggle and the copy script (4.0e) plus the island. The mocks' agent breakdown lists `gemini`, which the CLI can't record; rows are `DetectedAgent` values only.
- 2026-10-27: executed fixture-first, ahead of D17, at the maintainers' request, so the stats UI exists before real data. `StatsSummary` and `StatsDetail` land first in `packages/format/src/stats.ts`, written from 4.2a's Routes, Time filtering and Metrics sections plus 4.2c's `trending` and `oftenUsedWith`, and marked provisional until 4.2a executes (4.2a may revise them; the site's tests then follow). The site copies them into its build-time decoder, as it does the index schemas, until `@steamfield/stacks-format` is published. The site build fetches the stats routes from `STATS_API_URL` (4.2b's build-time fetch) only when `STATS_ENABLED` is `true`; tests serve fixture JSON from an in-process local HTTP server instead of 4.2g's seeded API, so tests 1, 11 and 18 run on fixture data and the seeded banner follows `population` alone. In scope: this plan's components, fixture page, the stack page's stats section (4.2b's section, filled by these components), the freshness island, `/stats/about/`, and 4.2c's stats views (`/` ordered by default sort, `/browse/most-used/`, `/browse/highest-success/`, `/browse/trending/`, fragment stats). Out: 4.2b's CLI side, 4.2a's API and rollup, 4.2g, agent pages (dropped). With `STATS_ENABLED` off, production builds are unchanged.
- 2026-10-27: the mocks show stars on the stack and fragment pages. The site leaves them out, per roadmap "Won't have" ("Ratings, reviews, accounts").
- 2026-10-27: the first draft owned the site's design tokens and tested the browse, tag, fragment, agent and dependency pages, which 4.2c and 4.2e create after this sub-phase. Tokens moved to 4.0e, and page tests moved to the sub-phases that build the pages.
- 2026-10-27: settled from the site test author's questions (the fixture README in `stacks-api/apps/web/tests/fixtures/stats/` carries the full interface). The build's production flag is `STACKS_PRODUCTION=true`, set by the deploy build: with it, a seeded population fails the build and `/dev/stats-components/` isn't built; every other build, optimized or not, builds the fixture page. The build-time stats fetch is the one allowed build-time API call, only with `STATS_ENABLED=true`, from `STATS_API_URL`. Each view requests its own summary `sort` and the site never re-sorts, except `/`'s rule that suppressed stacks follow by name; an unpublished summary means no stats views and the three-link nav. Removed stacks get one detail fetch each, and a 404 there means no stats section. Ranges run `from = through - N days`, so the inclusive API range spans N+1 days; series are weekly, so the extra day changes nothing. Test 18's budget is 120,000 bytes, gzip of the HTML plus each distinct linked stylesheet, fonts and scripts excluded; the 100-entry benchmark waits on 4.2g's seeded registry. The chart palette is adjusted until marks reach 3:1 and chart text 4.5:1 on both theme surfaces (the plan's first colors failed). Stats components are TSX under `components/stats/`, with `HistoryChart.tsx` the one `client:visible` island; `StatsSection` stays Astro as the files table names it. The tests' accessible names, table layouts, `data-*` mark attributes, method headings, fixture-page transitions and pure-function signatures are accepted as written; the spec builders may follow OpenChart's real interface where the tests' observable fields still hold.
- 2026-10-27: the maintainers reversed "What doesn't fit" above. Every data mark on the site, in-table marks included, is OpenChart, and each gap between the design mocks and OpenChart (features, marks, chart types, static rendering of browser-only types, a static renderer that doesn't swap `globalThis.document`) is built in OpenChart itself, not worked around in the site; OpenChart's v9 is cut once those gaps close. Until then `apps/web` depends on OpenChart's npm `next` prerelease (the v9 release candidates, which the maintainers call stable), the one prerelease the site allows, and moves to stable 9.x when it ships. So `render.ts` uses `idPrefix` instead of renaming ids, and `RateMark`, `CountBar` and `Spark` render through OpenChart rather than hand-written SVG. The chart unit waits on an inventory of those gaps and the OpenChart work it produces; the data layer and the stats fetch don't depend on it.
