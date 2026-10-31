# Phase 4.5a: Search evaluation set

Status: EXECUTED 2026-10-27 (judgments awaiting the maintainers' review)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | Before any ranking code exists, the maintainers agree what a good answer is: a golden set of natural-language requests, each with the stacks and fragments that should come back and the one that must come first, plus no-match controls, scored by metrics a test can compute, so relevance can't silently regress when entries, metadata or models change |
| Traces to | The coding agent's frustration, "ambiguity", now at the first step: it is asked for a product, not a stack id. The demo's opening, "describe a product, have the agent compare shared stacks using fit" ([DEMO_OUTLINE](../../../product/DEMO_OUTLINE.md)). The developer who starts projects often: "a stack that matches how they'd build it" |
| Depends on | 1.0 (the registry and entry ids). Nothing else: this is data and pure functions |
| Blocks | 4.5c (its ranking must pass this set's gate), 4.5d (its semantic leg is kept only if it improves these numbers) |
| Decisions needed | The maintainers review the queries and judgments; they are product decisions about what each entry is for. [Open question 35](../../risks-and-open-questions.md#open-questions-for-the-maintainers) (how the set grows when queries are never logged); [open question 40](../../risks-and-open-questions.md#open-questions-for-the-maintainers) (no native iOS stack: whether "an iOS health app" → `mobile-expo` is the right answer) |
| Settles | The golden set's format and location, the query pools, judgment grades, the metrics, the gate's shape and how its baseline moves, the tune and hold-out split |

## Scope

In:

- `packages/cli/tests/fixtures/search/golden.json` and its schema in `tests/helpers/search-golden.ts` (test code, not a shipped schema).
- About 40 queries over the bundled registry, in the pools below, with graded judgments.
- `tests/helpers/search-eval.ts`: pure metric functions over a ranking and a judgment, and `evaluate(rank, golden)`, which takes any function with the shape `(query: string) => ReadonlyArray<{ kind, id }>` and returns a report.
- A coverage test: every id in the set exists in the bundled registry; every bundled stack is the required first result of at least two queries; every bundled fragment is relevant to at least one.

Out:

- The ranking (4.5c) and the gate test that runs it (4.5c adds it, using this harness).
- Queries over user, project or source entries. The set covers the bundled registry; index-only entries join when 4.0d lands.
- Logging real queries to grow the set. Queries never leave the machine in 4.5c, and 4.5d doesn't store them.

## Design

### Why a set first

A ranking tuned without a fixed target drifts toward whatever the last query someone tried happened to need. The set fixes the target before the ranking exists, is reviewed as product judgment (which stack is "an iOS health app" for?), and turns every later change to an entry, its search metadata (4.5b) or a model (4.5d) into a number that can go down.

### Format

```json
{
  "schemaVersion": 1,
  "gate": { "mrr": 0.0, "recallAt3": 0.0, "fragmentRecallAt5": 0.0 },
  "queries": [
    { "id": "platform-ios-health", "pool": "platform", "split": "tune",
      "query": "an iOS health app",
      "first": { "kind": "stack", "id": "mobile-expo" },
      "relevant": [{ "kind": "stack", "id": "mobile-expo", "grade": 2 },
                   { "kind": "fragment", "id": "clerk", "grade": 1 }] },
    { "id": "nomatch-firmware", "pool": "no-match", "split": "holdout",
      "query": "firmware for a microcontroller", "noMatch": true, "relevant": [] }
  ]
}
```

- `first` is the result that must rank first among its kind. It is set only where the maintainers agree there is one right answer.
- `relevant` grades: 2 is what a person would pick, 1 is a fair second choice. Anything else is not relevant.
- `noMatch: true` means no result should reach the `strong` tier (4.5c defines tiers); returning weak candidates is fine. A `noMatch` query may still list `relevant` entries at grade 1, the closest fits that should rank first without being strong; MRR and recall count them as for any other query.
- `split`: about a third of the queries are `holdout`. Tuning reports (4.5c's `bun run search:eval --split tune`) show only `tune`; the gate checks both, so a change tuned on one pool can't quietly lose the other. The people who write sidecars (4.5b) also write this set, so no golden query may appear in the drafting prompt or its examples, and no holdout query may appear in, or share a run of five consecutive words with, any sidecar's `requests`; 4.5b's tests enforce both. Without that, a maintainer could make the holdout split pass by copying it into the cards.
- `gate` holds the current baseline (below). It starts at zero and is set by 4.5c's first passing ranking.

### Pools

| Pool | What it tests | Examples (ids are today's registry) |
|---|---|---|
| `platform` | The request names where it runs | "an iOS health app" → `mobile-expo`; "an iPhone and Android app with a backend" → `mobile-expo`; "a macOS desktop app" → `tauri-react`; "a command line tool in Go" → `go-cli`; "go cli" → `go-cli` (a two-word query, the shape people type into a search box) |
| `product` | The request names what it is | "a personal blog with MDX posts" → `astro-blog`; "a REST API in TypeScript" → `typescript-api`; "an AI chat web app" → `react-router` with `openrouter-chat` |
| `paraphrase` | Neither the platform nor the product word the entry uses | "something people install on their phone to log workouts" → `mobile-expo`; "a tool I run in my terminal to rename files" → `go-cli` or `typescript-cli` (both grade 2, no `first`) |
| `trap` | A word that appears in entry bodies in a technical sense | "an iOS health app" (stack bodies are full of `/healthz` probes and health checks); "a monitoring dashboard" (healthchecks in `docker-deploy`); "a test prep app for students" (every body says "test") |
| `fragment` | A need, not a project | "sign-in for my mobile app" → `clerk`; "a Postgres database for my FastAPI app" → `postgres`; "release binaries for my Go CLI" → `goreleaser`; "product analytics" → `posthog` |
| `combined` | A project and a need | "a static blog deployed to Cloudflare" → `astro-blog` first, `cloudflare-pages` relevant |
| `no-match` | Nothing in the registry fits | "firmware for a microcontroller"; "a Unity game"; "an Android-only app in Kotlin" and "a native SwiftUI iPhone app" (Expo is a fair grade-1 answer to both, so these have `relevant` with `mobile-expo` at grade 1 and no `first`, rather than `noMatch`); "a command line tool in Python" (`go-cli` and `typescript-cli` at grade 1, no `first`: the platform fits and the language doesn't, which 4.5c's language rule must keep out of `strong`); "a cli with a good TUI experience" (`noMatch: true` with `go-cli` and `typescript-cli` at grade 1: they are the closest fits and should rank first, but neither ships a TUI library, so neither may be `strong`) |

The `trap` pool is the reason this set exists before the ranking: a plain lexical ranking over entry bodies would rank stacks with a `/health` endpoint above `mobile-expo` for "an iOS health app", because "health" is in their bodies and "iOS" appears only a few times in `mobile-expo`'s, and not in its tags. The set records that failure as a test before anyone builds the ranking that has it.

The no-match pool keeps the ranking honest: a search that always returns something confident teaches the agent to trust a bad fit.

### Metrics

Computed per kind (stacks and fragments), over each query's ranked list:

| Metric | Definition | Why |
|---|---|---|
| First-result pass | For every query with `first`, the first result of that kind is it | The cases the maintainers agreed have one answer. Must be all of them |
| MRR | Mean over stack queries with any relevant stack of 1 / rank of the first relevant one (grade ≥ 1), 0 when none in the top 10 | One number for "the right stack is near the top" |
| Recall@3 | Share of grade-2 stacks found in the top 3, averaged over queries | An agent reads the first few and compares; a right answer at rank 6 is missed |
| Fragment recall@5 | The same for grade-2 fragments in the top 5 | Fragments come back as a second list |
| No-match pass | For every `noMatch` query, no result is in the `strong` tier | The ranking says "nothing fits" when nothing does |
| Pairwise wins | For each query with `first`, the number of other results ranked above it (0 is a pass); a result missing from the list is not counted as a win for `first` | A dropped competitor is not a ranking improvement |

nDCG is left out: with two grades and a handful of relevant entries per query it says little that MRR and recall don't.

### The gate and its baseline

4.5c adds `tests/search-golden.test.ts`, which runs the real ranking over the set and fails when:

- any first-result case or no-match case fails, or
- MRR, recall@3 or fragment recall@5 falls more than 0.02 below `gate`.

When a change raises a metric, its author raises `gate` in the same commit, so the baseline only moves up and the diff shows by how much. Lowering `gate` is a plan change: it is written in 4.5c's "What this plan may get wrong" with the reason.

### Keeping the set current

- A new bundled stack fails the coverage test until it has two queries for which it is `first`.
- Renaming or removing an entry fails the coverage test until the set is updated (or the id is in 4.2c's `removed.json`, in which case its queries move to its replacement).
- New queries come from bench notes (what the bench's request said), issues, the demo script and maintainers' own requests. The set never grows from logged user queries, because there are none (open question 35).

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/tests/fixtures/search/golden.json`, `tests/helpers/search-golden.ts` | New: the set and its schema |
| `packages/cli/tests/helpers/search-eval.ts` | Metrics and `evaluate` |
| `packages/cli/tests/search-golden-coverage.test.ts`, `tests/search-eval.test.ts` | New |
| `packages/cli/docs/maintaining.md` | How to add queries and judgments; how the baseline moves |

## Acceptance tests

1. `golden.json` decodes with its schema; every query id is unique; every `first` also appears in `relevant` with grade 2.
2. Every id in the set names an entry of that kind in the bundled registry; a fixture set naming `no-such-stack` fails the coverage test, naming the query.
3. Every bundled stack is `first` for at least two queries and every bundled fragment is relevant to at least one; a fixture registry with an extra stack fails, naming it.
4. About a third of the queries (at least 12) are `holdout`, and every pool has at least one `tune` and one `holdout` query.
5. The set contains the query "an iOS health app" with `first` `mobile-expo`, in the `trap` pool or the `platform` pool; the query "a native SwiftUI iPhone app" with `mobile-expo` relevant at grade 1 and no `first`; and at least three `noMatch` queries.
6. Metrics over hand-written rankings match hand computation: a ranking with the first relevant stack at rank 2 gives reciprocal rank 0.5; none in the top 10 gives 0; recall@3 with one of two grade-2 stacks in the top 3 gives 0.5.
7. Pairwise wins: a ranking where the `first` stack is missing and a competitor is also missing counts no win; a ranking where it is present and outranked by one counts one.
8. `evaluate` reports tune and holdout separately and in total, and is deterministic for the same ranking function.

### Realistic edge cases

9. A query with only fragment judgments contributes nothing to stack MRR (it isn't counted as a zero).
10. Two entries of different kinds sharing an id (a stack and a fragment named the same) are judged separately by `{ kind, id }`.
11. A query string with leading spaces, mixed case or trailing punctuation is stored as written; normalization belongs to the ranking, not the set.

## Exit criteria

- Acceptance tests pass; the gate (`bun run check`, or `rr check` in an opted-in clone) green.
- The maintainers have reviewed every query and judgment and recorded the review date in this file.

## What this plan may get wrong

- 2026-10-27: The initial set uses 45 queries (29 tune, 16 holdout) so fragment needs have their own requests as well as combined cases. The metric contract counts ranks within each kind and averages recall over eligible queries, not pooled judgments. Despite its name, `pairwiseWins` counts competitors above a present `first`; missing `first` returns zero and fails the separate first-result check. No-match checks strong hits of both kinds under this plan's "no result" wording; 4.5c must reconcile its narrower stack-only wording. Maintainer review of these judgments is still pending.
- Forty queries written by the people who wrote the entries share their vocabulary. The `paraphrase` and `trap` pools push against that, but the set will still be easier than real requests. Bench requests and the demo's own wording are the best outside source until there is another.
- Some requests have no single right answer, and forcing a `first` would encode one maintainer's taste. Leave `first` off those and rely on recall.
- "An iOS health app" → `mobile-expo` assumes a cross-platform Expo app is an acceptable answer to an iOS request. There is no native iOS stack, `mobile-expo`'s tags don't include `ios`, and HealthKit needs an entitlement that forces a signed development build (the stack's body already warns that entitlements make `expo run:ios` demand signing). Open question 40 asks whether to add a native Swift stack; until then the answer stands, and 4.5b's `caveats` field carries the HealthKit warning so the agent can relay it.
- With ten stacks, a first-result pass is close to a lookup table. The set matters more as the catalog grows; the coverage rule makes it grow with it.
