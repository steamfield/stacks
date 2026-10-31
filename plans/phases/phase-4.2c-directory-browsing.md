# Phase 4.2c: Directory browsing

Status: IN PROGRESS 2026-10-28: the telemetry-free parts are executed (`v1/directory.json`, newest, tags, fragments, removed pages, nav), and the trending dimension is served with the summary's sort options; the telemetry views are being built on fixtures with 4.2f
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | The directory can be browsed, not only looked up: sorted list views (default, most used, highest success, trending, newest), a page per tag, a page per fragment with the fragments it is most often used with, a page per agent listing the stacks that work with it, and a page kept for every stack that left the registry, with a notice and a pointer to its replacement. Every page is a static Astro page in `stacks-api/apps/web`, built from this repository's signed index output and the stats routes; numbers come only from 4.2a's capped, suppressed `window_metrics` |
| Traces to | The developer who starts projects often: "a stack that matches how they'd build it". The coding agent "runs `list --json`, picks a stack" (the directory is where a person checks that pick). Success row 5, "Stacks and fragments in `~/.stacks` and third-party sources" made visible. "Stacks don't rot" (a removed stack's page says so rather than vanishing) |
| Depends on | Every part: 4.0c (the index build), 4.0e (the directory pages in `apps/web`, the stack pages, `OfficialNames`, the site's design tokens). The telemetry views only (the stats-ordered pages, stats cells, "often used with", trending): D17, 4.2b (the build-time stats fetch, the stats section and the `STATS_ENABLED` switch), 4.2f (the stats components, states and charts they render through), 4.1d (`installs`, for install maturity in trending). The telemetry-free parts (the newest view, tag pages, fragment pages without stats, category alternatives, removed-stack pages, `v1/directory.json`) can execute as soon as 4.0e has landed |
| Blocks | Nothing. 4.2e adds dependency pages beside these |
| Decisions needed | D17. If declined, only the telemetry-free parts ship: the newest view, tag pages, fragment pages without stats, and removed-stack pages |
| Settles | The directory's views and their orderings; the fragment index; the nav's rule for unbuilt views; the trending score; `trending` in `StatsSummary`; co-installed fragment lift; category alternatives on fragment pages; how removed stacks are recorded and shown |

## Scope

In:

- A signed `v1/directory.json` written by `build:index` in this repository: each entry's added date, and each removed entry's record and last static content. The site can't read this repository's git history or `removed.json`, so the build hands it the facts.
- `packages/cli/registry/removed.json`, the maintainers' record of removed entries, checked by the build.
- New Astro pages in `stacks-api/apps/web`, built from the index output and `v1/directory.json`: `/browse/newest/`, `/tags/<tag>/`, `/fragments/` (the fragment index), `/fragments/<id>/`, removed-stack pages at `/stacks/<id>/`.
- The site nav, listing only the views that were built.
- Stats-ordered pages built from the stats routes behind `STATS_ENABLED`: `/` reordered by default sort, `/browse/most-used/`, `/browse/highest-success/`, `/browse/trending/`.
- A trending score and an additive `trending` field in `StatsSummary`.
- A co-installed fragment dimension in 4.2a's daily rollup step, shown on fragment pages as "often used with".

Out:

- Search, client-side filters, pagination beyond one page per view (the catalog is small; revisit past 200 entries). Astro islands make these cheap later; nothing reads them yet. Natural-language search is the CLI's `stacks search` (4.5c), for agents.
- Directory visit analytics of any kind (roadmap, Won't have).
- Dependency pages (4.2e).
- Agent pages, and any ordering of agents against each other (dropped 2026-10-27).

## Design

### Where this fits

4.0e builds a static page per stack and an index page in `apps/web`, and 4.2b fills a stats section in them at site build time. This sub-phase adds more pages of the same two kinds: pages built from the index output and `v1/directory.json` alone, and pages whose order depends on stats, built from the stats routes and rebuilt after each daily rollup (4.2b). Nothing new reads raw events; every number is a 4.2a cell, already capped and suppressed.

### Views

| Path | Built by | Order | Without telemetry |
|---|---|---|---|
| `/` | Index output; ordered from `/v1/stats/summary` | Stacks whose green rate is unsuppressed, by Wilson lower bound, highest first; then the rest by name | By name, as 4.0e builds it |
| `/browse/most-used/` | Stats summary | Effective projects in the 28-day window, highest first; suppressed counts last | Not built (static 404) |
| `/browse/highest-success/` | Stats summary | Green rate point estimate, among stacks with an unsuppressed rate only | Not built (static 404) |
| `/browse/trending/` | Stats summary (`trending`) | Trending score, among stacks that qualify (below) | Not built (static 404) |
| `/browse/newest/` | `v1/directory.json` | Date the entry was added, newest first | Built |
| `/tags/<tag>/` | Index output; stats cells from the summary | By name | Built without stats cells |
| `/fragments/` | Index output | By category, then by name | Built (it never carries stats) |
| `/fragments/<id>/` | Index output; stats section from `/v1/fragments/:id/stats` | n/a | Built without stats |

Every view links to every other that was built, so no page is a dead end. Ties break by id. The stats-ordered views are behind the `STATS_ENABLED` site switch (roadmap, Contracts: Site feature switches; on only on the D17 path, after 4.2a's tables exist). When it is off, `/browse/most-used/`, `/browse/highest-success/`, `/browse/trending/` and `/agents/*` are not built, so they return the static 404 on Node and on Workers alike, and `/`, tag and fragment pages are built without stats. 4.2e's dependency pages use a second switch, `DEPS_ENABLED`, the same way.

The site nav follows the same rule, so it never links to a static 404: it leaves out Trending when `STATS_ENABLED` is off and Dependencies when `DEPS_ENABLED` is off, and it always has the stack directory and `/fragments/`. The nav reads the switches from `site-config.ts`, like the pages, so a page and its nav entry can't disagree.

There are no agent pages. The stack page's per-agent breakdown is 4.2b's section, listed alphabetically by agent, and no page lists agents in order of anything ([open question 31](../risks-and-open-questions.md#open-questions-for-the-maintainers)).

### When an entry was added

`build:index` takes an entry's added date from git: the commit date of the first commit that added its definition file (`git log --diff-filter=A --format=%cI -- <entry>/STACK.md`), run through `Processes` like the build's other git reads. An index-only entry uses the same rule on its source path. The dates go into `v1/directory.json`, signed in the same envelope as the index; the site verifies it with `INDEX_PUBLIC_KEYS` like the index and fails its build on a bad signature. The date is the content's age, not its popularity, so the newest view needs no telemetry and no `installs` table.

### `v1/directory.json`

Added 2026-10-27, so this repository's build and the site can be written at the same time. `packages/format/src/directory.ts::DirectoryData` is the payload, signed in the same `SignedIndex` envelope (same key, same verification) and written beside `v1/index.json` and `v1/names.json`:

```json
{ "formatVersion": 1, "generatedAt": "<ISO>", "commit": "<sha>",
  "entries": [ { "id": "astro-api", "kind": "stack", "addedAt": "<ISO commit date>" } ],
  "removed": [ { "id": "old-stack", "kind": "stack", "removedAt": "2027-03-01",
                 "replacedBy": "new-stack", "reason": "Merged into new-stack",
                 "last": { "version": "v0.3.1", "name": "Old stack", "description": "...",
                           "tags": ["api"],
                           "steps": [ { "name": "test", "phase": "check", "layer": "test", "run": "bun run test" } ],
                           "lastRun": { "...": "LastRun, optional" } } } ] }
```

`entries` has one row per index entry, stacks and fragments, sorted by kind then id. `removed` is sorted by id. `replacedBy` is optional: a removed entry with no replacement omits it, and its page's notice drops the "Use <replacedBy> instead." sentence and the copy command. `last.version` is the last `v*` release tag that shipped the entry (the same tags `release-names.ts` reads). An entry that only ever shipped through the index takes `last` from the previous index output (`--previous`: its index entry and bundle) and omits `version`; with `--previous none` and no release, the build fails naming it, since its page would have nothing to show. Later builds keep an already removed entry's `last` from the previous verified `v1/directory.json`, since the entry has left the previous index too; a previous publication without a directory file (404) is accepted, and any other fetch error, a bad signature or a payload that doesn't decode fails the build; `last.steps` holds each step's `name`, `phase`, `layer` (optional, as in the entry) and `run`, with `withStepDefaults` applied. The site reads every other fact about current entries from the index and its bundles, as 4.0e's pages do. `removed.json`'s rows use the same `replacedBy` (optional), `reason`, `kind` and `removedAt` (`YYYY-MM-DD`).

### Removed entries

`packages/cli/registry/removed.json`, edited by the maintainers in the change that removes an entry:

```json
{ "schemaVersion": 1,
  "entries": { "old-stack": { "kind": "stack", "removedAt": "2027-03-01",
                              "replacedBy": "new-stack", "reason": "Merged into new-stack" } } }
```

The build fails if an id in 4.0e's `OfficialNames` (every id any released CLI version or index has shipped) is in neither the current registry, the index nor `removed.json`, or if `replacedBy` names an id that isn't current. So a removed stack can't silently lose its page. `build:index` writes each removed entry's record and its last static content from the last release tag that shipped it (name, description, tags, verify steps, last ledger run) into `v1/directory.json`. Its page at `/stacks/<id>/` shows that content and opens with "Removed from the registry on <date>: <reason>. Use <replacedBy> instead." and the copy command for the replacement, never for the removed id. With telemetry, the stats section shows the last published window rows, labelled with their `through` date. `reason` is plain text the maintainers write, escaped like every other value (Astro escapes by default; no page uses `set:html`).

### Trending

For each stack, from 4.2a's rows: `last7` is the effective project count in the 7-day window ending at the last finalized day, and `prior28` is the effective count in the 28-day window ending 7 days before that.

```
score = (last7 + 5) / (prior28 / 4 + 5)
```

The `+ 5` terms keep a stack going from 1 to 3 projects from looking like a surge. A stack qualifies only when `last7` is at least 10, counted on the capped effective sample (so one install or one network can't create a trend) and on mature installs only (4.1d's `installs`: an install first seen less than 24 hours before a project's scaffold doesn't count, which 4.2a already applies). `/browse/trending/` lists qualifying stacks with a score of at least 1.5, highest first.

`StatsSummary` entries gain an additive field, decoded as optional so 4.2b's CLI keeps working against an older API:

```json
"trending": { "value": true, "score": 1.8, "suppressed": false,
              "last7": { "value": 25, "suppressed": false },
              "prior28": { "value": 55, "suppressed": false } }
```

`value` is true when the stack qualifies and its score is at least 1.5. `last7` and `prior28` are the score's two inputs, as counts under 4.2a's count rule and rounding, so the trending view can draw this week's projects against the average prior week. Added 2026-10-27, splitting "doesn't qualify" from "too few to publish": when both inputs are published counts, `trending` carries `score` and `value: false` for a stack that doesn't qualify (including `last7` from 5 to 9, which reveals nothing the published counts don't); only when either input is suppressed does it come back `{ value: null, suppressed: true }` with no score, since a score over a suppressed count would leak it. The score uses exact values, so it can't be recomputed exactly from the rounded counts shown, and `/stats/about/` says so. The CLI ignores the field; it exists for the trending view and so a later client can read it without a schema change.

### Often used with

The daily rollup step (4.2a) gains one dimension, `cooccur`, over each project's final fragment set (defaults minus `--without`, plus `--with`). For a fragment A and another fragment B within one stack:

```
lift(A, B) = P(B in set | A in set) / P(B in set)
```

computed over the capped projects of the 28-day window. A pair is shown only when the projects containing both reach an effective sample of 5, and only when lift is above 1. Added 2026-10-27: pairs related by `requires` in either direction are left out, because a required fragment always co-occurs and its lift is just `1 / P(B)`. Because the set is the final one, this covers both "attached together" and "kept together". The fragment page shows up to three such fragments, highest lift first, with the stack each applies to. The fragment detail (4.2a's `GET /v1/fragments/:id/stats`) gains an additive `oftenUsedWith: [{ id, stack, lift }]` carrying them, so the site reads them over the same route as the rest of the fragment's numbers.

### Fragment and tag pages

A fragment page has the fragment's name, description, the stacks it applies to (from its frontmatter), whether each stack includes it by default, the files it ships (paths only), the verify steps it adds (name, phase, layer, command), its last ledger run through a stack that included it (the same rule as 3.1a's `lastRun`), a link to its source, and the copy command `npx @steamfield/stacks new <stack> --with <id>` for each stack it applies to. With telemetry, the site build fills its stats section from `/v1/fragments/:id/stats`'s numbers and the "often used with" list: the weekly projects including it, by stack; per stack (4.2a's `byStack`), its 28-day projects, its kept rate where it is a default or attach rate where it is optional, and the with-and-without green rates where both cells publish; shares of its projects by stack follow 4.2a's rule for totals and shares.

`/fragments/` lists every current fragment from the index output, grouped by `category` and by name within each, with its description and the stacks it applies to, linking to each fragment page. It needs no telemetry and carries no stats cells.

Added 2026-10-27: "Alternatives in <category>", the other current fragments with the same `category` that apply to at least one of the same stacks (from the index output, so it needs no telemetry), by name, each with its attach rate per shared stack when published. It answers "what else does this job" (a different deploy target, a different auth vendor) without ranking vendors against each other: the list is alphabetical. A fragment with no alternative omits the section. `category: app` fragments list other apps for the same stack. How every number on these pages is drawn is [4.2f](phase-4.2f-stats-pages-and-charts.md)'s.

A tag page lists every current stack and fragment carrying that tag, by name, with the same cells as `/`. Tags come from entry frontmatter. A tag becomes a path segment, so `build:index` fails on a tag that isn't `^[a-z0-9-]+$` and names the entry; `validate` has no such rule today, and adding one is a format change for 1.5's owner to consider, not this sub-phase's.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/scripts/build-index.ts` | Writes and signs `v1/directory.json` (added dates, removed entries); checks `removed.json` against `OfficialNames`; rejects bad tags |
| `packages/format/src/directory.ts`, `src/stats.ts` | `DirectoryData` schema for `v1/directory.json`; `trending` (with `last7` and `prior28`) on summary entries and `oftenUsedWith` on the fragment detail (all additive, published before the site uses them) |
| `packages/cli/registry/removed.json` | New, empty `entries` |
| `stacks-api/apps/web/src/pages/browse/`, `tags/`, `fragments/` (with its index page), `stacks/[id]/` | The new pages and the removed-stack variant |
| `stacks-api/apps/web/src/components/SiteNav.astro` | The nav, built from the site switches |
| `stacks-api/apps/api/src/stats/trending.ts`, `src/stats/cooccur.ts` | Score and lift |
| `stacks-api/apps/api/src/stats/rollup.ts` | The `cooccur` dimension in the daily step |
| `packages/cli/tests/` and `stacks-api/apps/web/tests/`, `apps/api/tests/` | New, in each repository |
| `AGENTS.md`, `stacks-api/AGENTS.md`, the directory's about text | The views, the trending score and lift in the words above |

## Acceptance tests

Split 2026-10-27 by where each test runs: this repository's build here, the site's pages under "Acceptance tests in stacks-api", and the telemetry views under "Deferred acceptance tests (telemetry)", written when D17, 4.2b and 4.2f have landed.

1. `build:index` over a fixture registry in a fixture git repository writes a `v1/directory.json` that verifies with the test key, decodes as `DirectoryData`, and carries each entry's first-add commit date for every stack and fragment in the index, sorted by kind then id; `build:index --check` verifies it against the served copy and fails on a changed byte.
2. A fixture where `OfficialNames` holds `old-stack` and the registry doesn't: `build:index` fails naming it; with a `removed.json` row it succeeds and `removed` carries the row and `last` taken from the last `v*` tag that shipped `old-stack` (its name, description, tags, steps with defaults and last ledger run). A `replacedBy` naming an id that isn't current fails the build naming it; a row without `replacedBy` is accepted and written without it.
3. A tag that isn't `^[a-z0-9-]+$` (one containing `<`, one with a capital) fails `build:index` naming the entry; a `reason` containing `<` is written verbatim.
4. A shallow clone fails `build:index` before writing anything, with a message saying added dates need full history.
5. Every row in `packages/cli/registry/removed.json` names an id that is no longer bundled, with a `replacedBy` (when present) that is, and the bundled registry's current entries, built with no removal rows, write a `v1/directory.json` whose entries match the index.

### Realistic edge cases

6. Edits and removal/re-addition of a definition do not reset its first-add date, and unproven entries stay out of the directory.
7. Directory history reads work from an unrelated working directory with inherited git repository selectors, through paths containing spaces and non-ASCII characters.
8. Invalid removal records refuse publication and preserve existing output and sibling files; a failed shallow build also preserves existing output.
9. `--check` rejects a missing, unsigned, unknown-key or correctly signed but invalid directory payload, even when the index and bundles verify.
10. A carried-forward fragment absent from the working registry still gets its added date from its historical source path.

## Acceptance tests in stacks-api

Numbered for `stacks-api`'s own tags (`[4.2c-site#N]`); this repository's trace doesn't count them.

1. The site built over a signed fixture index output with its `v1/directory.json` has `/browse/newest/` in added-date order, newest first, ties by id; a tag page per tag listing every stack and fragment carrying it by name; a fragment page per fragment (name, description, the stacks it applies to and whether each includes it by default, its files by path, its verify steps, its last ledger run through a stack, its source link and `npx @steamfield/stacks new <stack> --with <id>` per stack); and `/fragments/` listing every fragment grouped by category, then by name, linking to each fragment page.
2. `/stacks/old-stack/` opens with "Removed from the registry on <date>: <reason>. Use <replacedBy> instead." and the replacement's copy command, shows the `last` content, and no built page contains `new old-stack`; a removed entry without `replacedBy` has the notice without the last sentence and no copy command.
3. With `STATS_ENABLED` and `DEPS_ENABLED` off, every built page's nav links the directory, `/browse/newest/` and `/fragments/`, none links `/browse/trending/` or `/deps/`, and every nav link on every built page resolves to a built page.
4. A fixture where `cloudflare-pages` and `docker-deploy` share `category: deploy` and one stack: `/fragments/cloudflare-pages/` lists `docker-deploy` under "Alternatives in deploy", alphabetically; a fragment alone in its category has no such section.
5. With `STATS_ENABLED` off the build writes no `/browse/trending/`, `/browse/most-used/`, `/browse/highest-success/` or `/agents/*` page (agent pages are never built) and makes no stats request, and those paths return the static 404 from the Node server.
6. A `reason`, name or description containing `<` renders escaped.
7. A `v1/directory.json` with one changed byte, or a payload that doesn't decode, fails the site build.
8. The newest view, a tag page, `/fragments/`, a fragment page and a removed page contain no `<script>` other than 4.0e's theme toggle and copy script, and Axe (through Playwright) reports no violations on each in light and dark.

## Deferred acceptance tests (telemetry)

- Seeded `window_metrics`: `/` orders stacks by Wilson lower bound with suppressed ones after by name; `/browse/most-used/`, `/browse/highest-success/` match hand-sorted fixtures; ties break by id.
- Trending: `last7 = 12`, `prior28 = 8` gives score `17 / 7`, about 2.43, listed, with `last7` and `prior28` published as rounded counts; `last7 = 9` with a published `prior28` is not listed and comes back `value: false` with its score and `suppressed: false`; `last7 = 4` comes back `{ value: null, suppressed: true }` with no score; 12 projects from one install count 3 and don't qualify.
- Lift over a seeded window matches a hand computation; a pair with an effective sample of 4 is not shown; a pair where one fragment `requires` the other is not shown whatever its lift; the fragment detail's `oftenUsedWith` equals the list the page shows.
- Nav: with both switches on, every page's nav links to Trending and Dependencies.
- 4.2b's CLI decodes a summary with and without `trending`.
- Page checks, with the stats built through 4.2f's components: every green-rate value on `/`, the browse pages, tag and fragment pages has its interval and `n` (4.2f test 3's scan); those pages contain no `<script>` other than 4.0e's theme toggle and copy script; Axe (through Playwright) reports no violations on `/browse/highest-success/` and a fragment page, in light and dark; no page lists agents in rate order.

## Exit criteria

- Acceptance tests pass; `bun run check` green from this repository's root and in `stacks-api`.
- One manual deploy (4.0e's deploy procedure) shows every view, and `build:index --check` passes, now covering `v1/directory.json`.
- A maintainer reviews a browse page and a fragment page in both themes and on a phone width (as 4.2f's exit criteria do for the stack page), and `/stats/about/` gains the trending score and lift in the words above.
- The telemetry-free parts may be marked executed on their own, with the telemetry views recorded as deferred until D17 and 4.2f.

## What this plan may get wrong

- With a handful of stacks, sorted views and trending say little. They are cheap once 4.2a exists, but if the catalog stays small, ship only newest, tags, fragment and removed pages and leave the stats-ordered views unbuilt.
- The trending constants (`+ 5`, the 10-project floor, the 1.5 threshold) are guesses. They are API config, applied when the summary route computes `trending`.
- 2026-10-27: the plan wrote pages from `packages/cli/scripts/site/` and had the Worker render the stats-ordered views. Under D35 every page is in `stacks-api/apps/web`, so this repository now hands the site its git-derived facts as the signed `v1/directory.json`, a contract that didn't exist before. Its schema joins `packages/format`'s additive exports.
- Git commit dates as added dates assume the build runs in a full clone. A shallow clone gives the clone date; the build checks for a shallow repository and fails rather than writing wrong dates.
- 2026-10-27: the plan made 4.2f a dependency of every part, which put the telemetry-free views behind the D17 chain (4.2f, 4.2g, 4.2a). 4.2f, 4.2b and 4.1d are now dependencies of the telemetry views only, and the site's tokens come from 4.0e.
- 2026-10-27: a review of the site's design mocks found a nav entry for a fragment index the plan didn't have, a nav that would link to unbuilt views, a trending field that mixed "doesn't qualify" with "too few to publish" and had no inputs to draw, and a lift list that would rank a required fragment. `/fragments/`, the nav rule, `last7` and `prior28` with the split, the `requires` exclusion and `oftenUsedWith` on the fragment detail are added above.
- 2026-10-27: the mocks show stars (counts on list rows and fragment pages, a "Starred" browse view, an avatar in the nav). The site leaves them out, per roadmap "Won't have" ("Ratings, reviews, accounts"); a local-only saved list would be a new proposal in `requirements.md`.
- 2026-10-27: the mocks' agent breakdown lists `gemini`, which the CLI can't record: an agent it doesn't detect is `other` (roadmap, Contracts: Agent ids). Agent pages and rows show only `DetectedAgent` values.
- 2026-10-27: execution splits the telemetry-free parts into this repository's `v1/directory.json` build and the site's pages, written in parallel against the `DirectoryData` shape above; the site's test fixture is regenerated from the real build before its pages merge. `replacedBy` became optional, since a stack can be retired with nothing to replace it. The nav, with both switches off, links the directory, `/browse/newest/` and `/fragments/`; tag pages are reached from the tags on each row and stack page.
- 2026-10-27, the site test author's questions: `/browse/newest/` lists stacks only (fragments are on `/fragments/`); fragment pages have no source link, as 4.0e; a fragment's files show as project paths (the bundle path without `files/`); its copy command is `new <stack>` where it is a default and `new <stack> --with <id>` where it is optional; a fragment applying to no indexed stack names its `applies_to` as text with "No indexed stacks yet" and no command; its last ledger run is the newest pinned run of an indexed stack that includes it, since the index records no optional-fragment proof; the nav is exactly the directory, `/browse/newest/` and `/fragments/` in that order, on every page but 4.0b's `/status/`; with `STATS_ENABLED` unset or `false` the stats views are off; a configured `STACKS_INDEX_DIR` without a valid signed `v1/directory.json` fails the site build, and 4.0e's fixtures gain one.
- 2026-10-27: the maintainers dropped agent pages ([open question 31](../risks-and-open-questions.md#open-questions-for-the-maintainers)): no `/agents/*`, and the per-agent breakdown stays on each stack page (4.2b), alphabetical by agent. The `/agents/claude/` acceptance item is removed.
- 2026-10-29: acceptance item 5 assumed the bundled removal manifest would stay empty. Renaming `astro-api` to `astro-fullstack` adds its first row, and a removal row's `last` comes from the release tags, which the single-commit test fixture doesn't have. Item 5 now checks the rows against the bundled entries and builds the current entries with no rows; item 2 still covers a removal built from release history.
- 2026-10-28 (landed, stacks-api): the trending dimension is computed when the summary is read (`apps/api/src/stats/trending.ts`), with the summary's sort options, instead of a separate rollup column. The maintainers chose that version over a rollup-stored one because it also fixed the sorts the site needed.
