# Phase 4.0d: The CLI's remote origin

Status: EXECUTED 2026-10-27 (no official index URL ships yet: the origin is off unless `STACKS_INDEX_URL` is set)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | The CLI reads the signed registry index so new and updated official stacks reach users without a CLI release, shows each stack's last ledger run in `list --json`, and never lets the network slow, fail or change a command's output beyond adding fresher proven entries |
| Traces to | "Stacks don't rot" and assumption 6, "no public registry exists yet". The agent's frustration: "ambiguity", which a visible last run reduces when two stacks fit. The bundled set keeps the CLI usable offline |
| Depends on | 4.0c (a signed index and bundles at a URL), 0.3b (`src/platform/`, where platform adapters live), 1.3a (the `HttpClient` layer its probes use), D21 (proposed) |
| Blocks | 4.2b (stats use the same cached-fetch pattern), 5.2 |
| Decisions needed | D21. If declined, the default index is treated like a non-default one: every entry `trusted: false` |
| Settles | Where the remote origin sits in precedence, when it refreshes, how it fails, how signatures and digests are checked, and how an index stack is composed |

## Scope

In:

- A `RemoteIndex` service with a disk cache, a bounded refresh, failure backoff, signature verification and bundle digest checks.
- The `"index"` origin in the 1.0 registry loader.
- `--offline` on every command and `STACKS_OFFLINE=1`; `STACKS_INDEX_URL` to read another index.
- Index-provided `lastRun` in `list --json` and `show --json`.
- `doctor` reporting cache age and last outcome.

Out:

- Stats (4.2b) and telemetry (4.1a).
- Any network use in `verify`.
- Background refresh processes.

## Design

### Where this fits

4.0c publishes the index; this sub-phase is its only reader in the CLI. 4.2b later fetches stats with the same cache, deadline and backoff rules described here, so the rules are written once in this file and cited there.

### Behavior

`list`, `show`, `new` and `add` call `RemoteIndex.current`. It returns the cached index when it is younger than 24 hours. Older, it tries one refresh with a 1,500 ms deadline and returns the fresh index, the stale cache, or nothing. Nothing means the loader skips the origin, exactly as in the MVP. No command fails because of the index.

After a failed refresh the next attempt waits 10 minutes; after a 404, 24 hours. The backoff state lives beside the cache.

### Verification, in order

1. Decode the body as `SignedIndex` (4.0c). Failure: `lastOutcome: "invalid"`.
2. Default URL: verify `signature` over the UTF-8 bytes of `payload` with the key in `INDEX_PUBLIC_KEYS` matching `keyId`, using Web Crypto Ed25519 (available on Node 24 and Bun without a platform import). Unknown key or bad signature: `"invalid"`, the index is ignored, the cache keeps the previous good one. Trust model point 7 ([roadmap, Trust model](../../roadmap.md#trust-model)).
3. Decode `{ formatVersion, minCli }` from the payload before the full schema. A higher `formatVersion`, or a `minCli` newer than the running CLI (plain `major.minor.patch` compare, no new dependency): `lastOutcome: "unsupported"`, ignored, bundled set used (roadmap, [Contracts: Schema versions](../../roadmap.md#schema-versions), Registry index row).
4. Decode the full `RegistryIndex`. Failure: `"invalid"`.
5. Only then write the envelope to the cache (temp file and rename). The cached envelope is verified again on every read; it's cheap, and it means one code path decides what an index is.

Entries whose `schemaVersion` is newer than the CLI supports are skipped individually and the next origin's copy is used.

### Bundles

When the loader needs an index entry that isn't cached, `RemoteIndex.bundle` checks that `id` matches `EntryId` and `digest` is `sha256:` followed by 64 hex characters before building a URL (the index is signed, but a URL is never built from an unchecked string), fetches `v1/entries/<kind>/<id>/<digest>.json` under the same deadline and backoff, decodes it as `EntryBundle` (whose `BundlePath` rejects traversal, 4.0a), checks `bundleDigest` against the index digest, and extracts it to `entries/<digest>/` through a temporary directory and rename. A mismatch discards it and the bundled copy of that id is used, with one warning on stderr in human mode and none in `--json`.

### Composing an index stack

An index stack's default fragments come from its `composition` map: fragment id to the digest that passed with it (4.0c). The loader fetches those exact fragment bundles, not the newest fragment entries. If any of them can't be fetched or verified, the whole stack falls back to its bundled copy with its bundled fragments, because mixing an index stack with bundled fragments is a composition nobody ran. `--with` an optional fragment uses that fragment's own index entry, or its bundled copy.

### Precedence, identity and trust

`Origin` gains `"index"`, which the roadmap's [Entry and its listing](../../roadmap.md#types-and-schemas) contract already lists as added here; if this sub-phase changes that contract in any other way, it updates the roadmap row in the same change. Order, highest first: project, user, index, bundled, then source (the roadmap's Entry contract: sources rank below every other origin). When the index and bundled copies of an id have the same `bundleDigest` (both computed with `canonicalBundle` from `packages/format`, roadmap Contracts: Canonical bundle), the entry reports `origin: "bundled"`.

Trust model point 2: entries from the default URL with a verified signature are `trusted: true`. When `STACKS_INDEX_URL` is set to anything else, the signature step is skipped and every entry from it is `trusted: false`, so a test or self-hosted index never becomes trusted silently; point 3 then applies (no auto-launch, stop-and-confirm brief). `STACKS_INDEX_URL` must be `https:`, or `http:` on `127.0.0.1` or `localhost` (for tests).

The remote origin adds and updates entries; it never removes a bundled one. Withdrawing a stack is a CLI release.

### Interfaces

```ts
// packages/cli/src/core/remote-index.ts
export class RemoteIndex extends Context.Service<RemoteIndex, {
  readonly current: Effect.Effect<Option.Option<VerifiedIndex>>;                    // never fails
  readonly bundle: (entry: IndexEntry) => Effect.Effect<Option.Option<string>>;     // extracted dir; never fails
  readonly status: Effect.Effect<RemoteStatus>;                                    // for doctor
}>()("stacks/RemoteIndex") {
  static layer: (keys: typeof INDEX_PUBLIC_KEYS) =>
    Layer.Layer<RemoteIndex, never, FileSystem.FileSystem | Path.Path | HttpClient.HttpClient | AppConfig>;
  static disabled: Layer.Layer<RemoteIndex>;   // --offline
}

export type RemoteStatus = {
  url: string; isDefaultUrl: boolean; offline: boolean;
  cachedAt: string | null; lastAttempt: string | null;
  lastOutcome: "ok" | "timeout" | "network" | "not_found" | "invalid" | "unsupported" | null;
  backoffUntil: string | null;
};
```

`bin.ts` passes `INDEX_PUBLIC_KEYS`; the test helper passes the test key from 4.0c's fixtures. No env variable can supply a key. `HttpClient` comes from `effect/http`; its Node layer is the one 1.3a's HTTP probe already uses, provided by `bin.ts` from an adapter in `src/platform/` (the directory and its Grit boundary are 0.3b's). This sub-phase adds no new platform import. `AppConfig` gains `indexUrl` and `offline`, read only in `config.ts`.

Cache under `$XDG_CACHE_HOME/stacks/index/`:

| Path | Holds |
|---|---|
| `index.json` | Last verified `SignedIndex` |
| `state.json` | `{ url, cachedAt, lastAttempt, lastOutcome, backoffUntil }` |
| `entries/<digest>/` | Extracted, verified bundles |

A cache written for a different URL is ignored.

### Output changes

`list --json` items keep 2.0c's `lastRun` shape; for an index entry the value comes from the index's `lastRun`. `origin` may be `"index"`. Human `list` prints `proven <date>` or `unproven`. `doctor --json` gains `remoteIndex: RemoteStatus`.

### Failure modes

| Case | Effect on the command |
|---|---|
| Network down, DNS failure, timeout | None. Stale cache or bundled; backoff recorded |
| 404 | None. 24-hour backoff |
| Bad signature, unknown key, bad JSON | Ignored, `lastOutcome: "invalid"`, previous good cache kept |
| Newer `formatVersion` or `minCli` | Ignored, `lastOutcome: "unsupported"` |
| Bundle digest mismatch | Bundled copy used; one human-mode warning |
| One of a stack's `composition` bundles unavailable | Whole stack from the bundled set |
| Cache directory not writable | Works from memory for this run |
| `--offline` | No network call; a cached index is still used |

### Decided here

- Inline, bounded refresh, not a background process: a daemon or detached child is more machinery than a 1.5-second deadline once a day.
- Non-default URLs skip the signature check rather than require it: they are untrusted anyway, and requiring the official key would make self-hosted indexes impossible.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/core/remote-index.ts` | New service |
| `packages/cli/src/core/registry/` | `"index"` origin, same-digest rule, composition-pinned defaults |
| `packages/cli/src/config.ts` | `STACKS_INDEX_URL`, `STACKS_OFFLINE`, `--offline` |
| `packages/cli/src/bin.ts` | Pass the key list; provide `RemoteIndex` with the existing `HttpClient` layer from `src/platform/` |
| `packages/cli/src/commands/list.ts`, `show.ts`, `doctor.ts`, `src/schemas/doctor.ts` | `lastRun` source, `remoteIndex` |
| `packages/cli/tests/remote-index.test.ts`, `e2e/` | New |
| `packages/cli/README.md`, `AGENTS.md` | Remote origin, `--offline`, cache, trust rule |

## Acceptance tests

Every network test runs a real local HTTP server serving fixtures built by 4.0c's script with the test key, with handlers that can delay, 404, return bad JSON, a bad signature or a wrong digest.

1. Fresh cache, server up: `list --json` includes an index-only stack with `origin: "index"`, `trusted: true` (default-URL path, test key) and its `lastRun`.
2. Payload changed by one byte after signing: ignored, `lastOutcome: "invalid"`, bundled entries listed.
3. `formatVersion: 2` or `minCli: "99.0.0"`: ignored, `lastOutcome: "unsupported"`.
4. Server delays 5 s: `list` returns in under 2.5 s; a second `list` within 10 minutes makes no request (server counter).
5. 404: no request for 24 hours of TestClock time; then one.
6. Same digest remote and bundled: `origin: "bundled"`.
7. Wrong bundle digest: bundled copy used; `--json` stdout identical to the offline run.
8. An index entry with id `Bad_Id` or digest `%2e%2e`: no request made for it, entry skipped.
9. A bundle with a `../` path fails decoding and is not extracted.
10. `new` with an index stack composes the fragment digests from `composition`, not newer fragment entries in the same index; with one composition bundle missing, the whole stack is the bundled one.
11. `STACKS_INDEX_URL` to the local server: entries `trusted: false`; `new` with a fake agent on PATH prints instead of launching.
12. `--offline`: zero requests. `verify` with a stale cache: zero requests.
13. e2e: the packed tarball under Node lists an index-only stack from the local server.

### Realistic edge cases

14. A corrupted cached envelope is verified again offline and cannot override a bundled entry.
15. A symlinked cache home, spaces and non-ASCII path names work with real filesystem paths.
16. A file blocking cache creation does not prevent using the verified index in memory or overwrite that file.
17. A cache written for another index URL is ignored, including offline.
18. A newer entry schema skips only that entry, allowing supported index entries and bundled fallbacks.
19. A network failure retains a stale verified cache and records failure backoff.
20. Project and user entries shadow index entries, and bundled-only entries are never removed.
21. An interrupted bundle download preserves the verified index and unrelated cached entries, leaving no partial extraction.

## Exit criteria

- Acceptance tests pass; `bun run check` green from the repo root.
- Against the live index deployed in 4.0c and 4.0e, `npx stacks@latest list --json` shows `lastRun` for every indexed stack and `doctor --json` shows `lastOutcome: "ok"`.
- The CLI README documents the remote origin, `--offline`, the cache and the trust rule.

## What this plan may get wrong

- 2026-10-27: request backoff must distinguish bundle URLs. A missing composition bundle falls back that stack without suppressing unrelated optional fragments; the persisted state also holds per-request deadlines. The locked optional-add test currently removes bundled `extra` although the built index does not advertise `extra` or its digest, so that assertion cannot be satisfied by a checked fetch. A separate test advertises the optional fragment explicitly.
- 2026-10-27: offline mode keeps the same service and disables its HTTP reads so verified cache data remains usable; it does not need a separate disabled layer. Only list/show/new/add opt into remote resolution; local validation and authoring stay local. Show's preview hint for an index stack therefore uses `new --dry-run`.
- 2026-10-27: single-entry commands need a metadata-only registry catalog and lazy bundle resolution, or unrelated bundle deadlines accumulate. Supported historical pins must resolve independently of a newer unsupported fragment entry. Bundled fallback pins only the required/default dependency closure, so optional additions still use their own winning origin; bundled proof comparisons explicitly disable index resolution.
- 2026-10-27: maintainers decided the CLI ships with no official index URL until its real host exists. `bin.ts` supplies `officialUrl: undefined` alongside the empty production key list; config reads only `STACKS_INDEX_URL`, with no default. `RemoteIndex.layer({ keys, officialUrl })` uses the environment URL first, then the supplied official URL; with neither it makes no requests and reports `url: null`, `isDefaultUrl: false`. Tests supply a fixed fixture official URL to retain signature verification coverage.

- 2026-10-27: the plan ranked sources above the index, against the roadmap's Entry contract (sources rank below every other origin); the order now follows the contract. Sources don't exist yet (3.2a), so the tests cover project, user, index and bundled. Index digests are `sha256:<hex>` as 4.0c writes them (`bundleDigest`), not bare hex, and that full string is the bundle's filename.
- 1.5 seconds once a day may still show up in agents running `list` in a loop on a slow network. The backoff caps it; if run notes show it, let only `new` refresh.
- Same-digest detection depends on 4.0c and the CLI computing `bundleDigest` from the same file names (dotfiles are literal in both). If the bundled registry is ever packed differently (0.2), every entry will report `origin: "index"`; the "same digest" test catches it.
- A compiled-in key means a lost key needs a CLI release before the index can change again (4.0c).
