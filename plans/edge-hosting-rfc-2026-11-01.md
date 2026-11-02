# RFC: a static edge in front of a self-hosted origin

Status: REVIEWED 2026-11-01 by one devils-advocate pass (findings applied below and summarized at the end) and a search scale benchmark ("Search at scale"); spike done ("Spike findings"). Amended 2026-11-01 after the spike: search stays on the origin, and search on the edge is deferred until the scale trigger in "Search" is met. Proposed decision D41, superseding D16.

Repository: `stacks-api` (GitHub `steamfield/stacks-app`, private; paths below are relative to its root unless written `stacks/...`). The deferred edge search would add one export in `stacks/packages/format`.

## Summary

Production splits into two halves with a build between them.

- The edge: Cloudflare Workers static assets serve one built tree (the site, the signed index, a stats snapshot), and one stateless Worker answers the `/v1/**/stats` routes and `/docs/*` negotiation from that tree. It holds no state, talks to no database, and runs on the Workers Free plan.
- The origin: the existing Node container on the maintainers' M4 keeps telemetry ingest, search, SQLite, maintenance, integrity, rollups and the archive. The edge forwards `POST /v1/events`, `GET /v1/search` and `GET /healthz` to it, through the existing Cloudflare Tunnel.
- The build: a GitHub Actions self-hosted runner on the M4 deploys both halves when `main` goes green, republishes stats once a day after maintenance, and redeploys when a new signed index arrives. Every deploy exports one stats snapshot, and the pages and the Worker's stats responses in that deploy come from it.

Every public read except search is served from a build artifact. Search runs on the origin as it does today, uncached (D36), with the API's per-network rate limit. Stats roll up and publish once a day and say when they were generated; integrity still runs hourly on the origin. Released CLIs (0.6.0 calls `https://stacks.steamfield.io/v1/search`, `/v1/stats` with cursors, `/v1/{kind}s/{id}/stats`, the static `v1/allowlist.json` and `POST /v1/events`; it doesn't fetch the index) keep working without a release, because the edge answers the same contract.

## Why the direction changes

D16 made Workers with Cloudflare D1 the production host, reached by migrating the API (4.0f). Measured against the code on 2026-11-01, that migration is large and buys little:

- D16's amendment required storage code to use only what Cloudflare D1 runs (no interactive transactions). The store has drifted: `apps/api/src/store/integrity-exclusions.ts:135`, `store/integrity-flags.ts:131`, `store/projects.ts:80` and `store/stats.ts:134` read, decide in JS and write inside `sql.withTransaction`. Each would become a batch rewrite of the most test-heavy code in the repo.
- Workers isolates get 128 MB. The container runs with `--max-old-space-size=4096` because rollups and stats reads process telemetry in memory.
- The stats read cache checks `pragma_data_version` (`store/stats.ts:188`), the archive uses `node:fs` with fsync and atomic renames, and the integrity queries in `store/integrity-sequence.ts` nest `json_each` over `events`, which risks Cloudflare D1's per-query time limit on a large database.
- 4.0f assumes "D1 starts empty and there is nothing to copy". Production now holds a store, and real telemetry starts at launch.
- Cost: the Free plan's 10 ms CPU per invocation and per cron run cannot run maintenance (budgeted at 15 minutes), so a Workers-hosted API needs Workers Paid from day one. On Paid, Cloudflare D1's 10 GB per-database cap (not raisable) arrives around 35k events a day at 90-day retention, scaled from the `active` seed profile (654k events over 90 days in a 2.0 GB file).

Meanwhile most public reads already come from build-time data: `prod:deploy` builds the stats views and dependency pages from the live API (`STATS_API_URL`). Moving the remaining reads to the build and keeping the writes on hardware the maintainers already run costs $0 at Cloudflare and keeps the SQLite store, its tests and its operator tooling unchanged.

## Decision D41 (proposed)

Production is a static edge in front of a self-hosted origin. Cloudflare Workers static assets serve one built tree, and one stateless Worker on the Free plan answers the stats and docs reads from it and forwards ingest, search and health to the origin. Telemetry ingest, search, SQLite storage and maintenance stay on the Node container on the maintainers' M4, reached only through the edge. Search moves to the edge only when the scale trigger in "Search" is met. Deploys run on a self-hosted GitHub Actions runner on the M4. D16 is superseded: Cloudflare D1 is not used and the API is not migrated to Workers.

## Request routing

All public paths stay on `stacks.steamfield.io`, so the CLI's compiled `DEFAULT_API_URL` and the site need no URL change.

| Path | Served by | Notes |
| --- | --- | --- |
| Static files (site pages, `v1/*.json`, `v1/entries/**`, `v1/schemas/**`, `openapi.json`) | Workers static assets | No Worker invocation. `_headers` applies as today. `openapi.json` is generated at runtime today (`apps/api/src/app.ts:41`); the build writes it as a file |
| `GET /v1/search` | Worker forwards to the origin | The API's search, unchanged: same `SearchResponse`, `Cache-Control: no-store`, no cache of any kind (D36), the API's per-network rate limit |
| `GET /v1/stats`, `/v1/stacks/:id/stats`, `/v1/fragments/:id/stats`, `/v1/deps/:ecosystem/stats`, `/v1/deps/:ecosystem/:name/stats` | Worker, from the stats snapshot | Same parameters, bodies, ETags and errors as the API, checked by a parity test |
| `/docs/*` | Worker | Chooses the HTML or Markdown asset from `Accept` and `User-Agent`, as `apps/api` does today, with `Vary` |
| `POST /v1/events`, `GET /healthz` | Worker forwards to the origin | Adds client IP and ASN headers and the origin credential; streams the body |
| Any other `/v1/` path | Worker | Contract `NotFound` envelope |

`run_worker_first` lists `/v1/*` (minus the static document patterns, which the Worker hands to `ASSETS`), `/healthz` and `/docs/*`; everything else is assets only, with `not_found_handling: "404-page"` so a site miss gets the static 404 without invoking the Worker. The spike confirms the pattern syntax and that entry bundle paths containing `sha256:` upload and serve unchanged.

Browser-side calls that invoke the Worker: the search page (forwarded to the origin), `/status/` (`apps/web/src/islands/ApiStatus.tsx:10` calls `/healthz`), `/docs/*` views, and the stack history chart. The chart fetches on mount today (`apps/web/src/islands/HistoryChart.tsx:44-50`); with a daily snapshot that request returns the data the page was built with, so the chart fetches only when the reader changes the range.

## The edge Worker

A new workspace, `apps/edge`, holds the Worker. It imports `packages/contract` (schemas, error envelope), never `apps/api`, so it can't reach a database because nothing it may import can. Its Grit rules mirror the API's (`fetch` only in its entry, no `process`, no `node:*`). It is a plain `fetch` handler decoding queries with the contract's schemas: the spike measured Effect's `HttpRouter.toWebHandler` at about 3 ms more per cold request and no difference warm. With search on the origin, the Worker's own work is stats slicing (0 to 3 ms cold in the spike) and forwarding, so this choice matters less than it did, and it is revisited if search moves to the edge.

At current traffic most requests will land on a cold isolate, so cold is the common case and the budget is set for it. Workers forbid I/O at global scope, so data the Worker needs is bundled into the script and parsed at startup, which counts against the startup limit rather than request CPU. Loading through the `ASSETS` binding on first request is the fallback when a bundle nears the 64 MiB script limit.

Observability stays off (`observability.enabled: false` in the Wrangler config) unless the logs redact query strings, because the Worker forwards search requests and their query text must not be recorded anywhere (D36, and the `/telemetry` page's "no table or counter is keyed by the text").

### Search

Search stays on the origin. The Worker forwards `GET /v1/search` to `stacks-origin` with the same client IP and ASN headers and service token as ingest ("Ingest, search and health forwarding"), and the API answers it as it does today (`apps/api/src/services/Search.ts`): the index and search cards are loaded once and held in memory, each query is ranked in process, and the per-network limit (`search-rate-limit.test.ts`) applies by reading `X-Stacks-Client-IP`. The response stays `Cache-Control: no-store`. There is no Cloudflare cache rule and no shared cache such as Redis: ranking is CPU work over data already in memory, so a cache lookup would cost about what it saves, the origin is one process with nothing to share, and any cache keyed by the query would store query text, which D36 and the `/telemetry` page rule out. Caching search would need D36 amended first.

What this gives up: search depends on the M4. When the origin is unreachable, the edge returns 5xx for search, the CLI falls back to local ranking and backs off for 10 minutes, and the site's search page fails until the origin returns. The spike found the Free WAF rule can't express today's per-network, per-minute limit, and its 429 is plain text rather than the contract's `RateLimited` envelope; keeping search on the origin keeps the existing limit and response.

The origin has room today: the current ranker takes about 11 ms p50 per query on the M4 at 64 entries and about 48 ms at 250 ("Search at scale"). Search moves to the edge, as designed below, when either of these holds:

- `/v1/search` p95 in the origin's request records (`durationMs`, which never includes the query text) exceeds 100 ms over a day, or
- the signed index passes 250 entries.

Either one starts the deferred work: the format export below, then the corpus build and the edge route. The trigger is checked when the index grows and from `bun run prod:logs`; it isn't automated in this RFC.

#### Deferred: search on the edge

When the trigger is met, the Worker ranks with the same code the CLI and the API use, through a new additive export in `stacks/packages/format`:

- `prepareCorpus(entries, vocabulary): PreparedCorpus` tokenizes each field once and stores per-field term frequencies and lengths, plus the raw text of every non-body field and each search card request, which `missingTarget`, `stackMentions`, `facetConflicts`, `excluded` and `bestRequest` read per query. Body text is stored as term frequencies only (weight 0.15, and the largest field by far).
- `rankPrepared(corpus, { request, kind, limit }): SearchResult` ranks against it. BM25 statistics for the `requests` field stay per query, because each entry's chosen request depends on the query; the document set keeps empty documents for fields an entry lacks, and scores sum in the original field order so floating point results match.
- The old `rank` stays as a test oracle. A property test requires byte-identical output from both for every golden query, plus the search evaluation gate. The 2026-11-01 prototype (token and term-frequency caches over a copy of the ranker) produced identical output on all 96 golden queries at 64 and 1,000 entries.

The build writes the corpus with each stack's published stats evidence joined in from the same snapshot, unsigned (it is derived from signed inputs by the deploy that serves it). `stacks-api` takes `@steamfield/stacks-format` from npm (`^0.7.0` today), so the format release ships before the edge can serve search. The prepared corpus is built at deploy time or at global scope, never on the first request: the spike measured a lazily filled cache at 24 ms for the first query at today's catalog.

Edge search keeps no cache either. Its rate limit would be a Cloudflare WAF rule, which on Free (spike item 6) can match `http.host` and the path and count per IP over 10 s, but not per network or per minute, and answers 429 with a plain-text body. At the trigger's 250 entries the spike measured 8 ms per cold request on the M4 with a plain handler, close to the Free plan's 10 ms on slower edge CPUs, so moving search to the edge likely means Workers Paid ($5 a month) or retrieve-then-rerank ("Search at scale").

### Search at scale

Measured 2026-11-01 with the real registry (41 stacks, 23 fragments) and the 96-query golden set, extended with deterministic synthetic distractors: each one stitches sentences, tags, card fields and body paragraphs from three random real entries of the same kind. Those are hard negatives that sometimes contain the exact sentences a query matches, so the quality numbers are a pessimistic bound. Times are Bun on the M4, warm, `limit: 5`; edge CPUs are slower per core.

| Entries | MRR | recall@3 | Fragment recall@5 | First result | Precomputed p50 / p95 | Today's `rank` p50 / p95 | Raw corpus |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 64 (real) | 0.99 | 0.96 | 1.00 | 79/79 | 1.2 / 2.2 ms | 10.8 / 13.9 ms | 0.7 MB |
| 250 | 0.90 | 0.95 | 1.00 | 75/79 | 4.8 / 7.4 ms | 47.6 / 57.8 ms | 2.9 MB |
| 1,000 | 0.84 | 0.87 | 0.99 | 72/79 | 36 / 63 ms | 228 / 309 ms | 11.6 MB |
| 3,000 | 0.79 | 0.83 | 0.96 | 70/79 | 165 / 293 ms | not run | 35 MB |

What this says:

- Hosting doesn't change quality; the edge runs the same ranker with identical output. What changes with catalog size is lexical ranking itself: relevant entries slide down as similar entries pile up. The no-match checks (8/10) don't move. Catalog growth will need the golden set to grow with it, and is the start condition 4.5d already names for semantic retrieval.
- The precomputed ranker is about ten times faster than today's and keeps the current catalog well inside the Free plan's 10 ms. It stays inside it up to roughly 200 entries, warm. Past that, every query still visits every entry (mention detection, constraints, BM25 over each field), so cost grows linearly.
- At 1,000 entries and up, the Free plan's budget needs a second step: retrieve then rerank. An inverted index over the corpus picks the entries that share a term or a vocabulary facet with the query, and the full ranker scores only those, with corpus-wide BM25 statistics precomputed so scores don't change. A property test against the oracle decides whether pruning is exact enough. The corpus without raw bodies, and the script size limit, are measured in the spike at 1,000 entries.
- Workers Paid ($5 a month, 30 s CPU, 30M CPU-ms included) is the other out. At 1,000 entries and 60 ms a query, the included CPU covers about 500k searches a month. Nothing else in this design changes on Paid.

The plan: search stays on the origin with today's ranker until the trigger in "Search" is met. Then ship the precomputed ranker on the edge, on Paid unless a CPU measurement on the real edge shows Free has room, and build retrieve-then-rerank as the catalog approaches 1,000 entries.

### Semantic search and storage

Semantic retrieval (4.5d) fits this design without a vector database. The vectors are of catalog entries, which the build already processes, so they ship as a build artifact: next to the index the origin reads while search is there, and in the search corpus once search is on the edge. At 1,000 entries, `text-embedding-3-small` vectors truncated to 256 dimensions and quantized to int8 are about 256 KB, and an exact cosine scan over them is a few hundred thousand multiply-adds, well under a millisecond. pgvector and approximate indexes earn their place at millions of rows, or when vectors change at request time; neither applies to a catalog rebuilt per deploy.

The cost that does change is embedding the query on each request. While search is on the origin, the API makes that call; once it is on the edge, the Worker would call the Workers AI binding (wait time isn't CPU time, and the free allowance is daily), and the request text then reaches a model, which D36 and the `/telemetry` page have to allow. That decision stays with 4.5d, which already has `search:eval --embeddings` to measure whether fusion beats lexical ranking.

Telemetry storage stays on SQLite. The workload is one writer on one machine, appends plus a daily rollup, and the `active` profile is 2 GB at about 7k events a day; SQLite handles tens of gigabytes on one host. Postgres becomes worth planning when one of these holds: ingest needs more than one writer or host, the origin needs failover, the daily run no longer fits its 15-minute lease after query work, or a feature needs vector search over data that changes between deploys (user content, not the catalog). The opendata Postgres on the M4 is not a shortcut: it would couple stacks' production data and privacy guarantees to another project's database and backups.

### Stats

A new exporter, `apps/api/scripts/export-stats.ts`, writes the snapshot from the API's existing, tested stats routes over localhost, never from SQLite, so the edge publishes exactly what the API computes. The API orders lists by exact, unrounded values (`apps/api/src/stats/selection.ts:74-80`, `stats/trending.ts:22-25`) and publishes rounded ones, so the Worker never sorts; it replays orders the API produced:

- `stats/list/<window>/<kind|all>/<sort>.json`: for each of the 30 combinations of `window` (7, 28), `kind` (none, stack, fragment) and `sort` (5 values), the full ordered item list, walked through the API's cursors to the end.
- `stats/<kind>/<id>/<window>-<interval>.json`: each stack and fragment detail for each `window` and `interval` (4 files per entry), with the full stored Sunday series, not a 366-day slice. Interval-28 strides anchor on the latest Sunday across all history (`stats/detail.ts:145-150`), so trimming a full export is exact for any `from`/`to`.
- The dependency routes, the same way, for every name in the signed `v1/allowlist.json`, with names percent-encoded in file paths (`@astrojs/check`, `connectrpc.com/connect`).

The Worker decodes the query with the contract schema, picks the file, slices by `limit` and cursor (copying `paginate`'s `kind/id` qualification for ids both kinds share, `selection.ts:43-46`, and its generation check), trims detail series to `from`/`to`, and computes the ETag as SHA-256 over the encoded body, as `stats/cache.ts:19-22` does, answering `If-None-Match` with 304. Errors follow `docs/telemetry.md` (`BadInput` for unknown keys, malformed ids and stale cursors; `NotFound` for well-formed unknown ids). `Cache-Control` stays `public, max-age=3600, stale-while-revalidate=3600`.

The exporter refuses to write a snapshot whose registry is empty or holds fewer entries than the index (`StatsRegistry` returns `[]` with no error when `index.json` is missing, `stats/registry.ts:19`).

A parity test is the guarantee: for a query matrix (every window, kind and sort; a small `limit` with cursors walked to the end; detail ranges inside and across interval-28 boundaries; deps with a scoped npm name and a Go module; every error and 304 case), the edge's response from the exported snapshot equals the API's from the same database. Its seed must have an open gate, suppressed cells, an id shared by a stack and a fragment, more than four Sundays, scoped dependency names and over a year of history; the spike checks whether the `active` profile has all of that or needs a parity profile.

### One snapshot per deploy

Every deploy, whatever triggered it, exports a fresh snapshot after the origin is up, and the Astro build reads that snapshot rather than the live API: `STATS_API_URL` points at a local server running the edge's own handler over the snapshot directory. The pages and the Worker's stats responses then come from one generation, which avoids today's double deploy in `prod:deploy` (`scripts/production.ts:165-169`) and the chart's "not available yet" failure when a page's `through` is newer than the Worker's. Search evidence comes from the origin's live stats instead (`summaryEvidence` in `Search.ts`). With rollups daily, those are the same cells as the snapshot except between the 03:00 rollup and the 04:20 stats deploy, when search can already report the new day.

### Ingest, search and health forwarding

The Worker forwards `POST /v1/events`, `GET /v1/search` and `GET /healthz` to an origin hostname on the existing tunnel, one level below the zone so Universal SSL covers it (`stacks-origin.steamfield.io`). It puts the client IP (from `CF-Connecting-IP`) and ASN (`request.cf.asn`) in `X-Stacks-Client-IP` and `X-Stacks-Client-ASN`, and `production.env` sets `TRUSTED_PROXY_IP_HEADER` and `TRUSTED_PROXY_ASN_HEADER` to those names; ingest and the search limiter read those settings already, so neither changes, and the zone's `X-Visitor-ASN` transform rule is retired. A Cloudflare Access application on the origin hostname admits only the Worker's service token, so nobody can reach the API directly with forged headers. Forwarding is well under 1 ms of CPU; the body (at most 512 KiB) streams. The Worker removes `Set-Cookie` from forwarded responses, because Access answers a service-token request with its `CF_Authorization` session cookie.

`/healthz` through the edge only proves the path to the origin, so the external uptime check also probes `/v1/stats`, one `/v1/search` and one static file.

### Cost on the Free plan

Static asset requests are free and unlimited. Worker invocations count against 100k a day: search (forwarded), stats, docs views, `/status/`, ingest, health, and chart range changes. Forwarding a search costs the Worker well under 1 ms of CPU; the ranking runs on the origin. The 0.6.0 CLI backs off search for 10 minutes after a failure and caches stats for a day (`stacks/packages/cli/src/core/cached-fetch.ts:153`). Past 100k a day Workers Paid is $5 a month.

## The origin on the M4

The container, SQLite, maintenance timer, archive and operator commands are unchanged. What changes:

- The public hostname no longer routes to it; only `stacks-origin` does, behind Access.
- The image no longer carries the static tree. The complete signed index output (`index.json`, `names.json`, `allowlist.json`, `search.json`, `directory.json`, `entries/**`) is bind-mounted read-only from `~/stacks-deploy/index/`, because `StatsRegistry` (`stats/registry.ts:16-33`), maintenance and the stats routes the exporter calls read the index and every bundle, and ingest reads names and the allowlist. The mount is the parent directory and `STATIC_DIR` points at `current` inside it, and an index install restarts the container, so a swapped symlink is always picked up.
- An index install also runs the names refresh step (`maintain`'s signed names update), because ingest judges events against `official_names` in the database, which otherwise refreshes only at 03:00 (`apps/api/src/services/Events.ts:73`).
- It keeps serving `/v1/search` to production traffic, through the edge. Its public stats routes stay in the code for the exporter, the parity tests and `bun run dev`, but production traffic no longer reaches them.
- Stats roll up daily only. Nothing reads hourly cells once publication is daily, and a daily rollup means every deploy on a given day (code, index or stats) publishes the same 03:00 cells. The hourly timer run keeps integrity only: it drains the recheck queue (500 pairs a run, `apps/api/src/integrity/policy.ts:9`, so 12k a day instead of 500) and raises flags such as `error_spike` within the hour rather than the next morning. `maintain`'s hourly mode drops its stats step (`apps/api/src/maintenance/maintain.ts:106`), and the `stale_rollup` flag's threshold moves from three hours to 26, matching `maintenanceFresh`.

## Deploy pipeline

### The M4 as it is

Checked over `ssh m4-local` on 2026-11-01. The M4 (macOS 15.7, host `m4.lan`) has one interactive user, `rileyhilliard`, who logs in automatically at boot. Docker Desktop 29.1 runs as that user and starts at login (`AutoStart: true`); `/var/run/docker.sock` links to its socket. That one engine runs:

- `stacks-api` (Compose project `stacks-api`, port 3010, volumes `stacks-api_telemetry-data` and `stacks-api_telemetry-archive`) and its tunnel connector `stacks-m4-tunnel`, deployed today from a laptop over `DOCKER_HOST=ssh://`;
- `opendata`'s database containers (Postgres with pgvector, Neo4j);
- a monitoring stack: Grafana on 3000, Prometheus, Loki, Tempo and cAdvisor.

A repository-level runner for `rileyhilliard/opendata` (`m4-mini`, in `~/actions-runner`, LaunchAgent `actions.runner.rileyhilliard-opendata.m4-mini`) runs as `rileyhilliard` too.

### Runner and its trust boundary

The trust boundary on the M4 is the macOS user `rileyhilliard`. Docker Desktop is per user and needs that user's login session, so a separate runner user can't reach the production engine. And anything with the Docker socket can read a container's environment (`docker inspect` shows `NETWORK_HASH_KEY` today) or mount its volumes. The opendata runner already sits inside that boundary. The network hash key matters most: with it, the IPv4 space can be brute-forced back from stored network hashes, which would break the privacy page's "hashes, never addresses". So the deploy runner runs as `rileyhilliard` too, and protection comes from GitHub deciding what may run on it:

- A second runner, `m4-deploy`, registered to the `steamfield` organization in `~/actions-runner-steamfield` with its own LaunchAgent, in an organization runner group `stacks-deploy` that admits only the `steamfield/stacks-app` repository and only the workflow `steamfield/stacks-app/.github/workflows/deploy.yml@refs/heads/main`, with public repositories disallowed. `steamfield` is on GitHub Free; GitHub's documentation is inconsistent about whether Free organizations can create runner groups and restrict them to workflows, so the spike checks it (it needs a token with `admin:org`). If Free can't, the fallback is the Default group limited to `stacks-app`, and the residual risk below grows to include branch workflows in that repository.
- The deploy job runs only when all of these hold: `github.event.workflow_run.event == 'push'`, `workflow_run.head_branch == 'main'`, `workflow_run.head_repository.full_name == github.repository` and `workflow_run.conclusion == 'success'`, or the event is `schedule`, `workflow_dispatch` or `repository_dispatch`. `concurrency: deploy` with `cancel-in-progress: false` queues deploys.
- Secrets (the network hash key, the interim signing key, a Cloudflare token scoped to this Worker, the Access service token) live in a `0700` directory outside any checkout, as they do today under `STACKS_PRODUCTION_DIR`, never in GitHub secrets.
- Residual risk, accepted: any job that runs as `rileyhilliard` on the M4 can read those secrets and the production data. That includes the opendata runner's jobs, any workflow in `rileyhilliard/opendata` that targets it, and agents a maintainer runs on the M4.

The runner checks out into its own work directory, so the Compose project name must stay `stacks-api` (the deploy passes `--project-name stacks-api`); a different name would create empty volumes and fight the running container for port 3010.

### Runner operations document

`stacks-api/docs/operations.md` gets a "Deploy runner" section, written when the runner is set up, so a permissions problem or a stuck job can be traced without rediscovering the setup:

- What exists and where: organization, runner group and its allowed repository and workflow ref, runner name and labels, install directory, LaunchAgent label, macOS user, the secrets directory, the Docker context, the Compose project name and port, and the Cloudflare token's scopes and expiry.
- How to set it up again from nothing, including the `gh api` calls that create the group and set `restricted_to_workflows` and `selected_workflows`.
- A symptom table: a job queued forever (runner offline, a label mismatch, the group not admitting the repository, or a workflow ref other than `main`, which the group rejects silently); `Resource not accessible by integration` (token scopes); Docker permission or "cannot connect" errors (Docker Desktop not running, or the session not logged in after a reboot); `wrangler` authentication failures (token scope or expiry); Access 403s from the Worker (service token rotated); a deploy that created new empty volumes (wrong project name).
- Where the evidence is: the runner's `_diag` logs, `launchctl print gui/<uid>/<label>`, the Actions run log, `bun run prod:logs`, and Docker Desktop's own logs.
- What changes if the account's plan changes (runner group features), and the residual risk above, stated as accepted.

The M4's existing Loki and Grafana are a candidate destination for the `maintain` alert lines `docs/operations.md` says are still unrouted; that's a separate decision, not part of this RFC.

### Triggers

| Trigger | When | Builds from | Origin | Edge |
| --- | --- | --- | --- | --- |
| Code | A `main` push whose CI passed | `workflow_run.head_sha` | Rebuild image, restart | Export snapshot, build, deploy |
| Stats | Daily at 04:20 UTC | The last deployed sha, recorded on the M4 | None | Export snapshot, build, deploy |
| Index | `workflow_dispatch` with a `stacks` ref now; `repository_dispatch` from `stacks` once 5.2 signs in CI | The last deployed sha | Install index, restart, names refresh | Export snapshot, build, deploy |

Schedule and dispatch events have no head sha of their own, so they build from the recorded last deployed sha, never from `main` HEAD, which could be a commit whose CI failed. `~/stacks-deploy/index/current` has one writer, the index job. Under 5.2 the dispatch payload names a `stacks` workflow run, and the helper downloads its signed artifact with a read-only token; the payload can't carry the index itself.

`bun run prod:deploy` stops deploying on its own and calls `gh workflow run deploy.yml`, so every deploy goes through the one concurrency group.

### Job order

1. Check out the sha the trigger names, install, build.
2. Origin (code and index triggers): build the image, `compose up --wait`, check `/healthz` on localhost.
3. Freshness: require `last_success` at or after today's 03:00 UTC for the stats trigger. `maintenanceFresh` allows 26 hours (`apps/api/src/integrity/policy.ts:19`), so at 04:20 it still passes on yesterday's success; the job reads `last_success` through a new field on `/healthz` or `prod:query -- state`. Code and index triggers publish the latest daily rollup.
4. Snapshot: run the exporter; refuse an empty or short registry.
5. Edge: build the site against the snapshot, write `openapi.json`, `wrangler deploy`.
6. Post-deploy, through the public hostname: `/healthz`, `/`, one `/v1/search`, `/v1/stats`, one detail route, and `build:index --check`.

A failed step stops the job. The edge keeps its previous version when the build or deploy fails, and `wrangler rollback` restores an older one. The origin does not keep its previous container: `compose up --wait` replaces it first and waits afterwards (`docs/operations.md:164`), and migrations run forward at start, so redeploying the previous commit is not guaranteed to start against a migrated database. A rollback that crosses a migration needs the migration's own reversal or the pre-deploy backup. A preflight that starts the new image on a scratch port against a copy of the database before swapping is the fix if that risk becomes real; it isn't in this RFC.

If the stats freshness check fails, the job publishes nothing, the previous snapshot keeps serving, the run fails in the Actions tab, and the existing `stale_success` alert path in `docs/operations.md` applies.

## Failure modes

| What fails | What users see |
| --- | --- |
| M4 down or unreachable | Site, index and stats keep serving. `POST /v1/events` returns 5xx; the CLI keeps its spool for up to 7 days and retries. `/v1/search` returns 5xx; the CLI falls back to local ranking and backs off search for 10 minutes, and the site's search page fails. `/healthz` fails, which alerts |
| Daily maintenance fails | The stats job publishes nothing; the previous snapshot keeps serving; alert as today |
| Runner offline | No deploys; everything keeps serving the last build |
| Worker over its CPU limit | That request errors (1102). Stats routes measured 0 to 3 ms, so this is unlikely; a stats failure falls back to the CLI's cached copy |
| Worker over 100k requests a day | Dynamic routes error until 00:00 UTC; static files keep serving |
| New origin container fails health | Ingest and search are down until a fix or rollback deploy; the other reads are unaffected |
| Cloudflare down | Everything is down, as today |

## Cutover

1. Create `stacks-origin.steamfield.io` on the tunnel, behind Access, while the public hostname still routes to the container. Switch `production.env` to the new header names and deploy; the container now accepts both paths.
2. Deploy the Worker on its `workers.dev` subdomain, pointed at `stacks-origin`, and run the acceptance tests and `build:index --check` there.
3. Attach the Worker to `stacks.steamfield.io` with a Workers route on the existing proxied record, which avoids removing the tunnel DNS record first and the gap a Custom Domain swap would cause. The spike confirms a route on a tunnel-backed record serves the Worker's static assets.
4. Once traffic is on the edge, remove the public hostname from the tunnel's ingress rules.

## Spike (first, half a session)

Findings go into this file before any build work.

1. Does `@cloudflare/vitest-pool-workers` run with the repo's Vitest major (open question 17)? If not, edge tests use Wrangler's local runtime from Node.
2. CPU in workerd for `/v1/search` (cold and warm) with the precomputed corpus of today's catalog and of 250 and 1,000 synthetic entries, Effect `toWebHandler` versus a plain `fetch` handler. Budget: cold p50 under 5 ms, cold p95 under 10 ms.
3. The same for `/v1/stats`, detail at full history for both windows and intervals, and a dependency route, with the `active` seed's snapshot.
4. Corpus and snapshot bundled into the script: startup time and compressed size against the Free plan's limits, at today's catalog and at 1,000 entries without raw bodies.
5. A Worker fetch to `stacks-origin` behind Access with a service token, and which headers arrive at the origin.
6. What the Free plan's WAF rate limiting rule can express for `/v1/search`.
7. `run_worker_first` patterns for `/v1/*` minus static documents; `sha256:` paths through Wrangler; a Workers route on a tunnel-backed proxied record.
8. Whether the `steamfield` organization on GitHub Free can create the `stacks-deploy` runner group and restrict it to one workflow ref (`gh api orgs/steamfield/actions/runner-groups` with `admin:org`).

### Spike findings (2026-11-01, local half)

Items 1 to 4 and the local half of 7 ran on the M4 in workerd through Wrangler 4.147's `unstable_startWorker` (Miniflare 5.20261001 alpha). Items 5 to 8 then ran against the real Cloudflare account and GitHub organization, on throwaway names (`stacks-origin`, `stacks-staging`), all deleted afterwards; production on `stacks.steamfield.io` and the `stacks-m4` tunnel were not changed. Timings are workerd on the M4, read inside the isolate with `performance.now()`, which advances during a request at 1 ms resolution and is frozen at global scope. Cloudflare's edge CPUs are slower per core, so treat every number below as a lower bound. The scripts are throwaway, in the session scratchpad, and were not added to either repository.

The Workers limits page (read 2026-11-01) changes one premise: script size is 64 MiB uncompressed on both plans, and "there is no compressed size limit". The constraints that matter on Free are 10 ms CPU per request, 1 s startup and 128 MB of memory.

1. No. `@cloudflare/vitest-pool-workers` 0.23.0 is the latest release, has no prerelease tag, and declares `vitest: ^4.1.0`. Under Vitest 5.0.5 it warns (it throws only for 3.x) and then hung for over three minutes on a one-test project without output. Edge tests use Wrangler's local runtime from Node (`unstable_startWorker` and `fetch`), which every measurement here used without trouble.

2. Search CPU, request time only (milliseconds; "lazy" parses the corpus at startup and fills the prototype's caches on the first query, "warmed" also runs one throwaway rank at global scope; cold is the first request on a fresh isolate, 4 isolates per row, warm is 96 golden queries after a warm-up pass):

   | Entries | Handler | Startup | Cold p50 / max | Warm p50 / p95 |
   | --- | --- | --- | --- | --- |
   | 64 | plain, lazy | parse 2 | 24 / 26 | 1 / 2 |
   | 64 | Effect, lazy | parse 2 | 26 / 28 | 1 / 2 |
   | 64 | plain, warmed | parse 2 + warm 21 | 3 / 4 | 1 / 2 |
   | 64 | Effect, warmed | parse 2 + warm 21 | 6 / 7 | 1 / 2 |
   | 250 | plain, warmed | parse 5 + warm 57 | 7 / 8 | 4 / 6 |
   | 250 | Effect, warmed | parse 5 + warm 57 | 10 / 11 | 5 / 6 |
   | 1,000 | plain, warmed | parse 12 + warm 208 | 25 / 33 | 27 / 40 |
   | 1,000 | Effect, warmed | parse 12 + warm 208 | 32 / 41 | 25 / 38 |

   The preparation has to finish before the first request. Lazy caching costs a cold request 24 ms at today's catalog, so `prepareCorpus` output must be built at deploy time and loaded, or computed at global scope where it counts against the 1 s startup limit. Warmed at startup, today's catalog meets the budget with either handler. Effect's `toWebHandler` adds about 3 ms to a cold request (building the router and layer on first use) and nothing warm; at 250 entries that is the difference between passing (plain, 8 ms max) and failing (Effect, 11 ms). Recommendation: a plain `fetch` handler that decodes queries with the contract's schemas (the plain variant already imports `effect`'s `Schema` and the contract, 420 KB of code). At 1,000 entries, query work dominates: cold and warm are the same 25 to 40 ms, above the 10 ms budget even before edge CPU is slower, which agrees with "Search at scale" (retrieve then rerank, or Paid).

3. Stats, plain handler over a snapshot exported from the `active` seed through the API (430 files, 2.0 MB raw): `/v1/stats` default and filtered with a cursor, stack detail at both window and interval pairs, a ranged fragment detail, the npm dependency list and `@astrojs/check`. Every route took 0 to 3 ms cold and at most 1 ms warm, whether files were parsed at startup or per request. The SHA-256 ETag over the encoded body matched the API's byte for byte, and `If-None-Match` returned 304. Bodies equalled the API's for the detail, dependency list and dependency routes. The ranged detail did not, which matters for parity: a range has to rewrite the body's `from` and `to` and trim the nested `seriesByStack` series of a fragment detail as well as `series`. The `active` profile cannot be the parity seed: it has 120 days of history (series from 2026-07-05), no id shared by a stack and a fragment, and every list published. It does have suppressed cells, scoped npm names and Go modules. A parity profile is needed.

4. Bundle sizes from `wrangler deploy --dry-run` and startup from `wrangler check startup` profiles (non-idle CPU; the profiler needs the `--outfile` bundle from a dry run, not a plain script):

   | Bundle | Upload / gzip | Startup CPU |
   | --- | --- | --- |
   | Search, 64 entries, plain, warmed | 1.1 MB / 0.34 MB | 50 ms |
   | Search, 64 entries, Effect, warmed | 1.2 MB / 0.38 MB | 60 ms |
   | Search, 1,000 entries, plain, lazy | 12.1 MB / 3.8 MB | 54 ms |
   | Search, 1,000 entries, plain, warmed | 12.1 MB / 3.8 MB | 261 ms |
   | Stats, `active` snapshot, parsed at startup | 2.3 MB / 0.25 MB | 39 ms |

   All fit the 64 MiB and 1 s limits with room. The corpus can be much smaller: removing fields one at a time and keeping each removal only if all 96 golden queries rank identically at 250 entries dropped 23 fields (`meta` deps, commands, tools, decisions, env, verify, merge, fragments, requires, conflicts, requiresTools, needsOwnRepo; the card's source, description, seoDescription, projectExamples and plain; `dir`, `shadows` and schema ids). That is 11.7 MB to 7.9 MB at 1,000 entries, and 3.6 MB raw (1.2 MB gzip) with bodies stored as term-frequency pairs over a shared term list. Removal only changed timing slightly (1,000 entries, warmed: 23 / 35 ms cold). The golden set may not exercise `requires`, `conflicts` or `fragments`, so the oracle property test in `prepareCorpus` decides the final list, not this sweep.

5. Done, end to end. The setup was a throwaway tunnel run on this machine, `stacks-origin.steamfield.io` as a proxied CNAME to it, an Access self-hosted app on that hostname with one `non_identity` policy admitting a single service token and `service_auth_401_redirect: true`, and a `stacks-edge` Worker on workers.dev holding the token's id and secret as secret bindings, forwarding to a local header echo. All of it was created through the Cloudflare API and deleted afterwards; the production `stacks-m4` tunnel was not touched. A direct request to the origin hostname with no token, with forged `X-Stacks-Client-IP` and `X-Stacks-Client-ASN`, or with a bogus token got 401 from Access, and none reached the origin. The Worker without the token got 401; with the token it got 200, and a 533 KB POST streamed through with its `Content-Length` intact. At the origin, `CF-Connecting-IP` and `X-Forwarded-For` carry the Worker's egress address (`2a06:98c0:3600::103`), not the client's, so ingest must read only `X-Stacks-Client-IP` and `X-Stacks-Client-ASN`, which arrived with the real client address and ASN; the Worker's `set` replaced client-forged values of both. Access strips `CF-Access-Client-Id` and `CF-Access-Client-Secret` before the origin and adds `Cf-Access-Jwt-Assertion` (a signed JWT the origin could verify against the app's audience as defense in depth) and a `CF_Authorization` cookie. The Worker's response passed Access's `Set-Cookie: CF_Authorization=…` (24 hours, HttpOnly) back to the client. Replaying that cookie directly at the origin with a forged client IP still got 401 and never reached it, so it is not a bypass, but the Worker strips `Set-Cookie` from forwarded responses ("Ingest, search and health forwarding"). The Worker's wait on the origin was 37 to 296 ms from DFW; that is wall time, not CPU. Wrangler's OAuth login can't do this setup (no Access or DNS-write scopes), and neither can the `cloudflared` certificate on this machine (`route dns` fails for `steamfield.io` with code 10000); the Cloudflare MCP connection can. `steamfield.io` is in `Akuztikbeatz@gmail.com's Account`, the same account Wrangler deploys Workers to.

6. Done, against the `steamfield.io` zone (plan "Free Website"), with throwaway rules deleted afterwards. The rulesets API accepted a block rule counting `ip.src` (with `cf.colo.id`, which every rule carries), 10 s period, 10 s mitigation timeout, and an expression on `http.host` and `http.request.uri.path`, including `starts_with` on the path; the documentation lists only path for Free, but the hostname is accepted, so the production rule can be `(http.host eq "stacks.steamfield.io" and http.request.uri.path eq "/v1/search")`. It refused `http.request.uri.query` and `ip.src.asnum` ("an higher Advanced Rate Limiting plan is required"), any mitigation timeout but 10 (so the period can't exceed 10 s either), `managed_challenge`, and a second rule. Enforcement: five requests in 10 s passed and the sixth got 429 with `Retry-After: 10`, both on a path the origin serves and on `/v1/search` handled by a Worker route, so the rule runs before the Worker; requests with different query strings count together, and the same path on `stacks.steamfield.io` kept answering 200 while the staging hostname was blocked. The 429 body is `text/plain` `error code: 1015`, not the contract's `RateLimited` envelope, so the CLI must treat any non-JSON 429 as a search failure (0.6.0's fallback to local ranking and its 10-minute backoff need checking against that body), and `http-contract.md` must say the edge's limit answers outside the envelope. The highest per-IP rate expressible is a count per 10 s; today's per-network, per-minute limit (`EVENTS_PER_MINUTE` keyed by the network hash) is not.

7. Local half. `run_worker_first: ["/v1/*", "/healthz", "/docs/*", "!/v1/*.json"]` with `not_found_handling: "404-page"` routed as intended: `*` matches across segments, the negative pattern wins, and existing static documents, including `sha256:` entry bundles requested raw or as `sha256%3A`, are served from assets without invoking the Worker. One regression: a `.json` miss under `/v1/` (`/v1/missing.json`, `/v1/Index.json`) gets the HTML 404 page, while today's API returns the JSON `NotFound` envelope, which `apps/api/tests/routing.test.ts:84` and `static.test.ts:74` pin. The choice is to accept HTML for those misses and change the tests and `http-contract.md`, or to drop the negative pattern so every `/v1/*` request invokes the Worker, which hands document paths to `ASSETS` and makes each index or bundle fetch count against the 100k daily invocations. 

   Deployed half. The same Worker and a 37-file asset tree (the preview registry's `v1/`, entry bundles included) were deployed with Wrangler 4.147 to a Workers route `stacks-staging.steamfield.io/*` on a proxied CNAME to a throwaway tunnel, then deleted with the record and tunnel. Wrangler uploaded every `sha256:` file. A Workers route on a tunnel-backed record works: assets and the Worker answered on that hostname exactly as locally (home page, HTML 404 for site misses and for `.json` misses under `/v1/`, the Worker for `/v1/search`, `/v1/stats`, `/v1/nope` and `/docs/*`), and the Worker's `fetch(request)` for `/healthz` reached the tunnel origin, so a routed Worker can pass a path through to the record's own origin. One difference from local and from today's Node server: a raw `sha256:` path gets a 307 to the canonical `sha256%3A` form (lowercase `%3a` redirects too), and only the encoded form answers 200. `html_handling: "none"` does not remove it. Clients that follow redirects get the bundle in one extra round trip; a publisher or client that compares the response URL, or the `build:index --check` and site build steps that fetch bundles, must request or accept the encoded form. Cutover can attach the route to `stacks.steamfield.io` as planned.

8. Yes, as far as the API goes. On `steamfield` (plan `free`), `POST orgs/steamfield/actions/runner-groups` created a group with `visibility: selected` (only `steamfield/stacks-app`), `allows_public_repositories: false`, `restricted_to_workflows: true` and one `selected_workflows` ref, and reading it back returned every setting. The test group was deleted; the organization again has only `Default`. GitHub validates the workflow ref against the repository, so `deploy.yml` must exist on `main` before the group can name it (the first attempt, naming `deploy.yml`, was refused with "does not exist at the ref"). That the restriction is enforced, and not only stored, on Free is unverified until a runner is registered and a job from another workflow is seen to stay queued; that check belongs in setting up the runner and its operations section.

## Plans this replaces or changes

In `stacks/plans`, done when this RFC landed on 2026-11-01: `phases/phase-4.0f-workers-migration.md` archived as superseded with a change-of-direction note; D41 added and D16 marked superseded in `README.md` and `requirements.md`, with D35's Workers wording noted; open questions 16 (answered) and 17 (moved to this spike); `roadmap.md`, `HANDOFF.md`, `phases/phase-5.2-ci-index-build-and-deploy.md` (hand-off through `repository_dispatch`, the Cloudflare token on the M4 rather than in GitHub secrets) and `phases/phase-4.5d-semantic-retrieval.md` (vectors as a build artifact, query embedding through the Workers AI binding) amended; forward-looking mentions in other plans noted. D36 is unchanged: this design keeps search uncached. Still to do after the post-spike amendment: D41's wording in `README.md` and `requirements.md`, `roadmap.md` and `HANDOFF.md` say the Worker answers search, and `phase-4.5d-semantic-retrieval.md` puts query embedding in the Worker; each needs the origin-search wording and the deferred trigger.

In `stacks-api`, when the build starts: `AGENTS.md` ("Deferred": Workers return only as the stateless edge; Cloudflare D1 stays out), `docs/operations.md` (production, deploy, runbook, uptime checks), `docs/web.md`, `apps/web/README.md`, `apps/api/README.md` (search and static serving in production), `.claude/rules/api/http-contract.md` (static responses from the edge carry no `x-request-id`; search and its rate limit stay on the API), the `/telemetry` page if anything it says about search or addresses changes, `.claude/rules` for `apps/edge`, and `biome-plugins/boundaries.grit`.

## Acceptance tests

1. Deferred with edge search: for every golden query, `rankPrepared(prepareCorpus(...))` equals the oracle `rank(...)` byte for byte, at today's catalog and with 1,000 synthetic entries, and the search evaluation gate passes unchanged.
2. The stats parity matrix passes against the parity seed, including cursors, shared ids, 304s, scoped dependency names and every error case.
3. `/v1/search` through the edge returns the same `SearchResponse` as the API called directly, for the golden queries, and the API's per-network limit answers the edge-forwarded requests of one client with the contract's 429 `RateLimited` envelope and `Retry-After`.
4. In workerd, cold and warm CPU for the stats list, detail and dependency routes stay under the spike's budget, checked by a test that fails above it.
5. A forwarded `POST /v1/events` stores an event whose network hash and ASN come from the edge's headers; a request to `stacks-origin` without the service token is refused by Access; a forwarded response carries no `Set-Cookie`.
6. `/docs/*` serves Markdown to an agent `User-Agent` or `Accept: text/markdown` and HTML otherwise, with `Vary`. A miss under `/v1/` gets the JSON `NotFound`; a site miss gets the static 404 without a Worker invocation.
7. The released 0.6.0 CLI, pointed at a staging edge, runs `stacks search`, `stacks stats` and a telemetry flush.
8. A pull-request CI run and a branch push never start the deploy job; a green `main` push deploys origin then edge; the stats job publishes nothing when `last_success` is older than today's 03:00 UTC; the exporter refuses an empty registry.
9. After a code deploy, a stack page's history chart and the Worker's detail response report the same `through` and generation, and the search evidence for that stack reports the same `through` unless a rollup ran after the snapshot.

## Exit criteria

- Spike findings recorded here; D41 agreed.
- The "Deploy runner" section of `docs/operations.md` exists and was followed once from nothing on the M4.
- `stacks.steamfield.io` serves from the edge, and the public hostname no longer routes to the container.
- Three consecutive daily stats jobs succeed unattended.

## What this plan may get wrong

- Search depends on the M4 until it moves to the edge. If origin outages make the site's search page unreliable before the scale trigger is met, that is a reason to move search earlier, on Paid.
- The trigger may be reached faster than the deferred work can be built, if the catalog grows in one step. The format export can be built ahead of the trigger without deploying it.
- Byte-exact parity may be costly to maintain as stats evolve; comparing decoded responses is the relaxation.
- Daily publication may feel stale once real telemetry flows. Hourly publication would bring back the hourly rollup and cost one deploy an hour from the runner.
- The M4 is one machine on a home connection. Readers stop noticing its outages, but ingest still depends on it, and the CLI's 7-day spool is the only buffer.

## Maintainer answers (2026-11-01)

1. Rollup schedule: reduce it where hourly has no purpose. Stats roll up daily; integrity stays hourly for the recheck queue and timely alerts ("The origin on the M4").
2. Runner restriction: use a GitHub organization limited to the predefined deploy, and document it well enough to root-cause permission and job problems. `steamfield` already owns the repository; the runner group and the operations document are above, and the spike checks the Free plan's limits.
3. Docker ownership: the M4 also runs opendata's CI and production workloads. Its setup is recorded in "The M4 as it is", and the runner design follows from it.

## Review summary

The devils-advocate pass on 2026-11-01 found these, all applied above. Stats lists are ordered by exact values the snapshot can't carry, so the exporter now stores the API's orders for every window, kind and sort. Code and index deploys mixed stats generations, so every deploy now exports one snapshot that the site reads too. The origin reads the whole index, not two files, from an image rather than a mount, and silently serves empty stats without it; the mount, restart and exporter guard address that. The runner's trust boundary didn't keep pull request or branch code off it; job conditions and a workflow-restricted runner group do (the M4 check later showed a separate runner user cannot reach Docker Desktop, so secrets share the `rileyhilliard` boundary as an accepted risk). Detail exports lacked the `window` dimension and older ranges. The search cache contradicted D36 and is dropped. The freshness gate passed on yesterday's success. The rollback claim was wrong and is corrected. Corpus loading at global scope isn't allowed in Workers, and cold is the common case. The prepared corpus needs raw text and query-dependent statistics. Smaller corrections: routing and `not_found_handling`, a generated `openapi.json`, browser calls that invoke the Worker, the CLI's one-day stats cache, the M4's Docker engine ownership, deploy shas and a single deploy writer, the origin hostname's certificate, cutover order, header names, uptime coverage, the 5.2 hand-off, and the list of plans and docs to amend.
