# Phase 4.0c: Registry index

Status: EXECUTED 2026-10-27 in both repositories (the `stacks-api` serving test and by-hand deploy procedure landed there)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | A maintainer can build, sign and deploy by hand a static, content-addressed registry index of official stacks whose compositions passed a ledger run, each stack carrying its last ledger run and the fragment digests that passed, served as static assets with cache headers from host config |
| Traces to | "Stacks don't rot: A stack that passed last month still passes this month without a prose change." Assumption 6: "no public registry exists yet". The agent's frustration with "ambiguity", which a visible last run reduces when two stacks fit |
| Depends on | 4.0b (the host and its static assets directory), 4.0a (`canonicalBundle`, `bundleDigest`, `EntryBundle`), 2.0a (`composeFiles`, `fingerprint`), 2.0c (`LedgerRecord` and the ledger reader), 2.2 ("changed since last green" uses the same fingerprint match), D21 (signed index), open question 14 (proven-only serving) |
| Blocks | 4.0d, 4.0e (the official-names file and directory pages extend this build), 5.2 |
| Decisions needed | None: D21 (signed) and open question 14 (proven only, with carry-forward) were decided 2026-10-27 |
| Settles | The index and envelope format; which content the index serves; how unproven content is handled; the build command and how it signs; key handling in phase 4 |

## Scope

In:

- `packages/cli/scripts/build-index.ts`: validate, prove, carry forward, write bundles, sign, check.
- `RegistryIndex`, `IndexEntry`, `LastRun` and `SignedIndex` schemas added to `packages/format` (additive).
- The index public key list committed to `packages/format`.
- A `_headers` file giving cache lifetimes for `v1/`, and the maintainer's by-hand deploy procedure in `stacks-api/apps/api/README.md`.

Out:

- The official-names file `v1/names.json` and the static directory pages (4.0e, which extends this build).
- Any API route for the index or bundles: they are static files.
- Third-party or community entries; the index serves the official registry only.
- A CI build, CI signing or CI deploy. Those are 5.2 ([phase-5.2-ci-index-build-and-deploy.md](../../phases/phase-5.2-ci-index-build-and-deploy.md)).
- The CLI side (4.0d).

## Design

### Where this fits

4.0b configured a host that serves a static directory assembled at deploy time. This sub-phase builds the `v1/` files that go into it. 4.0d teaches the CLI to read and verify what this writes. [4.0e](phase-4.0e-official-names-and-directory-2026-10-30.md) adds the official-names file and the directory pages to the same build, and [4.2d](phase-4.2d-dependency-telemetry-client-and-ingest-2026-10-30.md) adds the dependency allowlist; both are signed by the same step described here. 5.2 runs the same script in CI with the key as a deploy secret.

### Why the build lives in the CLI package

Every input is CLI code: the bundled registry, `validate`, `composeFiles`, `fingerprint`, the ledger reader. Moving them to `packages/format` to let `stacks-api` run the build would turn 4.0a into a large extraction for one script. The script writes to an `--out` directory; the API package only serves what's there. No package imports another's `src/`.

### Which content the index serves (open question 14)

A stack is proven at its current content when a `LedgerRecord` exists (see roadmap, Contracts: Ledger) whose `fingerprint` equals the fingerprint of the stack composed today with its default fragments, and whose run meets the gate bar: `result: "pass"`, zero `interventions`, and `tamperCheck: "full"` on the wrapped `RunRecord` (the D20 bar, so "proven" means the same thing in the gate and the index).

For each official stack, the build does one of three things:

| Case | Index entry |
|---|---|
| Current content proven | New entry: the stack's current bundle digest, `composition` mapping each default fragment id to its current bundle digest, `lastRun` from the newest matching ledger record |
| Not proven, and the previous published index has the stack | The previous entry carried forward unchanged, with its old `composition` and `lastRun`; its bundles are copied into the new output |
| Not proven, never published | Omitted. The CLI keeps using its bundled copy |

`composition` is what makes this safe: without it, a newer fragment could be combined with a proven stack, publishing a composition nobody ran. 4.0d composes an index stack's defaults from exactly those digests.

Fragments appear in the index only as the bundles named by some stack's `composition`, plus optional fragments whose current digest appears in a ledger record that proves a composition including them (the ledger stores stack and fragment ids, so the build composes the record's ids from today's content and checks the fingerprint). An optional fragment never proven stays bundle-only.

Carry-forward needs the previous output. The build takes `--previous <url>`, the live index URL (`https://<host>/v1/index.json`), fetches and verifies the live `SignedIndex` with the committed public keys, downloads each carried-forward bundle and checks `bundleDigest`. A mismatch fails the build. The first build passes `--previous none`.

### Format

```ts
// packages/format/src/index-schema.ts (shape)
export const LastRun = Schema.Struct({            // projection of LedgerRecord, not a new record
  date: Schema.String, result: Schema.Literal("pass"), agent: DetectedAgent, preset: Schema.String,
  minutesToGreen: Schema.NullOr(Schema.Number), fingerprint: Digest,
});
export const IndexEntry = Schema.Struct({
  id: EntryId, kind: Schema.Literals(["stack", "fragment"]),
  schemaVersion: Schema.Int,                         // the entry's own, per Schema versions
  name: Schema.String, description: Schema.String, tags: Schema.Array(Schema.String),
  digest: Digest,                                    // bundleDigest of this entry's bundle
  composition: Schema.optional(Schema.Record(EntryId, Digest)), // stacks only, required for stacks
  lastRun: Schema.optional(LastRun),                 // stacks only
});
export const RegistryIndex = Schema.Struct({
  formatVersion: Schema.Literal(1), minCli: Schema.String,
  generatedAt: Schema.String, commit: Schema.String, entries: Schema.Array(IndexEntry),
});
export const SignedIndex = Schema.Struct({
  keyId: Schema.String, signature: Schema.String,    // base64 Ed25519 over the UTF-8 bytes of payload
  payload: Schema.String,                            // the signed document's JSON text
});
export const INDEX_PUBLIC_KEYS: ReadonlyArray<{ keyId: string; publicKey: string }>;
```

`LastRun.agent` is `DetectedAgent` (roadmap, [Contracts: Types and schemas](../../roadmap.md#types-and-schemas)), so a ledger record whose agent is `"other"` or `"none"` projects without loss. The proof bar above doesn't look at the agent, so such a record can prove a stack, and the directory shows the agent as recorded.

`formatVersion` and `minCli` follow roadmap, [Contracts: Schema versions](../../roadmap.md#schema-versions) (Registry index row). `lastRun` uses the same fields 2.0c puts in `list --json`, so the CLI shows the same shape whichever origin answered.

The signature and the index are one file, `v1/index.json`, holding a `SignedIndex`. A detached signature file would be cached separately and, for up to the cache lifetime, could disagree with the index it signs, which 4.0d would report as `invalid`. Signing the exact payload bytes means no JSON canonicalization is needed for the index itself; bundles use `canonicalBundle` (roadmap, Contracts: Canonical bundle). The same `SignedIndex` envelope wraps every signed file the build writes: `v1/index.json` here, `v1/names.json` (4.0e) and `v1/allowlist.json` (4.2d).

### Output

```
<out>/
  _headers
  v1/index.json                                  SignedIndex
  v1/entries/<kind>/<id>/<digest>.json           EntryBundle, one per published digest
```

4.0e adds `v1/names.json` and the directory pages to this tree.

`_headers` (host config, read by the static assets layer, not by code):

| Path | Cache-Control |
|---|---|
| `/v1/index.json` | `public, max-age=300, stale-while-revalidate=3600` |
| `/v1/entries/*` | `public, max-age=31536000, immutable` (the URL contains the digest) |

The build writes into a temporary directory and renames it over `--out` only after every step succeeds, so a failed build leaves the previous output intact.

### The build command and signing (D21)

```
bun run --cwd packages/cli build:index -- --out <dir> --previous <url|none> (--key <path> | --unsigned)
bun run --cwd packages/cli build:index -- --check <base-url>
```

Trust model point 7 ([roadmap, Trust model](../../roadmap.md#trust-model)). In phase 4 a maintainer generates one Ed25519 key pair once, keeps the private key off the repo and off shared machines (a password manager or hardware-backed store), and commits the public key with a `keyId` to `INDEX_PUBLIC_KEYS`.

- Signing is inline, in the same run that builds: `--key <path to PKCS8 PEM>` signs every signed file the build writes (every file listed above as wrapped in `SignedIndex`) with Web Crypto Ed25519, then verifies its own output against `INDEX_PUBLIC_KEYS` before the rename. There is no separate signing step and no way to sign a directory built earlier.
- `--unsigned` writes `signature: ""` in every envelope, for local inspection and review artifacts only; 4.0d (and 4.1c for names) ignores such a file. Exactly one of `--key` and `--unsigned` is required.
- `--previous` is required: the live index URL, or `none` for the first build.
- `--check <base-url>` fetches every signed file at that host (`v1/index.json`; 4.0e and 4.2d add theirs to the same list), verifies each signature against `INDEX_PUBLIC_KEYS`, decodes each payload, and checks every bundle the index names against its digest. It exits non-zero on the first failure and names the file.

The key list allows a second key to ship in a CLI release before it signs anything, which is the only rotation path.

### Deploying by hand

Documented in `stacks-api/apps/api/README.md`:

1. `bun run --cwd packages/cli build:index -- --out <dir> --previous https://<host>/v1/index.json --key <path>`, where `<dir>` is a fresh directory outside both repositories (the output is never committed to either).
2. Review the diff of `v1/index.json` against the live one (the script prints entries added, updated, carried forward and omitted).
3. Run `bun run deploy` in `stacks-api` with the `--out` directory as its index input; the deploy copies it into the assembled static directory beside the built site (4.0b, "Static files"; after 4.0f, the Workers deploy).
4. `bun run --cwd packages/cli build:index -- --check https://<host>` against the live host.

### Failure modes

| Case | Result |
|---|---|
| Registry fails `validate` (any error or warning) | Build exits non-zero; nothing written |
| Previous index fails signature check | Build exits non-zero; the maintainer investigates before publishing anything |
| Carried-forward bundle digest mismatch | Build exits non-zero |
| Key missing or wrong, or neither `--key` nor `--unsigned` | Build exits non-zero |
| No stack proven and nothing to carry forward | Index with zero stacks; the CLI then uses bundled entries only |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/scripts/build-index.ts`, `packages/cli/package.json` (`build:index`) | New |
| `packages/format/src/index-schema.ts`, `src/index-keys.ts`, `src/index.ts` | New schemas and the public key list |
| `packages/cli/tests/build-index.test.ts`, `tests/fixtures/index/` | New, with a test key pair used only by tests |
| `stacks-api/apps/api/README.md` | Deploy procedure |
| `AGENTS.md` | `build:index` in the CLI commands table |

## Acceptance tests

Over a fixture registry, fixture ledger and, for carry-forward, a real local HTTP server serving a previous build:

1. The index decodes against `SignedIndex` and `RegistryIndex`; the signature verifies with the test public key; every bundle file's `bundleDigest` matches its path and its index entry.
2. A stack with a matching green ledger record gets a new entry whose `composition` equals the default fragments' current digests and whose `lastRun` is the newest matching record.
3. A matching record with `interventions: 1`, or with `tamperCheck: "manifest-only"`, does not prove the stack.
4. A matching green record whose agent is `"other"` proves the stack, and `lastRun.agent` is `"other"`.
5. A stack whose content changed since its last green run is carried forward: old digest, old `composition`, old `lastRun`, old bundle files present in the output.
6. A stack never proven is omitted.
7. A fixture entry that fails `validate` makes the build exit non-zero and leaves `--out` untouched.
8. A previous host serving a tampered bundle fails the build.
9. Neither `--key` nor `--unsigned`: exit non-zero, nothing written. `--unsigned`: every envelope has `signature: ""` and `--check` against it fails.
10. `--check` against the local server passes on a good build and fails, naming the file, when one byte of the served payload changes.
11. `_headers` has the two rules above.

### Realistic edge cases

12. Optional fragments are indexed only when a ledger record proves their current content in a composition; stale and never-proven optional fragments are excluded.
13. An untrusted or tampered previous index is refused; `--check` rejects missing or tampered advertised bundles and names the failing file.
14. Missing or untrusted keys, both signing modes together, and missing `--previous` fail without changing existing output.
15. Raw bundles preserve dotfiles, binary bytes, templates, executable bits and paths with spaces, leading dashes and non-ASCII characters; a symlink inside an entry fails validation without changing output.
16. Successful rebuilds replace existing output; a failure while fetching carried bundles preserves the entire previous output and unrelated siblings.
17. A registry with only validation warnings fails the build and preserves existing output.
18. A working directory outside the package, inherited git repository selectors and agent markers do not change the bundled registry or reported commit.

## Exit criteria

- Served by 4.0b's Node server from a static directory holding the build output, `GET /v1/index.json` and an entry file carry the two cache rules above (tested in `stacks-api`, over a fixture build copied from this repository's test output).
- Acceptance tests pass; `bun run check` green from the repo root.
- A maintainer has deployed the index once by hand, and `build:index --check` passes against the live host.

## What this plan may get wrong

- 2026-10-27: `INDEX_PUBLIC_KEYS` starts empty until a maintainer supplies a production key. Signing with an unlisted key fails with a maintainer-facing error; unsigned local output deliberately fails `--check`. The format test no longer requires a nonempty list; it still checks every listed key is a distinct Ed25519 key other than the fixture's.
- 2026-10-27: against the real bundled registry and ledger the index proves no stack yet. `astro-blog`, `go-cli`, `python-react` and `typescript-cli` have green records whose fingerprints are stale; the other six stacks have no default-composition record. A bench rerun per stack (2.0b) comes before the first published index.
- 2026-10-27: the executing ledger agent does not establish adapter targets; ledger imports can record Codex executing a Claude-targeted project. Index proof comparison tries every supported adapter subset independently of the recorded agent. For the agent widening, `show` and validation also consider every subset when the detection is `"other"` or `"none"`.
- 2026-10-27: a cached previous index still names its old bundle URLs after a proven update, so the build retains and verifies all bundles referenced by the supplied previous index, including its pinned compositions. Bundles unreferenced by that index cannot be discovered through this contract; retaining the full archive across fresh builds needs publisher support or a signed history inventory in a later unit.
- 2026-10-27: after several generations with shared fragments pinned at different digests, previous fragment metadata may describe a different digest from a carried stack's pin. The build decodes metadata from the verified pinned bundle when the previous metadata's digest differs.
- 2026-10-27: replacing a nonempty output directory requires moving the old tree aside before renaming the staged tree into place. A scoped rollback restores it on failure or interruption; this is not a single atomic exchange and does not protect against process termination between renames.
- 2026-10-27: the `LastRun` sketch left out `preset`, though the text below it says `lastRun` uses the fields `list --json` shows, which include it; the directory's stack page shows the preset of its last run too. `LastRun` now carries `preset` beside `minutesToGreen`. `LedgerRecord.agent` was `AgentId`, so a ledger could not hold the `"other"` or `"none"` records this plan says project without loss; it widens to `DetectedAgent`, and readers already skip records they can't decode.
- Proven-only serving makes ledger runs a release gate for stack prose. Until the canary runs (5.1), proof comes from maintainers rerunning the bench (2.0b), so the index may lag `main` for weeks. That is the intended trade: stale and proven over fresh and untested.
- A maintainer-held key is a single point of loss. Losing it means shipping a CLI release with a new key before the index can change; that's why `INDEX_PUBLIC_KEYS` is a list.
- The 5-minute index cache delays a fix by up to five minutes plus revalidation. Acceptable for a file that changes when a maintainer deploys.
