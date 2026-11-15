# core/remote-index

This folder holds the security checks for the signed remote index, the optional registry root the
CLI downloads from a URL. Before `stacks list`, `show` or `new` can use an entry from that index,
the index has to verify and the entry's files have to hash to the digest the index promised.

## How it fits

`core/remote-index.ts::RemoteIndex` owns the network side: the URL, the 24-hour cache, the
1,500 ms deadline and the request backoff (through `core/cached-fetch.ts`). It calls into this
folder for every decision about whether downloaded data can be used, and for reading and writing
entry files on disk. `core/allowlist.ts` also uses `verification.ts::signatureValid` for the
signed dependency allowlist.

The checks here are trust-model code (`.claude/rules/architecture.md`, "Trust model", point 2):
entries from the official index URL are trusted, so its signature must verify against the
maintainers' public keys compiled into the CLI (`INDEX_PUBLIC_KEYS` in `@steamfield/stacks-format`).
A configured `STACKS_INDEX_URL` is untrusted, so its signature isn't required, but its bundles
still have to match their digests. Like the rest of `core/`, nothing here imports `platform/` or
`commands/`. A failed check never raises an error: it returns the outcome word `invalid` or
`unsupported`, the cache records it, and the CLI keeps using older verified data or the bundled
registry.

## The flow

1. `RemoteIndex.current` fetches the index text and hands it to `verification.ts::verifyIndex`,
   which checks in order: the signed envelope decodes; the signature verifies (official URL only);
   the payload's `formatVersion` and `minCli` are ones this CLI supports; the whole index decodes.
2. When a command needs an index entry's files, `RemoteIndex.bundle` first asks
   `files.ts::directoryMatches` whether the cached directory for that digest still hashes to it.
3. Otherwise it downloads the bundle, checks its id, kind and digest against the index entry, and
   writes it with `files.ts::extractBundle` into a staging directory that is then renamed to the
   digest. If the cache can't be written, the bundle goes into a temporary directory for this
   invocation only.

## Files

| File | What it owns |
| --- | --- |
| `verification.ts` | `verifyIndex` (the ordered index checks) and `signatureValid` (Ed25519 over the envelope's payload) |
| `files.ts` | `directoryMatches` (rehash an extracted directory) and `extractBundle` (write a verified bundle, refusing aliased paths before any write) |

## Terms

- **Signed envelope**: the JSON document actually served, `SignedIndex`: a `payload` string (the
  index or allowlist as JSON), the `keyId` of the key that signed it and the base64 `signature`.
- **Bundle**: one entry's files as a single JSON document, `EntryBundle`. Its **digest**
  (`bundleDigest`) is a SHA-256 over the bundle's canonical form, so the same files always give
  the same digest.
- **Outcome**: the word a failed check returns (`invalid`, `unsupported`), stored by the cache as
  `lastOutcome` and shown by `stacks doctor`.

## Where to start

Read `verification.ts::verifyIndex`, then `core/remote-index.ts::cachedBundle`. Tests:
`packages/cli/tests/remote-index.test.ts` and `packages/cli/tests/remote-origin-edge.test.ts`,
with fixtures from `packages/cli/tests/helpers/remote-index.ts`.
