# RFC: the hosted index becomes the source of entry content

Status: REVIEWED 2026-11-15 by one devils-advocate pass (24 findings across both RFCs, all applied;
summary at the end). Ready to execute. Designed together with
[the registry repository RFC](registry-repo-rfc-2026-11-15.md); this one lands first (see
"Sequencing"). Request: [feature-request-remote-first-registry-2026-11-14.md](feature-request-remote-first-registry-2026-11-14.md).
Claims about the code were checked against `main` at `4bb7749c` (v0.13.0) and against production
on 2026-11-15.

## Problem

A released CLI reads only its bundled registry. `bin.ts` builds `RemoteIndex.layer` with
`officialUrl: undefined`, and `packages/format/src/index-keys.ts::INDEX_PUBLIC_KEYS` is empty, so
without `STACKS_INDEX_URL` the index origin is off. A stack or a fix reaches users only through an
npm release, while search (which asks the API) already returns entries the CLI can't open: the
2026-11-15 `decks` case in the request.

The machinery for the index is built and switched off. `core/registry/remote.ts` merges index
entries between user and bundled roots, downloads bundles lazily, reuses a bundled copy whose files
match the index digest, pins a stack's proven fragments and falls back to the bundled composition
when a download fails. An entry that exists only in the index already resolves through
`Registry.get` for `show`, `new` and `add` once the origin is on. Production serves what the CLI
expects: `https://stacks.steamfield.io/v1/index.json` (69 entries: 43 stacks, 26 fragments, key id
`stacks-production-local`) and bundles at `v1/entries/<kind>/<id>/<digest>.json` (the `decks`
bundle returns 200).

Five things stand between that and the goal:

1. No public key ships, and production is signed with a laptop key. `stacks-api`
   `scripts/production.ts::signingKeys` generates `index-signing.pem` on first use and signs with
   the constant key id `stacks-production-local`; its `docs/operations.md` calls this interim.
2. `build:index` sets `minCli: VERSION` (`scripts/build-index.ts`), the version of the CLI that
   built it; the live index says `0.13.0`. `remote-index/verification.ts::verifyIndex` rejects an
   index whose `minCli` is above the running version. Turned on as is, each deploy built by the
   newest CLI pushes every older CLI back to its cache or bundled copy.
3. Freshness and fallback are silent. `core/cached-fetch.ts` serves a body younger than 24 hours
   with no request, sends no conditional request, and keeps the old body on failure without saying
   so. Nothing in a generated project records which content it came from.
4. Provenance can't go in the manifest. `core/manifest.ts::readManifest` decodes with
   `onExcessProperty: "error"`, so a new manifest field makes `verify` on any older CLI fail with
   `InvalidConfig` (exit 3) on every project a newer CLI writes.
5. The bundled registry is also the development registry. `scripts/dev.ts` runs `src/bin.ts`, and
   `scripts/prove.ts`, `scripts/bench` and `zero-edit.yml` run the built `dist/stacks` against the
   working `registry/`. With the official URL on in every build, `resolveReference` prefers the
   index copy whenever digests differ, so `prove` would fingerprint the local stack and scaffold the
   production one, recording a pass for content it never tested.

## Decisions

D-R1. Ship a dedicated release key and an offline backup key in `INDEX_PUBLIC_KEYS`, not the laptop
key. The release key (`stacks-index-2026a`) signs every production index from the first deploy
under it; the backup (`stacks-index-2026b`) is generated at the same time, its private half kept
offline by the maintainer, and used only to rotate. A CLI verifies nothing signed by a key it
doesn't carry, so two keys are what make a rotation possible without stranding installed CLIs.
`stacks-production-local` is not shipped; it stays in the `STACKS_INDEX_PUBLIC_KEYS` list a deploy
passes so the first deploy under the new key can verify the live index as `--previous`.

The release key's private half makes content trusted on every CLI from 0.14.0, and trusted content
reaches `verify`, which runs manifest steps. Its custody is the same class of risk as npm publish
rights: outside both repositories, never in CI until phase 5.2 designs that. `stacks-api`'s
`deploy-index.yml` holds `INDEX_SIGNING_KEY` as a CI secret; it stays disabled
(`INDEX_DEPLOY_ENABLED` unset) and R8 records that it must not be enabled with the release key.

Shipping keys has two effects beyond the index, both intended and both stated in the changelog:
`core/allowlist.ts::Allowlist.layer` stops returning `noAllowlist` once `keys` is non-empty, so
`list`, `show` and `new` start fetching the signed `v1/allowlist.json` (24-hour cache, same
deadline), and `telemetry/projects.ts` then includes allowlisted dependency names in events from a
consenting, released CLI. `production.ts::signIndex` signs every `v1` envelope, so the allowlist is
signed with the same key.

D-R2. The registry declares `minCli`. A new file at the registry root, `registry.json`, holds
`{ "formatVersion": 1, "minCli": "<x.y.z>" }`. `build:index` copies `minCli` into the index header
and fails when the file is missing or when `minCli` is above the building CLI's `VERSION` (a CLI
can't vouch for content it can't read). `validate` checks the file on a root that holds
`allowlist.json`, the marker `core/validate/deps.ts` already uses for the official registry, so user
registries are unaffected. It starts at `0.14.0`, the first CLI that reads the index. It is raised
when an entry starts using something an older CLI can't decode; entry frontmatter decodes with
`onExcessProperty: "error"` (`core/registry/entry.ts`), so any new frontmatter key is such a change.
Until the registry repository's CI checks this (registry RFC, D-G4), a CI job here does: R2 adds a
`registry-min-cli` job to `ci.yml` that runs `STACKS_REGISTRY_DIR=packages/cli/registry npx -y
@steamfield/stacks@<minCli> validate --json` when that version is on npm and skips with a notice
when it isn't (the window between bumping `minCli` and releasing it).

Per-entry `minCli` is not added. `IndexEntry.schemaVersion` already gates single entries
(`mergeIndex` skips `schemaVersion > 1`), and an index-level minimum degrades cleanly: an older CLI
keeps its cached index, whose `minCli` it met, or its bundled copy. A per-entry field is an additive
format change if one new-schema entry ever needs to ship without moving older CLIs.

D-R3. Commands that write a project revalidate; everything else keeps the 24-hour cache. `new` and
`add` call a new `RemoteIndex.refresh` before the registry is first read. Refresh sends
`If-None-Match` with the stored `ETag` (production returns `ETag` and answers a match with 304 in
about 100 ms), ignores a backoff a read command recorded, and has a 3,000 ms deadline instead of
1,500 ms. No refresh command or `--refresh` flag: write commands always revalidate.
`create --from index` is out of scope: `core/create.ts::copySnapshot` filters `defaultRoots`, which
has no index root, so it can't reach the index today (see "Known gaps").

D-R4. A fallback is reported in the result, never as an error. When refresh can't produce a fresh or
revalidated index, `new` and `add` add a warning `{ code: "index_fallback", id: "index", reason,
cachedAt? }` (`reason` one of `timeout`, `network`, `not_found`, `invalid`, `signature`,
`unsupported`, `offline`; `cachedAt` when a cached index was used). The human and agent text print
it in the stdout report beside the other warnings (`core/scaffold/report.ts`, `core/add/report.ts`),
not on stderr, because agent-mode stderr holds only failures and `Output.event` lines
(`rules/cli/cli.md`, "Three audiences"). Wording: `Index unreachable (timeout); used the cached
index from 2026-11-13 18:40 (21h old).`, `... used the registry bundled with stacks 0.14.0.`,
`Offline; used ...`, `Index signature failed; used ...`, `Index needs a newer stacks (run stacks
update); used ...`. Exit codes don't change. To tell a signature failure from other invalid
content, `verifyIndex` returns a new `signature` outcome, an additive literal on
`RemoteStatus.lastOutcome` and in `cached-fetch.ts`'s failure type.

D-R5. Provenance goes in a new committed file, `.stacks/sources.json`, not the manifest, so older
CLIs keep working (problem 4): none reads it. Shape:
`{ "formatVersion": 1, "index": { "commit", "generatedAt", "fetchedAt" } | null, "entries": [{ "kind",
"id", "origin", "digest" }] }`. `index` is set whenever an index was in effect for the command,
whichever copy each entry resolved to: when the bundled copy matches the index digest,
`resolveReference` returns the bundled entry with `origin: "bundled"`, which is the common case, and
the file still records the index commit that vouched for it. `commit` and `generatedAt` come from
`RemoteIndex.current` (the verified `RegistryIndex` carries both); `fetchedAt` is the cache's
`cachedAt` from `RemoteIndex.status`. `digest` is `bundleDigest` of the entry's files, the digest
the index uses. The schema is CLI-only (`src/schemas/sources.ts`) and moves to `packages/format`
if a second consumer appears. `project-layout.ts` owns the path and adds it to `projectFiles`, so
`new`'s `written` list and the brief's file list include it; it is committed like the manifest.
`new` writes it inside `openProject` before the manifest, so rollback removes it. `add` reads an
existing file leniently (an unreadable or newer one is replaced, never an error) and writes it with
the write-or-replace pattern of `core/add/write.ts::writeOrReplace`, because
`scaffold/write.ts::rewriteExisting` fails with `PermissionDenied` on a missing file and every
project made before 0.14.0 lacks one. An older CLI's `add` leaves the file stale; that is accepted.
The brief prints one line under the stack heading when `index` is set:
`Index a3ebf99, generated 2026-11-14 18:40.`

D-R6. `doctor` reports the index `commit`, `generatedAt`, `minCli` and stored `ETag` beside the
existing cache fields (`RemoteStatus`, additive). It does not compare every bundled entry's digest
with the index; that hashes the whole bundled registry on a per-invocation path, which AGENTS.md
"Code structure" rules out. `stacks show <id>` already prints origin and shadows for one entry.

D-R7. Search stops suggesting what the CLI can't open, without misleading a first run.
`core/search/report.ts::next` keeps `show` and `new` for an API hit unless the CLI knows it can't
get the entry: a cached index exists and lacks the id, or the last index outcome is `unsupported`.
Then the hint is `stacks update`. With no cached index (a first run, where `core/search/run.ts`
reads only names and no index is cached yet), `show` and `new` stay, because they fetch the index.

D-R8. The official URL is on only in published builds. `STACKS_RELEASE_BUILD` can't be the gate:
`scripts/build.ts` sets it to `"true"` for every bundle, including the `dist/stacks` that `prove`,
`bench` and the e2e suite run. The constant that only the release workflow's build sets is
`STACKS_PUBLISHED_TELEMETRY` (from `STACKS_PUBLISH_TELEMETRY=1` in `release.yml`), which `bin.ts`
already uses to pass the telemetry endpoint. R7 renames it to `STACKS_PUBLISHED_BUILD` (env
`STACKS_PUBLISH=1`, in `build.ts`, `release.yml`, `bin.ts`'s `declare`, and AGENTS.md's telemetry
paragraph) and gates both on it: `officialUrl: published ? new URL("v1/index.json",
DEFAULT_API_URL).href : undefined`, so the API host is named once. `bun run dev`, `prove`, `bench`,
`zero-edit.yml` and `bun run check` (whose e2e packs without the variable, in CI and in the
release workflow's `verify` job alike) keep reading the working registry, which is what they test.
Tests exercise the on state by passing `officialUrl` and keys to `RemoteIndex.layer` through
`tests/helpers/cli.ts`, as the existing remote-index tests pass a URL.

D-R9. `list` must not download the drifted registry. `commands/list.ts` reads `registry.all`, which
resolves every index entry; each whose digest differs from the bundled copy downloads its bundle
and its pinned fragments, one request at a time, each with its own deadline. The cost grows with
drift between the deployed index and the installed CLI, and MCP's `stacks_list` pays it too. R3
makes `remoteRegistry`'s `all` resolve with bounded concurrency (8) and one shared 3,000 ms budget
for the bundle downloads of one invocation, after which unresolved index entries fall back to their
bundled copy (or are listed from `IndexEntry` metadata alone, marked as not yet downloaded). This
keeps `list` within a fixed time bound on any registry size.

## Design by unit

Each unit is one delegate contract. Units in a group touch disjoint files and can run in parallel;
groups run in order.

| Unit | Group | Owns | Change |
| --- | --- | --- | --- |
| R1 Keys | 1 | `packages/format/src/index-keys.ts`, its test; `packages/cli/CHANGELOG.md` line | Two `{ keyId, publicKey }` rows (D-R1). Format version bump in its own commit, published before the CLI release. The maintainer generates both key pairs (`openssl genpkey -algorithm ed25519`) and hands over only the public PEMs; an agent never handles a private key. Tests: allowlist refresh happens on `list` once keys exist; telemetry carries dependency names only with consent and a published build |
| R2 Declared minCli | 1 | `packages/cli/registry/registry.json` (new), `scripts/build-index.ts`, a check in `core/validate/` beside `deps.ts`, `.github/workflows/ci.yml` (`registry-min-cli` job), their tests | D-R2 |
| R3 Refresh and bounded resolution | 1 | `core/cached-fetch.ts`, `core/remote-index.ts`, `core/remote-index/verification.ts`, `core/registry/remote.ts`, `schemas/remote-index.ts`, `core/doctor.ts`, their tests | `State` gains optional `etag` (`Schema.optionalKey`, so old state files decode). `requestText` sends `If-None-Match` when an ETag and a body are stored and treats 304 as success that refreshes `cachedAt` without rewriting the body; a 304 with no stored body refetches without the header within the same deadline. `makeCachedFetch` gains `revalidate({ deadline, ignoreBackoff })` returning `{ source: "fresh" \| "revalidated" \| "cached" \| "none", reason?, cachedAt? }`; `RemoteIndex.refresh` exposes it. The `signature` outcome (D-R4), the doctor fields (D-R6) and bounded `all` (D-R9) |
| R4 Write-command wiring | 2 | `commands/new.ts`, `commands/add.ts`, `core/scaffold/report.ts`, `core/add/report.ts`, `schemas/new.ts`, `schemas/add.ts`, `core/result-schemas.ts`, `packages/mcp/src/schemas/cli.ts`, MCP fixtures (`packages/mcp/scripts/capture-fixtures.ts`) | Call `refresh` before the first registry read; the `index_fallback` warning with its optional fields on both result schemas (additive) and the MCP mirror, so `e2e/schema-drift.test.ts` stays green; the report line (D-R4) |
| R5 Provenance | 3 (after R4: both touch the `new` result and the brief) | `project-layout.ts`, `schemas/sources.ts` (new), `core/scaffold/new.ts`, `core/add/write.ts`, `core/brief/render.ts`, `core/brief/text.ts`, `core/validate/budget.ts` if the file list counts, `tests/fixtures/bundled-brief-digests.ts` (regenerated the way `scripts/release.ts` does), `tests/compose-files.test.ts` and any test asserting `written`, MCP fixtures | D-R5. A project without the file is valid everywhere |
| R6 Search hint | 2 | `core/search/report.ts`, `core/search/merge.ts` if the flag is set there, tests | D-R7 |
| R7 Turn it on | 4 | `bin.ts`, `scripts/build.ts`, `.github/workflows/release.yml`, `AGENTS.md` (telemetry paragraph), `tests/helpers/cli.ts` (if the official-URL layer needs a seam), `docs/architecture.md`, `docs/concepts.md`, `docs/reference/commands.md`, `docs/reference/configuration.md` | D-R8. Docs: the index origin is on in released CLIs, trusted when signed, revalidated by `new` and `add`, how the fallback reads, and that development builds keep it off |
| R8 Production signing | after R1's format release, before the CLI tag | `stacks-api` (`scripts/production.ts`, `tests/production.test.ts`, `docs/operations.md`, `.github/workflows/deploy-index.yml`), in a session there | Sign with `stacks-index-2026a`. `signingKeys` stops generating a key when `index-signing.pem` is missing and fails instead, and fails when the key's public half isn't one of the shipped `INDEX_PUBLIC_KEYS` (read from the installed `@steamfield/stacks-format`). Every deploy passes release, backup and legacy keys as `STACKS_INDEX_PUBLIC_KEYS` to `build:index`, the container and the site build; the same list goes into the Workers Builds variables. `prod:deploy` requires `--ref` (no `origin/main` default). `deploy-index.yml`'s npm-version check for `minCli` is removed (D-R2 makes it wrong) and the workflow stays disabled |

## Acceptance

Behavior tests through `runCli`, the HTTP client faked at the boundary (`NetLayer`'s `HttpClient`,
as the existing remote-index tests do), real caches in temp directories, `TestClock` for ages:

- `new` with a cached index under 24 hours old and a server returning 200 with a newer index uses
  the newer content and writes its commit to `.stacks/sources.json`.
- `new` against a 304 makes exactly one index request, uses the cache and records the cached
  index's commit, including when every entry resolved to its matching bundled copy.
- `new` with the server timing out uses the cache and reports the fallback with its age, exits 0;
  with no cache it uses the bundled registry, says so, and `sources.json` has `index: null`.
- `new` after `list` recorded a backoff still makes its request.
- `list` within 24 hours of a fetch makes no index request; `list` against an index whose every
  entry differs from the bundled copy finishes within the D-R9 budget.
- An entry only in the index resolves for `show`, `new` and `add`; a `search` hit for it keeps
  `show` and `new` with no cached index, and gets `stacks update` when a cached index lacks it.
- An index whose `minCli` is above the running version is rejected; a cached index that meets it
  is used; the report names `stacks update`.
- A bad signature falls back with reason `signature`; an index signed with the backup key verifies.
- `--offline` makes zero requests and the reason is `offline`.
- `add` on a project made by 0.13.0 (no `sources.json`) writes the file and succeeds; `add` on a
  project whose `sources.json` is malformed replaces it and succeeds.
- An interrupted `new` leaves no `sources.json`.
- Agent-mode stderr is empty on a fallback `new` (the line is on stdout).
- `doctor --json` decodes with `RemoteStatus` and carries commit, generatedAt, minCli and ETag.
- `build:index` fails without `registry.json` and when its `minCli` exceeds `VERSION`.
- A source build (`bun run dev list --json`) makes no index request with `STACKS_INDEX_URL` unset.

Manual QA (`rules/cli/testing.md`): a published build (`STACKS_PUBLISH=1 bun run build`) running `new` and
`add` in all three audiences against production, with the network off, and with
`STACKS_INDEX_URL` pointed at a local server returning 304, 500 and a tampered signature.

## Sequencing

1. Group 1 (R1, R2, R3) in parallel; registry RFC units G2a, G2b and G2d in parallel with it,
   since they work on today's layout and the registry repository's CI needs them in a published
   CLI (registry RFC, "Sequencing").
2. Group 2 (R4, R6), then R5, then R7.
3. Publish the format package with the keys.
4. Bump to 0.14.0 (`bun run release 0.14.0`), commit, push, but don't tag yet.
5. R8, then `prod:deploy --ref <sha of the chore(release): 0.14.0 commit>`. Deploying from that
   commit is what satisfies R2's check (`VERSION` 0.14.0, `minCli` 0.14.0); a deploy from an
   earlier commit on `main` fails it. Check the live index's `keyId` is `stacks-index-2026a`.
6. Tag `v0.14.0`; the Release workflow publishes. Without step 5 first, 0.14.0 would reject the live
   index as signed by an unknown key and fall back on every `new`.

This RFC ships before the registry split. Until then the index builds from this repository at a
pinned ref (`prod:deploy --ref`), and content already ships by deploy. The request asked for the
two to land together; they share one design and one milestone, but nothing here depends on the
split, and holding 0.14.0 for it would only delay the user-visible part.

## Risks

- Every CLI from 0.14.0 trusts whatever the release key signs. Mitigations: D-R1's backup key, the
  `--previous` carry-forward and the deploy's review step in `operations.md`.
- An index deploy can break `new` for users without a CLI release. `build:index` composing every
  stack and the proof gate are the guards; production's `--include-unproven` weakens the second.
  Restoring the gate is the maintainers' call (`operations.md`, "Interim choices").
- `new` and `add` get one round trip slower (about 100 ms on a 304).
- Users on 0.13.0 or older see no change until they upgrade.

## Known gaps, deferred

- The `new`, `add` and `create` pickers (`core/prompting.ts`) and `create --from index`
  (`core/create.ts::copySnapshot`) read `defaultRoots`, which has no index root, so index-only
  entries don't appear there. Typed ids work. A follow-up gives both the remote-merged catalog.
- `verify` noting that an entry changed in the index since the project was created: cheap (compare
  `sources.json` digests with the cached index, no request) but adds output to every verify.

## Questions answered from the request

- Per-entry or per-index `minCli`: per index, declared by the registry (D-R2).
- Write-command deadline: 3,000 ms with conditional requests (D-R3).
- Does the server send `ETag`: yes, and it answers `If-None-Match` with 304.
- `verify` warning about newer content: deferred.

## Review (2026-11-15)

One `ce:devils-advocate` pass over both RFCs. Applied here: dev and proof paths keep the working
registry (D-R8, problem 5); key shipping's allowlist and telemetry effects (D-R1); the deploy has to
come from the release commit (Sequencing); `signature` outcome and warning fields (D-R4); the report
line on stdout (D-R4); `sources.json` written with write-or-replace and the index header recorded at
file level (D-R5); R5 owns the fixtures and runs after R4; `create` dropped from R4 (Known gaps);
the search hint condition (D-R7); `list`'s download cost (D-R9); the deploy script's key generation,
key list, default ref and CI workflow (R8); a `minCli` check before the split (D-R2). The rest
applied to the registry RFC.
