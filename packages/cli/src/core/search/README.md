# core/search

This folder is the CLI side of `stacks search`: given a request in plain words ("a Next.js app
with Postgres"), it finds the stacks and fragments that fit and tells an agent what to run next.
It also holds the readers for the registry's search data files, which `show`, `validate`,
`create` and `submit` use too.

## How it fits

`commands/search.ts` calls `run.ts::search` and prints the result with
`report.ts::renderSearch`, or as JSON with `--json`. The ranking itself (BM25 scoring, tokens,
the vocabulary, tiers and the `SearchResult` shape) lives in `packages/format/src/search/`, so the
hosted API ranks with exactly the same code. This folder does the I/O around it: reading the
registry, asking the API, merging and rendering.

It depends on `core/registry/` (entries, search cards, the vocabulary), `core/ledger.ts` and
`core/stats-cache.ts` (evidence shown beside each hit), `core/replace-file.ts` (the backoff file)
and the `HttpClient` service. Like the rest of `core/`, it never imports `platform/` or
`commands/`. Search is best-effort about everything except the registry: a missing card, an
invalid vocabulary or an API that is down costs ranking quality, never the command.

## The flow of one search

1. `run.ts::search` records whether the invocation was offline, then marks it offline so the
   signed remote index is read from its cache only.
2. Two things run at once:
   - local ranking: `input.ts::searchInput` reads every usable entry, its search card, the latest
     bundled run and cached stats, and `rank` scores them all;
   - `remote.ts::remoteSearch` asks the hosted API, unless `--local`, `--offline`, `DO_NOT_TRACK`
     or a missing endpoint turns it off, an earlier failure put the endpoint in backoff, or it
     takes longer than 800 ms.
3. `merge.ts::mergeSearch` takes the API's hits for official entries, keeps local overrides
   ahead of them, fills in missing evidence from local data, then applies `--limit` and `--kind`.
4. `report.ts::renderSearch` turns the result into text ending with `Next:` lines.

## Files

| File | What it owns |
| --- | --- |
| `run.ts` | One search: the offline handling and running local and remote ranking concurrently |
| `input.ts` | Everything local ranking reads: entries, cards, vocabulary, ledger and stats evidence, overrides |
| `remote.ts` | The API request, its 800 ms deadline and the ten-minute backoff kept in `search/backoff.json` under the cache directory |
| `merge.ts` | Which hit wins per entry, evidence fill-in, the stats population and the final limit |
| `report.ts` | The text report: notices, one block per hit and the `Next:` advice |
| `sidecar.ts` | Symlink-refusing reads of registry data files and the decoders for search cards, the vocabulary, `authors.json` and dependency cards |
| `digest.ts` | `searchSourceDigest`, which tells whether a search card still matches its entry |

## Terms

- **Search card**: an optional sidecar file, `search/stacks/<id>.json` or
  `search/fragments/<id>.json` under a registry root, with hand-written metadata (aliases,
  platforms, plain-language copy) that improves ranking for one entry. A card whose id or kind
  doesn't match its entry is ignored.
- **Vocabulary**: `search/vocabulary.json` in the bundled registry, mapping aliases to the
  platforms, product kinds, languages and capabilities ranking understands.
- **Override**: a project or user entry with the same kind and id as an official (bundled or
  index) one. It is the entry `new` and `add` would use, so its local hit always replaces the
  API's.
- **Tier**: how well a hit fits, `strong`, `partial` or `weak`. With no strong hit the report asks
  the agent to confirm the fit with the user.
- **Backoff**: after a failed or late API request, the endpoint is skipped until a stored expiry
  time passes, so a dead network doesn't add 800 ms to every search.
- **Stats population**: whether the published stats behind a hit are real or seeded development
  data; a result is marked seeded when any stat it shows is.

## Where to start

Read `run.ts` first; it is short and names every other step. The tests are
`packages/cli/tests/search.test.ts`, `search-api*.test.ts` (the API, merge and backoff),
`search-cache.test.ts`, `search-edge.test.ts`, `search-privacy.test.ts` and the
`search-metadata-*.test.ts` files for cards and their digest.
