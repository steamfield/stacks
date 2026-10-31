# Phase 4.2d: Dependency telemetry, client and ingest

Status: EXECUTED 2026-10-28 (D25 decided; the allowlist review and the production rerun are the maintainers' steps)

| Field | Value |
|---|---|
| Goal | If the maintainers agree (D25, on top of D17), a green `verify` reports which well-known dependencies the project ended up with and at which major version, limited to a signed allowlist of public package names served at `GET /v1/allowlist`, under telemetry `schemaVersion: 2` with version 1 frozen; the CLI reads the project's manifest and lock files and executes nothing; ingest checks every name against the allowlist again and keeps a per-project dependency history that survives the 90-day prune |
| Traces to | Assumption 2, "version-less prose rots much more slowly than versioned templates": which major versions agents install today, per stack, is the evidence that prose is still current when the versions under it move. "Agents own what ages (versions, generator flags, config formats)" made observable. "None of these are collected today" |
| Depends on | 4.1e (collection live and its launch procedure, which this sub-phase reruns for the new field), 4.1d (the recheck step this extends), 4.1a (the event schema, its snapshot rule and the notice), 4.1b (ingest), 4.1c (the prune step this extends), 4.0c (the build that signs the allowlist), 4.0d (the cached-fetch rules), 4.2b (`AppConfig.apiUrl`), 3.0 (`smol-toml` in the root catalog), D17, D25 |
| Blocks | 4.2e |
| Decisions needed | D25 (dependency telemetry, allowlist-only, proposed in [requirements](../../requirements.md#proposed-decisions)). D17. If either is declined, this sub-phase and 4.2e are skipped and nothing here is built |
| Settles | What a dependency report contains and when it is sent; the allowlist's source, format and signing; the second notice; `schemaVersion: 2`; the dependency tables and their write-time rules |

## Scope

In:

- `packages/format::DependencyAllowlist` and a signed `v1/allowlist.json` written by 4.0c's build script, served at `GET /v1/allowlist`.
- A `Dependencies` reader in the CLI: root manifest and lock files for npm, Python, Go and Rust projects, read only.
- `TelemetryEvent` `schemaVersion: 2`: an optional `deps` field on `verify`, and a frozen v1 snapshot.
- A second first-run notice for the new field, and the README and `/telemetry` page text.
- Ingest of v2, an `event_deps` table and a `project_deps` history table, and 4.1d's recheck step rebuilding `project_deps`.

Out:

- Rollups, pages and transitions (4.2e).
- Any dependency not on the allowlist, any version detail finer than the major, any dependency count that would reveal unlisted ones.
- Workspace members and nested packages: only the project root's files are read.
- Running any package manager or tool to resolve versions (D2).

## Design

### Where this fits

4.1a sends what a project was built from (stack and fragments) and how verify went. This adds what the agent installed, which is the half of a project stacks deliberately doesn't write. 4.2e turns it into per-stack and per-dependency numbers. Nothing in this sub-phase publishes anything.

### The allowlist

```ts
// packages/format/src/allowlist.ts
export const Ecosystem = Schema.Literals(["npm", "pypi", "go", "crates"]);
export const DependencyAllowlist = Schema.Struct({
  formatVersion: Schema.Literal(1), generatedAt: Schema.String,
  names: Schema.Record(Ecosystem, Schema.Array(Schema.String)),   // sorted, unique per ecosystem
});
```

The source is `packages/cli/registry/allowlist.json`, edited by the maintainers, which lists names per ecosystem. The bundled entries' `deps` frontmatter (1.0) maps a role to package names with no ecosystem, so the build can't place those names itself; instead it fails when a name in any bundled entry's `deps` appears in no ecosystem's list, naming the entry and the name, so the maintainers add it to the right ecosystem in the same change. A name is allowed only if it is a public package on that ecosystem's public registry; the build doesn't check that over the network, so the rule is a review rule, written at the top of the file. The build signs the allowlist with the index key and the same envelope as the index (trust model point 7, [roadmap, Trust model](../../roadmap.md#trust-model)), and writes `v1/allowlist.json`. `GET /v1/allowlist` is a Worker route that returns that asset with `Cache-Control: public, max-age=3600`.

The signature matters: the allowlist decides which names the CLI is willing to report. An unsigned list served by a compromised host could add a private package name and learn which projects use it. A list whose signature fails is ignored, and the CLI sends no `deps`.

### When the CLI reads and sends

The allowlist is fetched by `src/core/allowlist.ts` with 4.0d's cached-fetch rules (24-hour TTL, deadline, backoff, nothing under `--offline`), cached as `$XDG_CACHE_HOME/stacks/allowlist.json` with `allowlist.state.json` beside it, and refreshed only where 4.0d refreshes the index, never during `verify`. Only the allowlist from `AppConfig.apiUrl` (4.2b's seam; tests point it at a local server) is used.

`deps` is added to a `verify` event when all of these hold: consent is `enabled` (4.1a's table), the second notice has been shown (below), the run's outcome is `green`, a cached allowlist verifies, the project has a telemetry project file, and either the project has never sent `deps` or its last `deps` was sent at least 7 days ago (`depsSentAt` in 4.1a's `projects/<projectKey>.json`). The repeat lets 4.2e see a project change its dependencies over time; the 7-day spacing keeps the volume to a few reports per project.

### What is read

| Ecosystem | Names from | Major from |
|---|---|---|
| npm | `package.json` `dependencies` and `devDependencies` | `node_modules/<name>/package.json` `version` |
| pypi | `pyproject.toml` `[project] dependencies` and `[tool.poetry.dependencies]`, names normalized per PEP 503 | `uv.lock` or `poetry.lock` package entries |
| go | `go.mod` `require` lines, with a trailing `/vN` major-version suffix stripped from the module path before the allowlist match (`github.com/a/b/v2` matches `github.com/a/b`) | The version on the same line (`v2.3.1` gives `"2"`), never the suffix |
| crates | `Cargo.toml` `[dependencies]` and `[dev-dependencies]` | `Cargo.lock` package entries |

Each report is `deps: [{ ecosystem, name, major }]`, sorted, at most 100 entries, with only names on the allowlist. `major` is the major version as a string (`"5"`), or `"0.<minor>"` for a 0.x version, since a 0.x minor is a breaking change; `null` when the installed version can't be found. Files are read through Effect `FileSystem` with a size limit of 2 MB each, a file that fails to parse is skipped, and a symlink that resolves outside the project is not followed. Nothing is executed (trust model point 1).

TOML needs a parser, which neither the standard library nor Effect has: the reader uses `smol-toml`, which 3.0 adds once to the root catalog (roadmap, Other shared facts: New dependencies), depended on with `catalog:`.

### Schema version 2

`TelemetryEvent` gains `schemaVersion: 2`, identical to version 1 except the optional `deps` on `verify`. Version 1's JSON Schema snapshot (4.1a's frozen-schema rule) is not touched, and the test that compares the export of each released version with its snapshot covers both. The CLI sends version 2 from the release that ships this; ingest keeps the version 1 validator (4.1b: validators for released versions are never removed).

### The second notice

`deps` is data read from the project's files, which 4.1a's never-sent list and Out list excluded. Adding it is a new consent question (4.1a: "a field that breaks it is a new consent question"), which D25 answers for the product, and every user is told again: `notice.json` gains `noticeVersion`, and a run where consent is `enabled` and `noticeVersion` is below 2 shows the new notice (what dependency names and majors are sent, the allowlist link, the off switch) and adds no `deps` on that run. Users who turned telemetry off see nothing and send nothing. The never-sent list in the README and on `/telemetry` changes in the same release: "file contents, except allowlisted dependency names and major versions from manifest and lock files".

### Ingest

The Worker reads the allowlist through 4.1c's `IndexAssets` service: it loads `v1/allowlist.json` from the assets binding, verifies its signature with `INDEX_PUBLIC_KEYS` as the CLI does, and caches the decoded list per isolate. If the file is missing or its signature fails, every `deps` entry is dropped. 4.1b's per-event handling gains one step for v2 `verify` events: drop every `deps` entry whose name isn't on that allowlist (the server's own check; a modified client can't add names) or whose `major` doesn't match `^(0\.)?\d+$`, then store.

| Table | Columns |
|---|---|
| `event_deps` | (`event_id`, `ecosystem`, `name`) PK, `major` |
| `project_deps` | (`install_id`, `project_id`, `ecosystem`, `name`, `major`) PK, `first_seen_day`, `last_seen_day` |

`event_deps` follows `events`: 4.1c's verified prune step in `stacks-api/apps/api/src/maintenance/maintain.ts` gains a delete of the `event_deps` rows whose `event_id` it prunes, in the same batch, and the rows are archived inside the event's payload by 4.1c's archive step. `project_deps` is the long-lived history: a new row when a (project, dependency) appears with a major it hasn't had, `last_seen_day` updated on later reports. It holds no network hash, the same rule as `projects`. Each event's `event_deps` and `project_deps` writes join 4.1b's per-event D1 batch, so they share its retry guard.

The write-time rule is 4.1b's: an event stored with any `excluded` value writes `event_deps` (the raw record) but never touches `project_deps`. 4.1d's recheck step, for each queued (install, project) pair, rebuilds that pair's `project_deps` from its non-excluded raw events in the same pass that rebuilds `projects`, while raw events exist; after 90 days the history is final.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/format/src/allowlist.ts`, `src/telemetry.ts` | `DependencyAllowlist`; `schemaVersion: 2` (additive) |
| `packages/format/schemas/telemetry-event.v2.json` | Frozen snapshot for version 2 once released |
| `packages/cli/registry/allowlist.json` | New, with the review rule at the top |
| `packages/cli/scripts/build-index.ts` | Build and sign `v1/allowlist.json`; fail on a bundled `deps` name in no ecosystem |
| `packages/cli/src/telemetry/deps.ts`, `events.ts`, `ids.ts` | Reader, `deps` on verify, `depsSentAt`, `noticeVersion` |
| `packages/cli/src/core/allowlist.ts` | Allowlist fetch beside 4.0d's index refresh (`src/core/remote-index.ts`), reusing its fetch rules |
| `stacks-api/apps/api/src/handlers/allowlist.ts`, `stacks-api/packages/contract/src/api.ts` | `GET /v1/allowlist` |
| `stacks-api/apps/api/src/ingest/deps.ts`, `src/store/` | v2 handling and tables; the verified allowlist read through 4.1c's `IndexAssets` |
| `stacks-api/apps/api/src/maintenance/maintain.ts` | `event_deps` delete in the prune step |
| `stacks-api/apps/api/src/integrity/recheck.ts` (4.1d), `src/store/projects.ts` | Rebuild `project_deps` for queued pairs beside the `projects` rebuild |
| `stacks-api/apps/api/migrations/` | `event_deps`, `project_deps` |
| `stacks-api/apps/web/src/pages/telemetry.astro`, `packages/cli/README.md` | The new field and the changed never-sent line |
| Tests in all three packages | New |

## Acceptance tests

1. Fixture projects for each ecosystem: the reader returns exactly the allowlisted names with the expected majors; a 0.x package gives `"0.<minor>"`; a missing `node_modules` entry gives `major: null`; a non-allowlisted dependency appears nowhere in the serialized event (property test over random package names).
2. A `go.mod` requiring `github.com/a/b/v2 v2.3.1` with `github.com/a/b` allowlisted reports major `"2"`; a Poetry project's `[tool.poetry.dependencies]` names are read.
3. The build fails on a bundled entry whose `deps` names a package in no ecosystem of `allowlist.json`.
4. Ingest with an allowlist asset whose signature fails stores `verify` events with every `deps` entry dropped. 4.1c's prune of an event deletes its `event_deps` rows.
5. A symlinked `package.json` pointing outside the project is not read; a 3 MB lock file is skipped.
6. No process is spawned while reading (the test's `Processes` fake records zero calls).
7. An allowlist with a bad signature: no `deps` sent, verify output unchanged.
8. First green verify sends `deps`; a second green verify the next day doesn't; one 8 days later does. A failed verify never does.
9. A user notified under version 1: the next enabled run shows the new notice and sends no `deps`; the run after sends them. With `DO_NOT_TRACK=1`, no notice and nothing sent.
10. `verify --json` stdout and exit code are byte-identical with and without the reader, and `verify` makes no allowlist request.
11. Ingest: a v2 event with an unlisted name stores the event without that entry; a v1 event still validates; the v1 snapshot test passes unchanged.
12. Posting the same v2 event twice leaves `project_deps` unchanged. An excluded event writes no `project_deps` row; after 4.1d excludes an install and rechecks, that install's `project_deps` rows are gone.
13. A project reporting `react` major 18 and later 19 has two `project_deps` rows with ordered `first_seen_day`.

This repository tests 1-3 and 5-10, and the v1 snapshot half of 11 (`packages/format`); `stacks-api` tests 4, 11 and 12-13. The plan carries no `Acceptance tests: traced` line, as 4.5e doesn't, because the trace check sees one repository.

## Exit criteria

- D25 and D17 decided. Acceptance tests pass; `bun run check` green from this repository's root and in `stacks-api`.
- The README, `/telemetry` and the notice text describe the field exactly as implemented.
- 4.1e's production acceptance steps rerun for the release that turns `deps` on, including a debug-output check that only allowlisted names leave the machine.

## What this plan may get wrong

- Reading `node_modules` for npm majors depends on the project being installed, which a green verify implies but a stack using Yarn Plug'n'Play would break. Those projects send `major: null`; read the lock file if it matters.
- Only root files are read, so a monorepo stack reports only its root. If a bundled stack is a workspace, the reader needs its member list, which is a bounded extension.
- An allowlist curated by hand drifts. Adding every name the bundled entries mention keeps the important ones in; anything else is a maintainer's choice, reviewed like code.
- A second notice may cost users who turn telemetry off when they see it. That is the right cost for a new kind of data.
- 2026-10-28 (execution): D25 is decided. Three corrections. First, the roadmap's "Dependency allowlist" contract owns the serving rule: `v1/allowlist.json` is a signed static file in the index tree beside `v1/names.json`, with no `GET /v1/allowlist` route; read "served at `GET /v1/allowlist`" as that file, and the site's `read-deps.ts` moves to it. Second, "refreshed only where 4.0d refreshes the index" never fires without `STACKS_INDEX_URL`, while the allowlist comes from `AppConfig.apiUrl`; the CLI refreshes it, through the cached-fetch module 4.0d's index and 4.2b's stats share, on the commands that fetch stats (`list`, `show`) and on `new`, never during `verify`. With `INDEX_PUBLIC_KEYS` still empty, no allowlist verifies outside tests, so nothing is sent until the maintainers add the key. Third, on the Node host (amended D16) "the per-event D1 batch" is 4.1b's per-event SQLite transaction, and `TelemetryEvent` stays the v1 export while v2 is exported beside it (`TELEMETRY_SCHEMA_VERSION` stays 1 until the client sends v2), both in `@steamfield/stacks-format` 0.3.0. Acceptance tests are numbered from this date.
- 2026-10-28 (execution): ingest's `^(0\.)?\d+$` rule applies to a string `major`; a `null` major (the reader couldn't find the installed version) is kept, stored as `NULL` in `event_deps` and as `''` in `project_deps`, whose primary key includes `major` (migration 0006). The second notice's "allowlist link" is the `/telemetry` page on the endpoint's host, as the first notice links it; that page lists the allowlisted names (unit A10), and the signed `v1/allowlist.json` is no page for a person.
- 2026-10-28 (landed): the CLI half is on `main`. `core/deps.ts` reads npm, Go, PyPI and crates manifests and locks (nothing executed); `core/allowlist.ts` fetches and verifies the signed allowlist through the shared cached fetch, and skips the request entirely while `INDEX_PUBLIC_KEYS` is empty, since nothing could verify; the index build signs `registry/allowlist.json` beside `v1/names.json`; telemetry sends v2 `deps` on a green verify with `depsSentAt`, `noticeVersion` and the second notice. Ingest, prune and recheck (stacks-api) remain.
- 2026-10-28 (landed, stacks-api): ingest accepts v1 and v2 events, verifies the allowlist through `IndexAssets.allowlist` and keeps only allowlisted names in `event_deps` and `project_deps`; the prune deletes `event_deps` with their events and the recheck rebuilds `project_deps`. The `/telemetry` privacy page lists the allowlist under Dependencies. No `/v1/allowlist` route exists: the API, the CLI and the site read the static `v1/allowlist.json`. The development seed doesn't send v2 events yet (unit A9).
