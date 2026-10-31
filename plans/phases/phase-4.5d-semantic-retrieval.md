# Phase 4.5d: Semantic retrieval

Status: DRAFT 2026-10-27 (not agreed; gated on 4.5c's evaluation)

| Field | Value |
|---|---|
| Goal | `GET /v1/search` (4.5e) adds a semantic leg: the API embeds the request, compares it with embeddings of each official entry's search card and example requests, and fuses the similarities with its lexical ranking, so paraphrases with none of an entry's words still find it. Every caller of the route gets it, `stacks search` included, with no CLI release; the request is never logged, stored or counted, and the response's `method` says which ranking ran (rewritten 2026-10-27 from an opt-in CLI leg over `POST /v1/search`; see What this plan may get wrong) |
| Traces to | 4.5a's `paraphrase` pool, where lexical ranking has nothing to match |
| Depends on | 4.5c (the ranking, the gate, the `search:eval --embeddings` report) and its evidence (below), 4.5e (the route, `Search`, `IndexAssets`, and the search code in `packages/format`), 4.5b (`SearchMetadata`, `v1/search.json`), 4.0f (the Worker, D1, scheduled entry), 4.1b (`RateLimiter` and `rate_counts`, for the route's own counter), 4.1c (`maintain` and its lease), 4.1d (`daily_metrics`, which holds the one call count), 4.0c (the index the API reads), D36 |
| Blocks | Nothing |
| Decisions needed | D36 as amended (the request reaches the API by default, 4.5e). The start condition below. [Open question 36](../risks-and-open-questions.md#open-questions-for-the-maintainers) (the embedding provider, including a local query model) |
| Settles | When this is built at all; what text is embedded; the model and where it runs; where vectors live and how they are rebuilt; fusion on the server; what the server may and may not keep beyond 4.5e's rules |

## Start condition

This sub-phase starts only if 4.5c's numbers show it is needed and an offline experiment shows it helps:

1. 4.5c's ranking, on the holdout `paraphrase` queries of 4.5a's set, has recall@3 under 0.8 or MRR under 0.7.
2. 4.5c's `bun run search:eval --embeddings` report (a maintainer-only flag that embeds the entries' cards and the golden queries through the maintainer's own provider key, outside the CLI, exactly as the server would) shows the fused ranking raises MRR on the holdout paraphrase queries by at least 0.1 without failing any first-result or no-match case.

Both conditions read the holdout split only. The maintainers write both the paraphrase queries and the sidecars' `requests`, so the tune split can be met by writing cards that echo it; 4.5b forbids golden queries in the drafting prompt and keeps holdout queries out of sidecars, and this condition doesn't count numbers that could have been tuned on.

If either fails, this file moves to `DEFERRED` with the numbers, and the vocabulary and sidecars (4.5b) take the paraphrase gap instead. A catalog of dozens of entries with reviewed example requests may never need vectors.

## Scope

In:

- In `stacks-api`: the `Embedder` and `SearchVectorStore` services, the `search_vectors` table, a step in `maintain` that refreshes vectors after an index deploy, and fusion inside 4.5e's `Search` service, which sets the response's `method` to `"hybrid"`.
- Nothing in `packages/cli`: the CLI already calls the route (4.5e) and reads `method`.

Out:

- Vectors in the signed index for the CLI to use offline. Ranking offline by vector needs the request embedded on the machine, which means a model in the CLI (too large for an `npx` bundle) or a model call from it (D2's line). Without that, entry vectors on the machine are useless. [Open question 36](../risks-and-open-questions.md#open-questions-for-the-maintainers) records the one variant that might fit: a small WASM model downloaded on demand into the cache.
- A vector database. Dozens of entries with a handful of vectors each fit in one Worker's memory.
- Query rewriting, expansion or reranking by a model. Nothing calls a language model on the query path; semantics live in the reviewed cards (4.5b) and the embeddings. The embedding model is the one model this sub-phase calls, and D37 names it as the exception: it reads reviewed sidecars in `maintain` and the request in `GET /v1/search`, and writes nothing but vectors.
- User, project and source entries in the semantic leg. The server knows only official entries; the CLI ranks local entries lexically and merges them (4.5e).
- Any record of requests: no log, table, cache or count by text.

## Design

### What is embedded

Per official entry, from its reviewed sidecar:

- One card vector over `name. summary. entryDescription. Platforms: …. Kinds: …. Languages: …. Use cases: …. Good for: ….` for a stack, with `Provides: ….` (its `capabilities`) in place of platforms, kinds and languages for a fragment. `entryDescription` is the recipe frontmatter description, not 4.5b's richer sidecar `description`. The body stays excluded because it is tool guidance.
- One vector per example request in `requests`.

Use only these named inputs. Sidecar `description`, `seoDescription`,
`projectExamples` and `caveats` are unembedded. Illustrative product ideas and
SEO wording must not become semantic capability claims or alter `docDigest`.

An entry's semantic similarity to a request is the larger of its card similarity and its best request similarity, so five near-identical requests count once.

Each vector is keyed by `(kind, id, docDigest, model)`, where `docDigest` is sha256 of the exact embedded text. Changing the model or the text makes a new key; an entry whose key exists is not embedded again.

### The model and where it runs

Decided here, pending open question 36: Workers AI's embedding model through the Worker's AI binding, named once in the API's config (`SEARCH_EMBEDDING_MODEL`). The request then never leaves the platform that already terminates the API's TLS, no third party sees it, and no new secret exists. The alternative, an embedding model through OpenRouter, may embed better but sends each request to two more parties and needs an API key on the Worker; it stays behind the same `Embedder` service if the experiment says it wins by enough to be worth that.

`Embedder` (`stacks-api/Embedder`) has a Workers AI layer, a deterministic fake for tests (hashed character n-grams, so similar strings are near), and nothing else. The Node entry has only the fake, so `bun run dev` can serve the route without an account.

### Where vectors live and how they are rebuilt

`search_vectors(kind, id, doc_digest, model, dims, vector BLOB, created_at)` in D1, through `services/SearchVectorStore.ts` (the Store row of `stacks-api/.claude/rules/api/effect-api.md`: an in-memory layer and a SQL layer over `SqlClient`). A step in 4.1c's `maintain` (at the path 4.1c gives it, `maintenance/maintain.ts`, which predates that rule; [open question 37](../risks-and-open-questions.md#open-questions-for-the-maintainers)), under its lease, reads `v1/search.json` through `IndexAssets` (signature verified), embeds every card and request whose key is missing, and deletes rows for entries no longer in the index. An index deploy is therefore picked up on the next scheduled run; `bun run search:vectors` runs the same step by hand after a deploy.

At request time the Worker loads every row for the current model (dozens to a few hundred vectors) into isolate memory once per index `generatedAt` and compares by cosine similarity over all of them. Cloudflare Vectorize was considered and rejected: another binding, eventual consistency after writes, and approximate search, for a set a loop covers in microseconds.

### The route

4.5e's `GET /v1/search` keeps its parameters, response shape and errors. With this sub-phase, `Search` embeds `q` through `Embedder`, compares it with the vectors for the current index, and fuses the two before tiers are assigned; the response's `method` becomes `"hybrid"`. When the embedder or the vector store fails, or takes longer than 300 ms, the route returns the lexical ranking with `method: "lexical"` instead of an error, because the lexical ranking is a complete answer; one defect line names the failure and never the text. Once 4.1b's `RateLimiter` exists the route gets its own counter: `429 RateLimited` with `Retry-After` past 30 requests per minute per network hash, since each request now costs a model call.

What the server keeps is 4.5e's rule, unchanged: nothing derived from the text. Workers AI processes it for the length of the call; the privacy page's "Search" section (4.5e) names Workers AI as the one processor that sees it.

### Fusion

In `stacks-api/apps/api/src/services/Search.ts`: for each official entry, `fused = 0.6 × lexical + 0.4 × semantic`, where `lexical` is `rank`'s absolute score and `semantic` maps similarity to [0, 1] linearly between 0.2 and 0.6. Weights are tuned on the `tune` split. Rank-only fusion (reciprocal rank fusion) was the other option and is rejected here: it throws away how strong a match is, so a weak semantic rank-1 counts nearly as much as a strong one, and with a few dozen candidates the rank positions carry little information. Entries under the similarity floor keep `semantic = 0`.

Tiers use the fused score, with one more rule: an entry matched only semantically (no lexical field matched) is `strong` only when its similarity is at least 0.35, so a vague concept match can't present itself as a confident fit. Each hit's `why` gains `{ field: "semantic", matched: "request" | "card", similarity }` when the leg contributed.

The CLI merges local user, project and source entries, ranked lexically, with the route's hybrid hits (4.5e). Fused and lexical scores share the [0, 1] scale and the merge orders by tier first, so a local entry competes on its tier; it gets no semantic credit, since the server never sees it.

### Evaluation

The CI gate stays 4.5c's, local and deterministic. `bun run search:eval --remote <url>` (4.5e) runs the set against a local or deployed API through the real route and prints local and remote metrics side by side, which with this sub-phase means lexical and hybrid; a maintainer runs it before changing the model, the weights or the floor, and after each index deploy that changes cards, and records the report in `plans/runs/`. A model change that lowers hybrid MRR below local MRR on the holdout split is not shipped.

## Files and areas touched

| Path | Change |
|---|---|
| `stacks-api/apps/api/src/services/Search.ts` | Fusion, the 300 ms budget and the lexical fallback |
| `stacks-api/apps/api/src/services/Embedder.ts`, `services/SearchVectorStore.ts` | Services with their layers |
| `stacks-api/apps/api/src/maintenance/maintain.ts` (4.1c's path; open question 37) | The vector refresh step |
| `stacks-api/apps/api/migrations/` | `search_vectors` |
| `stacks-api/apps/api/wrangler.jsonc`, `src/config.ts` | The AI binding, `SEARCH_EMBEDDING_MODEL` |
| `stacks-api/apps/api/src/handlers/search.ts` | The rate limit |
| `stacks-api/apps/web/src/pages/` | The privacy page names Workers AI |
| Tests in `stacks-api` | New |

## Acceptance tests

1. The start condition's numbers are recorded in this file before any code lands.
2. `GET /v1/search` with the fake embedder returns `method: "hybrid"`, decodes with 4.5e's `SearchResponse`, and ranks a fixture paraphrase that shares no word with its entry's card into the top 3; the 31st call in a minute from one network is `429` with `Retry-After`.
3. After a request with a sentinel string, no log line, table row or `daily_metrics` field contains the sentinel; `daily_metrics` has the call counted.
4. The vector refresh step embeds each card and request once; a second run embeds nothing; an edited sidecar re-embeds only that entry; a changed `SEARCH_EMBEDDING_MODEL` re-embeds everything under the new key; an entry removed from the index loses its rows.
5. Vectors are loaded once per index `generatedAt` per isolate (a counter in the in-memory store).
6. The fake embedder failing, or answering after 300 ms: the route returns `200` with `method: "lexical"` and the lexical ranking, and one defect line without the text.
7. Fusion over fixture scores matches hand computation; a concept-only match at similarity 0.3 is not `strong`, at 0.4 it can be.
8. The CLI against the route with the fake embedder: `ranking: "api"`, `method: "hybrid"`, and a user entry in the local registry keeps its lexical rank and carries no `semantic` in `why`.
9. `search:eval --remote` against a local API with the fake embedder prints lexical and hybrid metrics for both splits.

### Realistic edge cases

10. A request in another language returns whatever similarities the model gives without error; the platform rule still applies from aliases.
11. The index deployed with a new entry before the scheduled step ran: the route fuses for the entries it has vectors for, and the new entry ranks lexically only until the step runs.
12. The AI binding returns a vector of the wrong length: the step logs the model and entry, stores nothing for it, and the route skips that entry.

## Exit criteria

- Start condition met and recorded; acceptance tests pass; the gate green in both repositories.
- A `search:eval --remote` report against the deployed API in `plans/runs/`, with hybrid at or above local on every metric.
- D36 as amended agreed.

## What this plan may get wrong

- The start condition may never be met. That is a fine outcome: it means reviewed cards were enough at this scale.
- A linear similarity map between 0.2 and 0.6 assumes the model's similarity range; another model has another range. The floor and the map are config tuned with the model.
- 2026-10-27: the first draft made `Settings.search` a file-only setting "so an agent can't turn it on", but an agent writes `config.json` as easily as a person. It now follows 4.1a's `telemetry enable`: a command that refuses under an agent or without a TTY, with the file-editing limit stated rather than claimed away. The start condition also read both splits, which the people who write the cards could meet by echoing the tune queries; it now reads the holdout paraphrases only.
- Holding vectors in isolate memory assumes the set stays small. Past a few thousand vectors, revisit the store, not the route.
- 2026-10-27: rewritten when search became an API endpoint (4.5e) and D36 was amended to API-first. The first draft ran the semantic leg only for people who turned it on with `stacks search-hybrid enable`, over `POST /v1/search` returning bare similarities that the CLI fused. Now the route fuses on the server and every caller gets it, so `Settings.search`, the `search-hybrid` commands and CLI-side fusion are gone, and the schema move to `packages/format` happens in 4.5e. The cost is that every search request reaches Workers AI, which the privacy page states; `--local`, `--offline` and `DO_NOT_TRACK` keep a request on the machine.
