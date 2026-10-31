# Phase 4.5c: `stacks search` and local ranking

Status: EXECUTED 2026-10-28
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | An agent passes the user's own description of what they want to build to `stacks search "<request>" --json` and gets ranked stacks and fragments with a tier, the fields and words each matched on, and the evidence (green rate, last run) beside it, computed entirely on the user's machine over every entry the CLI can see, offline included, with no request text leaving the machine; "an iOS health app" returns `mobile-expo` first, and 4.5a's golden set gates every change. This ranking is also what the API runs: 4.5e moves `rank` to `packages/format`, serves it as `GET /v1/search`, and makes the command ask the API first with this local ranking as the fallback |
| Traces to | The coding agent: "It runs `list --json`, picks a stack"; its frustration is "ambiguity", and today it has to map a product request onto stack ids from descriptions alone. The demo's "describe a product, have the agent compare shared stacks using fit and usage evidence" ([DEMO_OUTLINE](../../../product/DEMO_OUTLINE.md)). The trust job: nothing the user describes is sent anywhere |
| Depends on | 4.5a (the golden set and harness), 4.5b (sidecars and the vocabulary), 1.0 (`Registry`, `list`), 3.1a (`show`, `lastRun` selection), 1.4 (the agent guide), 3.4c (the agent skill). Soft: 4.2b (the cached `stats` summary; without it, only `lastRun` is shown), 4.0d (index entries) |
| Blocks | 4.5e, 4.5d |
| Decisions needed | [D36](../../requirements.md#proposed-decisions) as amended 2026-10-27 (API-first search with a local fallback, 4.5e). This sub-phase sends nothing; 4.5e adds the call |
| Settles | The command, its flags and `SearchResult`; the lexical ranking (fields, weights, phrase matching through the vocabulary, the platform rule, `notFor`); tiers and "nothing fits strongly"; how evidence enters ranking without letting popularity override fit; untrusted entries; explanations; the golden gate |

## Scope

In:

- `stacks search <request...> [--kind stack|fragment] [--limit <n>] [--json]`. `--offline` belongs to 4.0d: once 4.0d has landed, `search` takes it as every command does (it changes nothing here, since `search` makes no request until 4.5e, where it skips the API call); until then `search` is offline by construction and has no such flag.
- `bun run search:eval --embeddings`, a maintainer-only flag of the eval script that embeds the entries' cards and the golden queries through the maintainer's own provider key, outside the shipped CLI, so 4.5d's start condition is measured whatever the lexical numbers say.
- `src/core/search/`: tokenizing, the vocabulary matcher, field-weighted BM25 over entries and their sidecars, tiers, the evidence adjustment, explanations. `rank` is a pure function over plain data (the request, the vocabulary, and one record per entry with its fields, sidecar, trust and evidence); it reads no service, file or clock, and the command builds its input from `Registry`. That is what lets 4.5e move it to `packages/format` and run it in the API unchanged.
- `SearchResult` in `src/schemas/search.ts`, in `RESULT_SCHEMAS` as `stacks schema search`.
- `tests/search-golden.test.ts`, the gate over 4.5a's set, and `bun run search:eval` to print the report.
- One sentence in the agent guide and the agent skill.

Out:

- The API route and the CLI's call to it (4.5e). Embeddings and any model in the CLI (4.5d). The only model call here is the maintainer-only `search:eval --embeddings`, outside the shipped command tree.
- Search on the website.
- A `list --query` option. One command that answers "which entries fit this" is easier for an agent to find in `--help` and in the guide than a filter on `list`, and keeps `ListResult` unchanged.
- Telemetry about searches. No event is sent; 4.1a's never-sent list gains "search requests".

## Design

### The command

```
stacks search "an iOS health app" --json
```

The request is the positional words joined by spaces, 1 to 500 characters after trimming. `--limit` (an integer, default 5, 1 to 20) applies to each list. `--kind` (`stack` or `fragment`) limits to one list. Exit 0 whenever the search ran, including when nothing fits strongly; nothing fits is a result, not an error.

Input failures, all exit 2:

| Input | Error |
|---|---|
| No request words | `Usage`, from the parser (the positional argument is required) |
| A request that is empty after trimming, or over 500 characters | `BadInput` with `details: { flag: "request", id: "", length }`: a new `request` literal in `errors.ts::BadInputDetails.flag` (precedent `name`, `author`, `scope`) and a new optional `length` key, the trimmed request's character count. The text itself never enters details, the message or a log record, because it describes what the user is about to build. The 500-character limit is the CLI's own check, not the parser's |
| `--limit 0` or `--limit 21` | `BadInput` with `details: { flag: "limit", id: "21" }` (new `limit` literal; `id` is the value as given); `failureGuide` says the range |
| `--limit abc` or `--limit 2.5` | `Usage` with the parser-rejected-value details `{ flag: "--limit", value, expected }` (an integer flag) |
| `--kind app` | `Usage` with `{ flag: "--kind", value, expected }` (a choice flag) |

Each text-mode failure ends with a `Next:` line built from `Host.invocation`.

```json
{
  "request": "an iOS health app",
  "ranking": "local",
  "understood": { "platforms": ["ios"], "productKinds": [], "languages": [], "capabilities": [],
                  "unmatched": ["health"] },
  "noStrongMatch": false,
  "stacks": [{
    "kind": "stack", "id": "mobile-expo", "name": "Expo app + Hono API",
    "summary": "A phone app for iOS and Android with its own API and database.",
    "origin": "bundled", "trusted": true,
    "tier": "strong", "score": 0.82,
    "why": [{ "field": "platforms", "matched": "ios", "from": "iOS" },
            { "field": "requests", "matched": "iphone app", "from": "iOS … app" }],
    "penalties": [],
    "caveats": ["HealthKit, Apple sign-in and other entitlements need a signed development build, not Expo Go"],
    "evidence": { "stats": { "greenRateLower": 0.86, "sample": 180, "projects": 215, "window": 28 },
                  "lastRun": { "date": "2026-10-27", "result": "pass" } }
  }],
  "fragments": [ … same shape, plus "appliesTo": ["mobile-expo"] … ]
}
```

- `score` is the entry's absolute match strength in [0, 1] (below), not normalized to the top hit, so a weak best result reads as weak.
- `why` lists each field and phrase that matched and the request words it came from; `penalties` lists what lowered it (`platform` or `language` mismatch, `notFor`, `untrusted`).
- `caveats` are the sidecar's (4.5b), copied unscored and omitted when the sidecar has none, so the agent can pass a platform-capability limit to the user before `new`.
- `evidence` is context, read from caches only (below); `stats` is absent when 4.2b's summary is unavailable or unpublished, exactly as in `list --json`.
- `understood.unmatched` lists content words no entry's strong fields matched, so an agent can tell the user "nothing here is specific to health".

Agent text output is one block per hit: id, tier, summary, the `why` phrases, any caveats, evidence on one line; then a `Next:` line built from `Host.invocation` (`.claude/rules/cli/cli.md`), naming `<invocation> show <id>` and `<invocation> new <id>` for the first trusted stack. It never suggests `new` for an untrusted entry: when the first hit is untrusted, `Next:` names the first trusted hit instead, and when no hit is trusted it says to ask the user before using any of them. With `noStrongMatch`, it says so first and `Next:` asks the agent to confirm with the user before using a weak match. Human output is the same with wrapping.

The agent guide gains: "When the user describes what they want to build, run `stacks search \"<their words>\" --json`, compare the strong matches using `why` and `evidence`, and tell the user your pick and one tradeoff before `stacks new`. If `noStrongMatch` is true, say nothing fits well." The skill (3.4c) gains the same rule within `SKILL_WORDS`.

### What is searched

Every entry `Registry` lists for the working directory, from every origin, with its sidecar (4.5b) when it has one. A user copy made by `create --from` carries the sidecar 4.5b copies with it, so shadowing a bundled entry doesn't lose its card. An entry without a sidecar is searched on its name, description, tags, category and body. This is registry-wide work on purpose: it is the one command whose question is about the whole registry, and its cost is bounded (below).

### Ranking

Per entry, a field-weighted BM25 score over these fields (k1 = 1.2, b = 0.75 per field), starting weights to tune on 4.5a's `tune` split:

| Field | Weight | Notes |
|---|---|---|
| `platforms`, `productKinds`, `languages` for stacks; `capabilities` for fragments (matched as vocabulary phrases) | 3.0 | A request phrase maps to a vocabulary key through its alias list ("iPhone" → `ios`, "command line" → `cli`, "golang" → `go`, "sign in" → `auth`) |
| `requests` | 2.5 | Best-matching request only, so five similar requests don't count five times |
| id, name | 2.0 | |
| `summary`, entry frontmatter `description` | 1.5 | Sidecar `description` is display-only |
| `useCases`, `synonyms` | 1.5 | |
| `goodFor`, tags, category | 1.0 | |
| body | 0.15 | Only so a sidecar-less user entry can be found at all; low enough that `/healthz` in a body can't outrank a platform match |

The field list is an allowlist. The optional editorial `SearchMetadata.description`,
`seoDescription` and `projectExamples` from 4.5b do not contribute tokens, score
or coverage. Keep entry frontmatter `description` distinct from the richer
sidecar field. The editorial fields support directory details and comparisons;
they do not change `SearchHit` in this phase.

Tokenizing: lowercase, split on anything not a letter or digit, drop a short stopword list plus generic product words ("app", "project", "tool", "thing", "something", "build", "make", "want"), and strip a plural `s`. No dependency: the lists live in `core/search/tokens.ts`. Vocabulary aliases are matched as phrases before tokenizing, so "command line" is one match. Each category (platforms, product kinds, languages, capabilities) is matched on its own, so one phrase can count in several: "go cli" names the language `go` through its alias and the platform `cli` through "cli".

Adjustments, applied in order:

1. Platform rule. When the request names a platform, a stack whose sidecar lists platforms that don't include it is multiplied by 0.3 (`penalties: platform`). A stack with no sidecar is left alone (unknown, not wrong). Fragments are judged by the stacks they apply to: a fragment whose `applies_to` names no stack that passes the rule gets the same factor, and one that applies to any stack is unaffected.
2. Language rule. The same as the platform rule, over `languages` (`penalties: language`): when the request names a language, a stack whose sidecar lists none of the named languages is multiplied by 0.3, a sidecar-less stack is left alone, and a fragment is judged through `applies_to`. "A command line tool in Python" therefore leaves `go-cli` and `typescript-cli` at `partial` at best, and with no Python CLI stack `noStrongMatch` is true.
3. `notFor`. A request phrase matching a `notFor` phrase multiplies by 0.5.
4. Absolute score. The adjusted BM25 sum is mapped to [0, 1] by `s / (s + c)` with `c` fixed per field set (tuned once), so the number means the same across queries and isn't relative to the top hit.

Tiers, from the absolute score and coverage. A strong field is one with weight ≥ 1.5 in the table above (vocabulary phrases, `requests`, id, name, `summary`, description, `useCases`, `synonyms`). Coverage is the share of the request's strong-matched words that this entry matches in a strong field, where a request's strong-matched words are its content words that at least one entry matches in a strong field. A match in a weaker field (`goodFor`, tags, category, the body) never enters the denominator.

| Tier | Rule |
|---|---|
| `strong` | Score ≥ 0.5, coverage ≥ 0.5, no platform, language or `notFor` penalty, and the entry is trusted (Trust, below). An entry whose own card says it isn't for the request can still be the closest fit, but it isn't a confident one |
| `partial` | Score ≥ 0.25, or an untrusted entry that would otherwise be `strong` |
| `weak` | The rest, returned only to fill `--limit` |

`noStrongMatch` is true when no stack is `strong`. Because the denominator counts only strong-field matches, "health" (matched only in bodies, such as `mobile-expo`'s `test/health.test.ts` and other stacks' `/healthz` probes) doesn't count against `mobile-expo`, which covers 1 of 1 strong-matched words on "iOS" rather than sitting exactly on the 0.5 line; "health" goes into `understood.unmatched` instead.

### Evidence without letting popularity decide

Fit decides the order; evidence only settles near-ties:

- Within a tier, results are ordered by score, then a quality adjustment of at most ±5% of the score: from the published green-rate Wilson lower bound when `stats` is present, else +2% for a `lastRun` with result `pass` and −2% for `fail`. Popularity (`projects`) is never part of the score; it is shown in `evidence` and breaks exact ties last, then id.
- An entry can't change tier through evidence.
- Evidence comes from caches only: 4.2b's cached summary and the ledger or index `lastRun`. `search` itself makes no stats request, so it is as fast offline as online and never waits on the network.

### Trust

An untrusted entry is never `strong`: its tier is capped at `partial`, it carries `penalties: untrusted`, and within a tier trusted entries come before untrusted ones. The agent guide's existing rule (never pick an untrusted entry the user didn't name; Trust model, point 3) applies to search results unchanged, and the `Next:` line never suggests `new` for one (The command, above). A project-origin entry stuffing its body or sidecar with keywords therefore can't reach the top tier or push past a trusted entry of the same tier, and BM25's saturation limits what repetition buys.

A sidecar is covered by its entry's trust: for a project entry, 3.2a's trust digest includes the sidecar (4.5b), so a card edited after `stacks trust` makes its entry untrusted again rather than changing a trusted entry's rank or printed `summary` behind the user's back. Bundled and user sidecars are trusted with their roots.

### Privacy

The request is read, ranked and printed. It is not written to the log file (the command's log record carries the request's length and the result counts, never its text), not cached, and not put in any telemetry event. This sub-phase sends it nowhere; 4.5e sends it to the API first under D36 as amended, and keeps every one of these rules.

### Cost

For 100 entries with bodies of 2,500 words, `search` finishes within 300 ms of `list` on the same registry (a test measures the ratio on a fixture registry, not wall time on CI). The index of a body is built per invocation; nothing is cached across runs (AGENTS.md: no caches across runs).

### The gate

`tests/search-golden.test.ts` runs `core/search::rank` over 4.5a's set through 4.5a's `evaluate` and fails on any first-result or no-match failure, or a metric more than 0.02 below `gate`. The first passing version sets `gate` to its numbers. `bun run search:eval [--split tune|holdout]` prints per-query ranks, the pool table and the metrics, for tuning and for review.

To show what the metadata buys, `search:eval --without-sidecars` ranks with sidecars ignored; its report is recorded once in this file's "What this plan may get wrong" when the plan executes, and 4.5b's exit criterion reads it.

`search:eval --embeddings` runs once when this plan executes, whatever the lexical numbers are, and its report goes in `plans/runs/` with the lexical one. It reports the holdout paraphrase queries separately, since that is what 4.5d's start condition reads. It is a maintainer tool like `decorate` (4.5b): it reads the provider key from the maintainer's environment, isn't in the packed package, and the CLI never calls it.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/commands/search.ts`, `src/cli.ts` | The command |
| `packages/cli/src/core/search/` | `tokens.ts`, `vocabulary.ts`, `bm25.ts`, `rank.ts` (`rank`), `explain.ts`, `report.ts` (text per audience) |
| `packages/cli/src/schemas/search.ts`, `src/core/result-schemas.ts` | `SearchResult`, `SearchHit` (beside 4.5b's `SearchMetadata`); `stacks schema search` |
| `packages/cli/src/errors.ts` | `BadInputDetails.flag` gains `request` and `limit`, and an optional `length`; `encodeDetails` and `failureGuide` cases; the roadmap's Error tags row |
| `packages/cli/src/core/guide.ts`, `skill/SKILL.md`, `plugin/` copy | The guide sentence and the skill rule |
| `packages/cli/scripts/search-eval.ts` | `bun run search:eval`, with `--split`, `--without-sidecars` and `--embeddings` |
| `packages/cli/tests/search-golden.test.ts`, `tests/search.test.ts` | The gate; command tests |
| `packages/cli/docs/reference/` | `search` reference page |

## Acceptance tests

1. `stacks search "an iOS health app" --json` over the bundled registry returns `mobile-expo` first in `stacks`, tier `strong`, `why` naming `platforms: ios`, `understood.platforms: ["ios"]` and `understood.unmatched: ["health"]`; no stack whose only match is "health" in its body is `strong`.
2. The golden gate passes: every first-result and no-match case, and MRR, recall@3 and fragment recall@5 at or above `gate`.
3. "firmware for a microcontroller" returns `noStrongMatch: true` and exit 0; agent text says nothing fits strongly and ends with `Next:`.
4. The result decodes with `SearchResult`; `stacks schema search` prints its JSON Schema; output is identical across two runs.
5. With the API down or the network unreachable (and, once 4.0d has landed, with `--offline`), the result is byte-identical to the online run with the same caches; the command makes no network request in any case (a test with a server that records requests). 4.5e replaces this test with its API-first tests.
6. With a cached published summary, hits carry `evidence.stats`; without one, `evidence.stats` is absent and nothing else changes.
7. Two fixture stacks of equal score: the one with the higher green-rate lower bound comes first; a stack with ten times the projects but a lower score does not pass one with a higher score; no fixture moves an entry across tiers through evidence.
8. A request naming a platform: a fixture stack with `platforms: ["desktop"]` gets `penalties: platform` and is never `strong`; a sidecar-less user stack gets no platform penalty.
8a. "a command line tool in Python" over the bundled registry: `go-cli` and `typescript-cli` carry `penalties: language`, neither is `strong`, `understood.languages` is `["python"]`, and `noStrongMatch` is true. "sign-in for my mobile app" ranks `clerk` first in `fragments` with `why` naming `capabilities: auth`. "ready to go live with my blog" names no language.
8b. "go cli" returns `go-cli` first, `strong`, with `why` naming both `languages: go` and `platforms: cli`. "a cli with a good TUI experience" returns `go-cli` and `typescript-cli` as the first two stacks, each carrying `penalties: notFor` (their cards list full-screen terminal UIs under `notFor`), `noStrongMatch: true`, and `tui` in `understood.unmatched`.
9. A trusted and an untrusted entry of the same tier: the trusted one comes first and the untrusted one carries `penalties: untrusted`. An untrusted fixture stack whose score and coverage would make it `strong` is `partial`, and with no trusted strong stack `noStrongMatch` is true.
9a. When the first hit is an untrusted project stack, agent text's `Next:` names `show` and `new` for the first trusted stack, built from `Host.invocation`, and never `new <untrusted id>`; with no trusted hit at all, `Next:` says to ask the user and names no `new` command.
10. A whitespace-only request, or one of 501 characters, is `BadInput` with `details: { flag: "request", id: "", length }` (`length` 0 and 501), exit 2; the envelope, stderr and the log file contain no word of the request. No request words at all is `Usage`, exit 2.
10a. `--limit 0` and `--limit 21` are `BadInput` with `details.flag: "limit"` and `id` the value; `--limit abc` and `--limit 2.5` are `Usage` with `details.flag: "--limit"`; `--kind app` is `Usage` with `details.flag: "--kind"`; each exits 2 and text output ends with `Next:`.
11. `--kind fragment --limit 3` returns at most three fragments and no `stacks` list entries.
12. The log file after a search contains the request's length and result counts and not its text; no telemetry event is spooled.
13. `search:eval --without-sidecars` runs and prints its metrics; `search:eval --embeddings` against a local fake embedding server prints lexical and fused metrics with the holdout paraphrase queries reported separately, and makes no request without the flag.
14. Agent output for the iOS request is one block per hit, shows `mobile-expo`'s caveat, and ends with `Next:` naming `show mobile-expo`; human output wraps; JSON has no text lines.
14a. Coverage counts only strong-field matches: for "an iOS health app", `mobile-expo`'s coverage is 1 (the body matches of "health" don't enter the denominator); a fixture stack matching "health" only in its `summary` makes "health" a strong-matched word and lowers `mobile-expo`'s coverage to 0.5.

### Realistic edge cases

15. A request in mixed case with punctuation ("An iOS (iPhone) app!") ranks the same as its lowercase form.
16. A request of only stopwords ("I want to build something") returns `noStrongMatch: true` with weak results, not an error.
17. A request naming two platforms ("iOS and web") applies the platform rule to neither as a penalty if a stack lists either, and `understood.platforms` lists both.
18. A fragment and a stack sharing an id appear in their own lists, each with its own `why`.
19. An entry whose sidecar failed to decode (`search-invalid`) is searched without it; the result doesn't fail.
20. A registry with a rejected entry (`list`'s `rejected`) leaves it out of results.
21. A non-ASCII request ("une app iOS pour la santé") matches `ios` through the alias and doesn't crash the tokenizer.
22. A user copy of `mobile-expo` made by `create --from bundled` shadows the bundled entry and still ranks first for "an iOS health app" with the copied sidecar's `why` and caveat.
23. A 500-character request of multi-byte characters is accepted (the limit counts characters after trimming, not bytes).

24. A symlinked user registry root with spaces and non-ASCII paths remains searchable from another working directory under agent markers and inherited Git wrapper variables.
25. Editing a sidecar between invocations changes the next result; no stale card is cached across runs.
26. Control characters and newlines in a sidecar summary survive JSON encoding but are escaped in terminal output, so an entry cannot forge a `Next:` line.
27. Fragment platform and language penalties follow `applies_to` stack ids or tags; matching any compatible stack or applying everywhere avoids the penalty.
28. Repeated identical request examples do not inflate a score and caveats are displayed without being scored.
29. An empty visible registry returns empty lists, `noStrongMatch: true` and exit 0.

## Exit criteria

- Acceptance tests pass; the gate green, with `gate` in 4.5a's set set to this ranking's first numbers.
- The command run in all three audiences per `.claude/rules/cli/cli.md` "Verifying UX".
- The `--without-sidecars` comparison recorded below.
- A `search:eval --embeddings` report in `plans/runs/`, run whatever the lexical numbers are, so 4.5d's start condition is decided on measured numbers.

## What this plan may get wrong

- 2026-10-28 (implementation follow-up): the merged descriptions and the react-router AI-chat request in e0bd75b resolve the health and first-result conflicts. Description search remains enabled as specified. Absolute-score scales remain 1 for stacks and 20 for fragments, with all field weights at the starting values. All golden judgments now pass, and the first baseline is set to `{ mrr: 1, recallAt3: 0.98, fragmentRecallAt5: 1 }`. The revised react-router card still needs a maintainer's renewed approval; this follow-up does not approve or restamp it.
- 2026-10-28 (test and scope follow-up): e0bd75b aligned the invalid-flag text assertions with failureGuide's indented `Next:` line. The authorized help-table change adds search's exits, and the plugin skill copy is synchronized with `skill/SKILL.md` as the publishing guide requires. Missing positional arguments use the parser's `MissingArgument.argument` in the existing closed Usage details shape, with empty `value` and a fixed `expected`.
- 2026-10-28 (evaluation): the refreshed reports are in `plans/runs/2026-10-28-search-lexical.md`. With cards, MRR is 1.0000 versus 0.8563 without, recall@3 is 0.9800 versus 0.8833, and fragment recall@5 is 1.0000 in both. First-result checks are 36/36 versus 30/36; no-match checks are 4/4 versus 3/4. The gate is initialized from the passing with-card metrics. The embedding experiment uses OpenRouter embeddings and reciprocal rank fusion (k=60) within each kind, excludes zero-score votes, and retains lexical scores and tiers. Fusion receives the full pool, including entries beyond the first twenty lexical hits. Only local fake-provider tests were run; the real provider report requires a maintainer's key and remains their step. Text reports show the first five ranks per kind; metrics use every ranked result.
- 2026-10-28 (tests written): `rank` takes one options object, `{ request, vocabulary, entries: { entry, search?, evidence? }[], limit?, kind? }`, and returns `SearchResult`. Each hit also carries `coverage`, the share defined under Tiers, so an agent can see why a hit is `partial`. With `noStrongMatch` and an untrusted first hit, `Next:` gives both: confirm with the user, then `show` and `new` for the first trusted stack. 4.2b's `Stats` service doesn't exist yet, so this sub-phase reads the summary from 4.2b's documented cache file (`$XDG_CACHE_HOME/stacks/stats/summary.json`, decoded with `StatsSummary`) through a read-only module named for the cache, which 4.2b's service later owns and extends with fetching. Three draft cards contradicted acceptance items 1, 8b and 14a (health synonyms on `typescript-api` and `docker-deploy`, no TUI `notFor` on `go-cli`); the cards were corrected before review.
- Starting weights and the `c` constant are guesses; the `tune` split decides them, and the `holdout` split checks they weren't overfitted. With 40 queries both are noisy; prefer round numbers that pass over precise ones that pass by a hair.
- The generic-word list ("app", "tool") is a judgment. If a stack's real name contains one, it still matches through id and name.
- Lexical ranking can't connect "log my workouts on my phone" to `mobile-expo` unless "phone" is an alias or a synonym. The vocabulary covers the common ones; the `paraphrase` pool says how much is left for 4.5d.
- 2026-10-27: the first draft let an untrusted entry reach `strong` and suggested `new <first id>` whatever its trust, defined coverage against every matched word (which put "an iOS health app" exactly on the 0.5 line), and used `Usage` for a length the CLI checks itself. Untrusted hits are now capped at `partial`, `Next:` names a trusted hit, coverage counts strong-field matches only, and over-long requests are `BadInput` carrying the length, never the text.
- 2026-10-27: the language rule and `capabilities` arrived with 4.5b's split of stack and fragment cards. Without the rule, a request's language was only a free-text word, so a Python CLI request reached `go-cli` as `strong`.
- 2026-10-27: search became an API endpoint as well (4.5e, D36 amended). `rank` is now required to be pure so it can move to `packages/format`, a `notFor` penalty now keeps an entry out of `strong`, and vocabulary categories match independently so "go cli" counts as a language and a platform.
- Evidence from caches means a first run with an empty cache shows no stats. That is the same as `list` and keeps `search` fast; an agent that wants fresh stats runs `list --json` first.
