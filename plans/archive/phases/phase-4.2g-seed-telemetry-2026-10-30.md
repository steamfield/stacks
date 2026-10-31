# Phase 4.2g: Seed telemetry for development

Status: EXECUTED 2026-10-28 (into a local SQLite file instead of local D1, amended D16)

| Field | Value |
|---|---|
| Goal | One command in `stacks-api` fills a local D1 database with realistic, deterministic telemetry for the stacks and fragments the current index holds, by running generated events through the real ingest, maintenance and rollup programs day by day, so the site, the stats routes and a source build of the CLI show believable numbers in development; it can't reach production data or the production endpoint, and everything it produces labels itself as seeded |
| Traces to | 4.2f's pages need data in every state before real data exists. Seeded numbers are never shown in the demo: [DEMO_OUTLINE](../../../product/DEMO_OUTLINE.md) allows "No invented author names, adoption counts or success badges", telemetry arrives only after 4.0f (D16), which comes after the demo, and the demo's evidence minute uses ledger runs on 4.0e's pages |
| Depends on | 4.2a (the rollup and routes it fills), 4.1b (the ingest program, `EventStore`), 4.1c (`maintain`, `registry_snapshots`), 4.1d (installs, exclusions, anomaly flags), 4.0f (local D1 and the Workers runtime), 4.0c and 4.0e (the local index output and `v1/names.json` it reads its universe from). Soft: 4.2d (with it, verify events carry `deps` under schema version 2). 4.2c's and 4.2e's rollup dimensions fill from the same events without changes here once they land; they depend on this sub-phase through 4.2f, not the other way round |
| Blocks | 4.2f (pages are built and reviewed against seeded data) |
| Decisions needed | None beyond D17's. The volumes and distributions below are a proposal; they are config |
| Settles | Where seeded events enter (the ingest program, not HTTP and not raw tables); the seed profile; determinism and regeneration; how production is made unreachable; how seeded data is labelled; the local stats dev loop; how a source build of the CLI reads a local API |

## Scope

In:

- `bun run seed` in `stacks-api` (root script delegating to `apps/api`): generate, ingest, maintain and roll up N days of telemetry into a local, persisted D1 database.
- A seed profile: populations, distributions and scripted storylines, all from one integer seed.
- `bun run dev:stats`: seed when needed, then the API under the local Workers runtime over the seeded database and the site's dev server pointed at it.
- The `population` value `"seeded development data"` (4.2a) and the production-build refusal.
- In this repository: `STACKS_DEV_API_URL`, read by `config.ts` only when `AppConfig.releaseBuild` is false, so `bun run dev list --json` can read the local API.

Out:

- Seeding production, staging or any remote database, ever.
- Fixtures for unit tests. 4.1b-4.2e test against hand-computed fixtures; seeded data is for looking at, not for asserting exact metrics.
- Abuse scenarios (stuffing, concentrated contributors). 4.1d's tests own those; a default seed raises no anomaly flag.

## Design

### Where seeded events enter

Three paths were possible:

| Path | Verdict |
|---|---|
| `POST /v1/events` over HTTP | Rejected. The server stamps `received_at` from its own clock, so history can't be backdated without a header or flag that would be a backdoor in production code. Rate limits (60 per minute per network) would make a 120-day history take hours |
| Insert rows into `events`, `projects` and `window_metrics` directly | Rejected. It bypasses normalization, `classify`, the `projects` upsert, exclusions, maturity and the rollup, so seeded numbers could take shapes production never produces, and every change to those programs would have to be mirrored in the generator |
| Call the ingest program in process, under a controlled clock, then `maintain` and the rollup | Chosen |

The seed runs the same Effect programs the Worker runs: the ingest program below the HTTP handler (decode per `schemaVersion`, normalize, released-version and step checks, recompute, classify, store with the `projects` upsert) with the `EventStore`, `RateLimiter` and `NetworkHasher` D1 layers over the local `SqlClient`; then 4.1c's `maintain` (with 4.1d's steps) and 4.2a's hourly and daily rollup steps. Effect's `Clock` is a service, so the seed provides one set to each simulated instant; no production code gains a parameter for this. Events are built as `TelemetryEvent` values from `@steamfield/stacks-format` and encoded, so a schema change breaks the generator at compile time rather than producing rows the schema rejects.

The ingest program has no seed awareness. The one production rule that knows about seeded data, rejecting the reserved seeded install-id form (point 5 under "Production can't be reached"), sits in `handlers/events.ts`, above the program, so it applies to every event that arrives over HTTP and never to the seed, which calls the program directly. The reserved form is a UUID version 8, so `TelemetryEvent.installId` (4.1a: "a random UUID"; 4.1b echoes "UUID-shaped" ids) must decode any RFC 9562 UUID rather than a v4-only brand; if 4.1a brands it as v4 when it executes, the reserved form becomes a v4-shaped id with a fixed prefix instead, and this section changes with it (roadmap, Contracts: Telemetry event).

The simulation advances one UTC day at a time. For day D it ingests D's events at their simulated receive times (with a synthetic client IP per network, hashed by the real `NetworkHasher` under a fixed local key), then runs `maintain` at D+1 00:10 and the daily rollup at D+1 00:30, and the hourly rollup once. Archive runs against the in-memory `Archive`, since local R2 holds nothing anyone reads. Running maintenance day by day is what makes the store look the way production would after N days: network hashes expire after 30 days, raw events older than 90 days are pruned, distinct-network counts are taken while hashes exist, and older series points are kept as computed (4.2a).

### The universe

The seed reads what exists from the locally built index output that the dev loop already assembles (4.0c, 4.0e): `v1/names.json` for official ids and each composition's step names, and the index entries' bundles for each stack's default, optional and required fragments and each fragment's `applies_to`. It seeds `official_names` and `released_versions` through 4.1c's refresh programs from those files, so normalization treats every seeded id as official. With 4.2d it reads `v1/allowlist.json` and seeds dependencies only from names on it.

When an entry is added or removed, the next seed covers it: the generator's input digest (sha256 over `names.json`, the index payload and the allowlist) is stored with the seed marker, and `bun run dev:stats` reseeds from scratch when it changes. Stable per-entry randomness (below) means adding one stack doesn't reshuffle every other stack's numbers.

### The profile

All draws come from one PRNG per (seed, purpose, entry) key, so a stack's numbers depend only on the seed and its own id: no draw depends on how many other stacks exist or where they sort. Values are proposals in `scripts/seed/profile.ts`:

| Aspect | Model |
|---|---|
| Days | 120 by default (`--days`); the oldest 30 then have pruned raw events and expired hashes, as production would |
| Stack popularity | Each stack's base volume is its own draw from a heavy-tailed (Pareto, shape 1.1) distribution keyed by (seed, `volume`, stack id), clamped so the largest is about 40 projects a day at peak and the tail under 1. No rank or permutation over the set, so adding a stack leaves every other stack's volume unchanged |
| Weekly shape | Weekdays 1.0, Saturday 0.45, Sunday 0.4; daily noise ±15% |
| Storylines | One stack rising (logistic growth from a fifth to full volume over the last 45 days), one falling (half volume over the last 30), one launched 20 days ago (so it is under the gate). `profile.ts` names the storyline stacks by id; when a named id isn't in the index, that storyline goes to the eligible stack (base volume over 5 a day) with the lowest keyed hash of (seed, storyline, id) |
| Content change | One stack, named in `profile.ts` the same way, gets a registry change 40 days before the end: a `registry_snapshots` row with a new digest, its green rate drops by 15 points for 10 days, then recovers, so the history chart has a marker with a visible effect |
| Installs | Each stack draws its own installs from a stream keyed by (seed, `installs`, stack id); no seeded install uses two stacks. Each install draws a project count: 70% one project, 25% two to five, 5% six to twelve; heavy installs go only to stacks whose base volume is over 15 a day (a fixed threshold, not a rank), so no contributor passes 4.1d's 20% flag. 95% of installs are first seen at least a day before their first scaffold (a `show` event first); 5% scaffold within the hour, so maturity excludes some |
| Networks | Per stack, from the same keyed stream: installs grouped into networks of one (60%), two to four (35%) or an office of 20 (5%); a dozen ASNs |
| Agent mix | Claude Code 55%, Codex 25%, Cursor 10%, OpenCode 5%, `other` 2%, none 3%; per stack, one agent's green rate shifted by ±8 points |
| OS mix | `darwin` 70%, `linux` 28%, `other` 2%; Node majors from the supported range |
| Preset | `sandbox` 35%, `default` 65%; sandbox green rate 5 points higher |
| Handoff and source | Launch, print and inside-agent in proportions per stack; `source` absent in 40% |
| Fragments | Each default fragment dropped with `--without` at a per-stack rate drawn from Beta(1, 12); each optional one attached at a rate from Beta(2, 10); two fragment pairs per stack attached together more often, so lift has signal |
| Verify | 12% of projects never verify; the rest verify until green or give up. Per stack, green probability for a project from Beta around a stack mean between 0.6 and 0.95; verify runs before green geometric with mean 2.2; 6% of failed runs env-blocked; failing steps drawn by weights that favour `test` and `typecheck` |
| Timing | Time to green log-normal per stack, median between 6 and 40 minutes; time to first passing test 40-70% of it; step durations bucketed as 4.1a sends them |
| Scaffold failures | 3% of `new` attempts send an `error` event, codes weighted toward `TargetNotEmpty` and `ComposeConflict` |
| Pick rate | 60% of installs that `show` a stack scaffold it within a week |
| Dependencies (with 4.2d) | Per stack, each allowlisted name in its `deps` reported by 90% of green projects; majors derived from a hash of the name (no real version numbers are encoded), with one dependency per ecosystem moving to the next major across the last 60 days |

Volume at the defaults is about 6,000 projects and 25,000 events. It passes the publishing gate with most stacks over the rate thresholds, leaves the launched stack and the tail suppressed, and leaves at least one by-agent cell suppressed, so every 4.2f state appears.

### Determinism

Same seed, same profile version, same input digest: identical rows in every table, byte for byte, because ids (install, project, event, batch) are derived from the PRNG, the clock is simulated and the hash key is fixed. `--seed` defaults to 1. The seed marker row `maintenance_state.seed = { seed, profileVersion, inputDigest, days, through, complete }` records what produced the store. The seed writes it first, with `complete: false`, before any event, and sets `complete: true` only after the last rollup, so an interrupted run leaves a marker that says it is partial rather than no marker at all. `dev:stats` reseeds whenever the marker is missing, incomplete, or has another input digest.

### Production can't be reached

The guarantee is structural, with checks behind it:

1. No network code. The seed never makes an HTTP request and has no URL, account id or token parameter. It gets its database from Wrangler's local platform proxy for the `apps/api` config with local persistence only (no remote bindings), whose files live under `apps/api/.wrangler/state/`. There is no code path that builds a remote D1 client.
2. The `bun run seed` and `dev:stats` entry (`scripts/seed/index.ts`) runs `guard.ts` before anything else and refuses to start when the config it loaded has any remote binding or a `database_id` other than the local development one named in `wrangler.jsonc`'s dev environment, when `CI` is set, or when `CLOUDFLARE_API_TOKEN` is set (a sign the shell is a deploy shell). The refusal names the reason and exits non-zero. The guard lives in the entry only: `simulate.ts` takes a `SqlClient` and a clock as inputs and has no guard and no config of its own, so the acceptance tests (which run in CI, where `CI` is set) call it in process over a temporary local D1 or an in-memory `SqlClient`, and the guard is tested on its own (test 9).
3. Seeded data labels itself. Every stats route returns `population: "seeded development data"` instead of `"stacks projects"` (4.2a) whenever the seed marker exists, complete or not, or any `projects` row carries the reserved seeded install-id form (point 5). The second condition is read from the data itself in 4.2a's `stats/encode.ts`, so a store copied without its marker row, or a partial copy, still labels itself. The CLI and every page print the population, so seeded numbers can't be read as real anywhere they appear.
4. A production site build refuses seeded data: when the build's production flag is set (the flag `bun run deploy` passes), a summary with the seeded population fails the build. 4.1e's launch checklist gains one line: `GET /v1/stats/summary` on production reports `"stacks projects"`.
5. The seeded install ids carry a reserved form (UUID version 8 with a fixed prefix), and 4.1b's HTTP handler (`handlers/events.ts`, above the ingest program) rejects that form per event, so a seeded event replayed at production over HTTP is refused and never stored.

### The local loop

```
bun run seed [--seed N] [--days 120] [--force]   # fill or refill apps/api/.wrangler/state
bun run dev:stats                                 # seed if missing or stale, then API + site
```

`dev:stats` builds or reuses the local index output, seeds when the marker is missing, incomplete or its input digest differs, starts the API under the local Workers runtime over the persisted database, and starts the site's dev server with its API base set to that local URL. `bun run dev` is unchanged: the Node entry with the in-memory store and no stats.

For the CLI, a source build reads the local API with `STACKS_DEV_API_URL=http://localhost:<port> bun run dev list --json`. `config.ts` reads that variable only when `AppConfig.releaseBuild` is false and only for a loopback host; the release bundle ignores it, so 4.2b's rule that no environment variable changes a released CLI's API host stands. The seeded population comes through in `stats` like any other field.

## Files and areas touched

| Path | Change |
|---|---|
| `stacks-api/apps/api/scripts/seed/` | `profile.ts`, `random.ts` (keyed PRNG), `population.ts` (installs, networks, projects), `events.ts` (`TelemetryEvent` builders), `simulate.ts` (the day loop over ingest, `maintain` and the rollup, over a given `SqlClient`; no guard), `guard.ts` (the refusals), `index.ts` (the entry: guard, then the local platform proxy, then `simulate.ts`) |
| `stacks-api/package.json`, `apps/api/package.json` | `seed`, `dev:stats` |
| `stacks-api/apps/api/src/stats/encode.ts` (4.2a) | `population` from the seed marker or the reserved install-id form in `projects`; the store that reads them follows `stacks-api/.claude/rules/api/effect-api.md` ("Store", `api/services/<Name>Store.ts`) as [open question 37](../../risks-and-open-questions.md#open-questions-for-the-maintainers) settles |
| `stacks-api/apps/api/src/handlers/events.ts` | Reject the reserved seeded install-id form per event |
| `stacks-api/apps/web/src/site-config.ts` | The production flag and the seeded-population refusal |
| `packages/cli/src/config.ts`, `tests/helpers/cli.ts` | `STACKS_DEV_API_URL` for source builds only |
| `stacks-api/apps/api/tests/seed.test.ts`, `packages/cli/tests/` | New |
| `stacks-api/AGENTS.md`, `apps/api/README.md` | The seed and the stats dev loop |

## Acceptance tests

Tests 1-8 and 12 call `simulate.ts` in process over a temporary local D1 or an in-memory `SqlClient`, never the `bun run seed` entry, whose guard refuses under `CI` (test 9 covers the guard). "A default seed" below means `simulate.ts` with the default profile.

1. `simulate.ts` with seed 7 and 60 days, run twice into fresh stores, gives byte-identical dumps of every table.
2. Seeds 7 and 8 differ; adding one stack that no storyline names to the fixture index changes no other stack's `projects` rows or events.
3. After a default seed, `GET /v1/stats/summary` is `published: true`, has `population: "seeded development data"`, lists the launched stack with suppressed values, and at least one stack's `byAgent` has a suppressed cell.
4. The rising stack's trending `value` is true; the falling stack's score is under 1.
5. The content-change stack's series has one `changes` marker on the scripted day, and the first series point whose 28-day window covers the 10 days after it has a lower green rate than the last point before it.
6. Every seeded event passes the ingest program (`rejected` empty for every simulated batch), and no `projects` row comes from an excluded event. The ingest program contains no check for the seeded form (the check is only in `handlers/events.ts`, test 11).
7. A default seed raises no `anomaly_flags` row.
8. Rows older than 90 simulated days are absent from `events` and present in `projects`; `network_hash` is null on rows older than 30 days.
9. The `bun run seed` entry refuses, naming the reason, with `CI=1`, with `CLOUDFLARE_API_TOKEN` set, and with a fixture config holding a remote D1 binding; in each case no file under `.wrangler/state` changes. The test runs `guard.ts` and the entry with those inputs, not a full seed.
10. A static scan of `scripts/seed/` finds no `fetch`, `HttpClient` or URL literal other than loopback.
11. An event with a seeded install id posted to the real ingest route is listed in `rejected` and not stored.
12. A site build with the production flag against the seeded API fails; without the flag it succeeds and every page carries 4.2f's banner.
13. With 4.2d landed: seeded verify events carry `deps` with only allowlisted names, and one dependency shows a major transition in `GET /v1/deps/npm/:name/stats`.
14. In this repository: a source build with `STACKS_DEV_API_URL` set to a loopback URL fetches stats from it; the same variable with a non-loopback host is ignored; a release build (`releaseBuild: true` in the test helper) ignores it.
14a. A store holding seeded `projects` rows but no `maintenance_state.seed` row (the marker deleted by hand) still reports `population: "seeded development data"`.

### Realistic edge cases

15. `dev:stats` with a seeded store whose input digest no longer matches the index output reseeds; with a matching digest it starts without reseeding.
16. A seed interrupted halfway (Ctrl+C, or the simulation stopped after a given day in the test) leaves a marker with `complete: false`; the stats routes over that store report `population: "seeded development data"`, and the next `dev:stats` reseeds from scratch rather than serving a partial history.
17. An index with a stack that has no optional fragments, or a fragment no stack includes by default, seeds without division by zero and leaves those cells empty.
18. A 10-day simulation seeds a history too short for the gate: the summary is `published: false`, which is itself a state 4.2f needs.
19. A `profile.ts` storyline naming a stack id the index doesn't have falls back to the eligible stack with the lowest keyed hash, and the same seed picks the same one twice.

## Exit criteria

- Acceptance tests pass; `bun run check` green in `stacks-api` and in this repository.
- A maintainer runs `bun run dev:stats` from a fresh clone and sees the directory with seeded numbers and the banner, and `STACKS_DEV_API_URL=... bun run dev list --json` with seeded `stats`.

## What this plan may get wrong

- Running `maintain` and the rollup for 120 simulated days may be slow on local D1 (4.2a already worries about the daily recompute). If a default seed takes more than a few minutes, run maintenance every simulated day but the daily rollup only for the last 35 days, and compute older series points once at the end.
- The distributions are invented. They are meant to look plausible and exercise every state, not to predict real usage; once real data exists, a profile fitted to it is a better default.
- Rejecting a reserved install-id form at ingest is a production rule added for development's sake. If the maintainers prefer, drop it and rely on the structural guarantee plus the population label.
- `STACKS_DEV_API_URL` is a second way to set the API host in source builds. If it confuses anyone, replace it with a `dev:local-api` script that builds the CLI with a different constant.
- 2026-10-27: the first draft modelled popularity as a Zipf rank over a seeded permutation and shared installs across stacks, so adding a stack changed every other stack's volume and contradicted test 2. Volumes and installs are now per-stack keyed draws, and no seeded install uses two stacks. Real installs do span stacks (pick rate across stacks, a heavy user trying several); the seed doesn't show that, and a cross-stack storyline would need its own keyed pool if a page ever needs it.
- 2026-10-27: the first draft let the seed refuse when `CI` is set while its own acceptance tests, and 4.2f's, ran it in CI. The guard now lives in the entry only and the tests call `simulate.ts` in process.
- 2026-10-28: on the Node host (amended D16, 4.0f deferred) the seed writes a SQLite file, not local D1, and this line overrides the body where they differ. The seeded store is its own file beside the development database, `.dev/data/seeded.sqlite`, so `bun run dev` keeps its own data; `simulate.ts` takes the SQLite `SqlClient` the server uses, with migrations applied, and the tests give it a temporary file. The archive is 4.1c's directory `Archive` over a directory under `.dev/data/`, because no in-memory one exists. The guard refuses when the target file is outside the repository's `.dev/data/`, when `CI` is set, or when `NODE_ENV` is `production`; test 9's remote-binding and `CLOUDFLARE_API_TOKEN` cases become a target path outside `.dev/data/` and `NODE_ENV=production`, and the files that must not change are under `.dev/data/`. `dev:stats` seeds when the marker is missing, incomplete or stale, then starts the Node API (`bun run dev:api`) with `STACKS_DB_PATH` set to the seeded file and prints its URL. The site's half of `dev:stats` and test 12 wait until the site reads the API rather than fixtures (4.2f, owned with the site), and the summary route is `GET /v1/stats` (4.2a's REST line). The ingest, `maintain` and rollup programs run in process as the body says; `installId` already decodes any RFC 9562 UUID (`Schema.isUUID`), so the reserved form stays a version 8 UUID.
- 2026-10-28: the body never named the fixed prefix. The reserved seeded install-id form is a UUID version 8 whose first eight hex digits are `5eed5eed` (`5eed5eed-xxxx-8xxx-[89ab]xxx-xxxxxxxxxxxx`); 4.2a's population tests, 4.1b's ingest rejection and the seed share that one definition in `stacks-api`.
- 2026-10-28: test 4 (a trending rank) needs 4.2c's trending dimension and is deferred with tests 12, 13 and 14. The seed makes no network request: `maintain`'s released-versions step gets an in-process npm response built from the profile's CLI versions, through the real refresh decoder. The HTTP handler rejects the reserved form; in-process ingest (the seed, tests) may write it.
- 2026-10-28: `dev:stats` doesn't build the index output; it reads a signed index from `STATIC_DIR` and its key from `STACKS_INDEX_PUBLIC_KEYS`, and refuses without them. Nothing can produce one locally yet: `build:index --key` signs only with a key listed in `INDEX_PUBLIC_KEYS`, which is empty, and `--unsigned` output fails the API's signature check. A fresh checkout can't seed until a development signing path exists. Resolved the same day: outside production the API accepts an envelope with `keyId: "unsigned"` and an empty signature (production keeps only the signature verifier), and `build:index --unsigned --include-unproven` writes every bundled stack and fragment, so a developer points `STATIC_DIR` at that output with no key. The profile's storylines first named fixture-only ids, which fell back on the real index and found no eligible stack; they now name bundled stacks (astro-api rising, python-react falling, tauri-react launched, typescript-cli changed). QA over the bundled registry: 10 stacks, 7,361 events in about 23 s; the storylines and the change marker show. The seed's realism is thin where nothing reads it yet: every failing step is `install`, `entryPoints.source` is always `unknown`, and the busiest stack has 80 projects in 28 days.
- 2026-10-28 (execution): test 4 is active. Trending landed with the summary's sort options, and the rising storyline qualifies. A demo host needs seeded data to read as real usage, so `STACKS_DEMO=true` (API config, forwarded by Compose, default `false`) makes the stats routes report `population: "stacks projects"` for a seeded store. The site then shows no seeded label, and its production build accepts the data. Without the setting nothing here changes, and the seed guard still refuses production.
- 2026-10-28 (landed, stacks-api): three seed changes are on `main`. A growing share of seeded installs run a v2 CLI and send `deps` from their stack's and fragments' declared dependencies, filtered by the signed allowlist, with later reports that produce adoption and major transitions, so a seeded store publishes 4.2e's cells (profile version 7). `--profile active` is a named scale profile beside the default: about 178,000 projects and 763,000 events over 120 days, with weekday and time-of-day rhythm, the storylines, a suppressed tail and no 4.1d flag; the default profile and its tests are unchanged. The seed reads entries through the API's verified bundle reader (`apps/api/src/stats/entry-assets.ts`, shared with search) instead of its own frontmatter parsing. Open: the active profile's run time, and running it into the deployed store, which the production host still serves from the small default seed with the seeded label.
- 2026-10-28 (landed, stacks-api): integrity reconciles incrementally from a rowid cursor and reopens history only when the exclusions, the released versions or the last run's success changed; install summaries update only affected installs; archiving compares counts before reading a day's rows; the rollup reads only the receipt days its window needs (migration 0008 adds a partial index on `events.excluded`). Published output is unchanged: every table digest of seed 1 `--profile active` matches over 7 and 14 days. The 7-day active seed went from 45 s to 22 s; the full 120-day run takes about 46.5 minutes against the 15-minute target, almost all of it rollup (once explicitly and again inside `maintain`, about 1,100 s each). That is acceptable for a one-time demo store; halving it means not rolling up twice.
