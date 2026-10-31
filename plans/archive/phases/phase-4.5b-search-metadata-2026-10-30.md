# Phase 4.5b: Search metadata

Status: EXECUTED 2026-10-28. All 30 bundled cards drafted, then read and approved by a maintainer.
Acceptance tests: traced

Editorial extension: integrated with maintainer approval to land, 2026-10-28.
The richer descriptions, SEO copy and project examples preserve main's approved
discovery wording. [metadata-decoration.md](../metadata-decoration-2026-10-30.md) records
the contract, checks and approval provenance for all 30 enriched cards.

| Field | Value |
|---|---|
| Goal | Every bundled stack and fragment carries reviewed discovery and directory metadata (bounded search phrases and facets, a fuller description, SEO prose and illustrative project examples) in one sidecar outside the entry, keyed to its content digest and checked by `stacks validate`; a maintainer-only script or isolated drafting agent prepares it, and a person reviews it |
| Traces to | The coding agent asked for a product rather than a stack id ("ambiguity"). An entry's frontmatter says what it is made of (`astro`, `make`, `bun`); a request says what it is for ("a blog", "an iPhone app"). Metadata bridges the two. Golden set pools `platform`, `paraphrase` and `trap` (4.5a) |
| Depends on | 4.5a (the set that measures whether metadata helps), 1.5 (`validate` and its findings), 3.1b (the authoring guide, `create --from`), 2.0a (the per-entry inputs of `fingerprint`, which the digest reuses). Soft: 4.0a (with it, test 3 also checks `bundleDigest`), 4.0c (the signed `v1/search.json` for index entries), 4.0d (the CLI reads it), 3.2a (a project entry's trust digest covers its sidecar) |
| Blocks | 4.5c |
| Decisions needed | [D37](../../requirements.md#proposed-decisions) (search metadata is a reviewed sidecar outside the entry, drafted by a maintainer script, never by the CLI or the server). [Open question 39](../../risks-and-open-questions.md#open-questions-for-the-maintainers) (no server-side decoration, so entries outside this repository get no card unless their author writes one). The vocabulary's first values are a proposal for the maintainers |
| Settles | `SearchMetadata` and `SearchVocabulary` (in the CLI until 4.5e), where sidecars live and why, the content digest and staleness, the `validate` findings, the drafting script (prompt versioning, model, cost cap, failures, review stamp), and where the D2 boundary sits |

## Scope

In:

- `SearchMetadata` and `SearchVocabulary` in `packages/cli/src/schemas/search.ts`, and `packages/cli/registry/search/vocabulary.json`. Under D11 a schema moves to a shared package only when a second package reads it: `packages/format` doesn't exist until 4.0a, and the first other reader is the API in 4.5e, which moves both schemas to `packages/format` (additive) and publishes them before the API uses them.
- Sidecars at `<registry root>/search/<kind>/<id>.json`, read from every origin root the `Registry` service reads, so a user or project registry may carry them too. For a project that is `.stacks/search/` (roadmap, Contracts: Project metadata).
- The vocabulary is read from the bundled registry only. A `search/vocabulary.json` in a user, project or source root is never read, and `validate` of that root reports it as the note `vocabulary-ignored`, so no root a cloned repository controls can redefine aliases.
- `validate` findings `search-invalid`, `search-orphan`, `search-missing`, `search-stale`, `search-unreviewed`, `search-size`.
- A sidecar for every bundled entry, drafted, reviewed and committed.
- `packages/cli/scripts/decorate.ts` (`bun run decorate`), maintainer-only, outside the shipped command tree.
- With 4.0c: `build:index` writes the signed `v1/search.json` for index entries; with 4.0d, `RemoteIndex` fetches and caches it with the index.

Out:

- Ranking (4.5c) and embeddings (4.5d).
- A decoration job on the server, a decorations table in D1, and any review UI ([open question 39](../../risks-and-open-questions.md#open-questions-for-the-maintainers) records what that leaves uncovered).
- Adding search fields to entry frontmatter.
- `create` writing a sidecar skeleton (below). `create --from` copying an existing sidecar is in.

## Design

### What the metadata is

```json
{
  "schemaVersion": 1,
  "kind": "stack", "id": "mobile-expo",
  "source": { "digest": "sha256:…", "by": "drafted", "model": "<model id>",
              "promptVersion": 1, "reviewedAt": "2026-11-02" },
  "summary": "A phone app for iOS and Android with its own API and database.",
  "platforms": ["ios", "android", "mobile"],
  "productKinds": ["mobile-app", "fullstack"],
  "languages": ["typescript"],
  "requests": ["an iPhone app with a backend", "a React Native app that talks to my API",
               "a mobile app for iOS and Android with sign-in"],
  "useCases": ["consumer mobile apps", "apps that need their own API and Postgres"],
  "synonyms": ["react native", "expo", "iphone", "phone app", "app store"],
  "goodFor": ["one codebase for iOS and Android", "a typed client from app to API"],
  "notFor": ["native Swift or Kotlin projects", "games"],
  "caveats": ["HealthKit, Apple sign-in and other entitlements need a signed development build, not Expo Go"]
}
```

| Field | Rule | Read by |
|---|---|---|
| `summary` | One sentence, at most 25 words, in a user's words rather than the tools' | 4.5c (lexical field, and shown with each hit); 4.5d (embedded) |
| `platforms` | Stacks only. Values from the vocabulary only | 4.5c's platform match and penalty; 4.5d |
| `productKinds` | Stacks only. Values from the vocabulary only | 4.5c; 4.5d |
| `languages` | Stacks only. 1 to 3 values from the vocabulary: the languages a person writes in the generated project, not every language a build tool happens to use | 4.5c's language match and penalty; 4.5d |
| `capabilities` | Fragments only. 0 to 3 values from the vocabulary: the need the fragment meets ("sign-in", "a database"). A fragment with no fitting value (a library such as `effect`) leaves it empty and is found through its free-text fields | 4.5c; 4.5d |
| `requests` | 3 to 5 requests a person might type, at most 15 words each | 4.5c (the strongest free-text field); 4.5d (one vector each, best match per entry) |
| `useCases`, `synonyms`, `goodFor` | Short phrases; at most 6, 12 and 4 | 4.5c |
| `notFor` | At most 4 phrases | 4.5c's penalty |
| `caveats` | Optional; at most 3 sentences of at most 25 words, stating material platform or operating limits such as signing, memory-only history or access without authentication | 4.5c shows them with the hit, unscored, so the agent can tell the user before `new`. Never scored, so a caveat can't push a stack up or down |
| `description` | Optional nonblank prose, at most 120 words. Explains the recipe's shape, what its first working slice proves and the work needed for a product | Directory detail copy and agent comparison; unscored and unembedded |
| `seoDescription` | Optional nonblank prose, at most 160 Unicode code points. A distinct, useful sentence rather than a keyword list | Directory page meta description only; unscored and unembedded |
| `projectExamples` | Optional list of 1 to 3 illustrative possible projects. Each closed object has nonblank `title` (8 words maximum), nonblank `description` (35 words), optional `stack` id and optional `withFragments` (at most 3 distinct fragment ids) | Directory's “What you could build” section and agent comparisons; unscored and unembedded |

The existing search text (`summary`, `requests`, `useCases`, `synonyms`, `goodFor`,
`notFor` and `caveats`) stays within 150 words (`search-size`). The three editorial
fields have their own limits and do not spend that budget. A longer description
must not gain search weight simply because it repeats more terms. Facet values
and provenance do not count as free text.

### Proposed editorial enrichment

These additive choices extend D37's proposal; they are prepared for maintainer
review, not new settled decisions. The fields remain optional in schema version 1
so existing author cards, carried-forward publications and fixtures decode without
a migration. All 30 bundled draft cards include them. New drafting prompts ask for
them, using prompt version 2.

The three descriptions have separate jobs. Entry frontmatter `description` stays
the authoritative technical recipe synopsis and the existing CLI fallback.
`summary` is the short search-hit sentence. On a directory detail page, prefer
a reviewed sidecar `description` when present and fall back to the entry
description. An unreviewed card needs a draft label and must not replace reviewed
public copy silently. A stale card retains its staleness label rather than
claiming to describe the current recipe. No CLI result changes in this amendment;
the directory and comparison consumers use this contract when implemented.

For page metadata, use reviewed `seoDescription` when available, then reviewed
`summary`, then the entry description. The 160-character limit is an editorial
budget, not a search-engine rule or a promise that a snippet will be shown.
[Google's snippet guidance](https://developers.google.com/search/docs/appearance/snippet)
allows other page content and device-dependent truncation.

Examples are ideas for products to build with a recipe, not delivered product
features. For a stack card, its own id is the host; an explicit `stack` must match
it. A fragment example must name a real host `stack`. `withFragments` names
additional selections beyond the entry and host's default composition. For example:

```json
{
  "title": "Equipment inventory",
  "description": "Add postgres for persistent equipment records, then build FastAPI resources and browser editing screens. User accounts and permissions need a separate implementation.",
  "withFragments": ["postgres"]
}
```

This example belongs to `python-react`. The same example on the `postgres`
fragment names `"stack": "python-react"`; that fragment is already implicit and
need not name itself in `withFragments`. Validation uses existing fragment
selection rules on that concrete host with the default preset and no personal
always-fragments. Missing references, applicability warnings, dependencies,
conflicts and multiple apps are `search-invalid`. Selection checks metadata;
they never render or traverse every entry's files for each example.

Examples and descriptions must identify extra product work such as tables,
ownership rules, provider clients and native permissions. Auth, payments,
persistence or AI features cannot be implied by a generic product idea. Apps
remain fragments with `category: app`; category, compatibility, requirements,
tools and dependency roles come from frontmatter rather than duplicated sidecar
facets. Runtime/proof status, license and origin come from their existing sources.
No guessed domain, difficulty, readiness, price or compliance fields are added.

Stacks and fragments answer different requests, so their closed fields differ. A stack is a project, found by where it runs, what it is and what it's written in. A fragment is a need added to a project ("sign-in for my mobile app"), found by what it provides; where it runs comes from the stacks it applies to (`applies_to`, which 4.5c's platform and language rules already read), so a fragment card never repeats it. `SearchMetadata` is a union on `kind`: a stack card has `platforms`, `productKinds` and `languages` and no `capabilities`; a fragment card has `capabilities` and none of the other three. A fragment card for `clerk`:

```json
{
  "schemaVersion": 1,
  "kind": "fragment", "id": "clerk",
  "source": { "digest": "sha256:…", "by": "drafted", "model": "<model id>",
              "promptVersion": 1, "reviewedAt": "2026-11-02" },
  "summary": "User sign-up, sign-in and sessions handled by Clerk instead of your own auth code.",
  "capabilities": ["auth"],
  "requests": ["add login to my app", "users should be able to sign up with Google",
               "I need accounts and sessions"],
  "useCases": ["apps with user accounts", "social sign-in"],
  "synonyms": ["login", "sign up", "oauth", "user accounts", "sessions"],
  "goodFor": ["auth without running your own user table"],
  "notFor": ["self-hosted auth", "machine-to-machine API keys"]
}
```

Domain words ("health", "fitness", "finance") are deliberately not listed per stack: no bundled stack is specific to a domain, and listing "health" under `mobile-expo` would be a guess that turns into a ranking claim. A domain word in a request is answered by the platform and product kind it comes with ("an iOS health app" is an iOS app); 4.5c treats a domain word as unmatched rather than inventing a match. What a domain needs from the platform goes in `caveats` instead, stated as a capability rather than a domain: `mobile-expo`'s card says entitlements such as HealthKit need a signed development build, which is what an agent answering "an iOS health app" should tell the user.

### The vocabulary

`registry/search/vocabulary.json` is a closed list the maintainers own:

```json
{ "schemaVersion": 1,
  "platforms": { "ios": ["ios", "iphone", "ipad"], "android": ["android"],
                 "mobile": ["mobile", "phone", "app store"], "web": ["web", "website", "browser"],
                 "desktop": ["desktop", "macos", "mac app", "windows", "linux desktop"],
                 "cli": ["cli", "command line", "terminal"], "server": ["server", "backend", "api"] },
  "productKinds": { "blog": ["blog", "posts"], "content-site": ["static site", "docs site", "marketing site"],
                    "api": ["api", "rest", "http service"], "web-app": ["web app", "saas", "dashboard"],
                    "mobile-app": ["mobile app", "phone app"], "desktop-app": ["desktop app"],
                    "cli-tool": ["cli tool", "command line tool"], "ai-app": ["chat", "llm", "ai"],
                    "fullstack": ["full stack", "frontend and backend"] },
  "languages": { "typescript": ["typescript", "ts", "javascript", "js", "node"],
                 "python": ["python"], "go": ["golang", "in go", "go cli", "go api", "go service"],
                 "rust": ["rust"], "swift": ["swift", "swiftui"], "kotlin": ["kotlin"] },
  "capabilities": { "auth": ["auth", "authentication", "login", "log in", "sign in", "sign-in", "sign up", "user accounts"],
                    "database": ["database", "db", "sql", "postgres", "sqlite"],
                    "analytics": ["analytics", "product analytics", "event tracking"],
                    "deploy": ["deploy", "deployment", "hosting", "host it"],
                    "ci": ["ci", "continuous integration", "github actions"],
                    "release": ["release", "releases", "publish", "binaries"],
                    "ai": ["llm", "ai", "chat", "model api"],
                    "git-hooks": ["git hooks", "pre-commit", "pre-push"],
                    "agent-harness": ["coding agent", "claude code", "codex", "agent hooks"] } }
```

Keys are the values sidecars use; the lists are the words a request may use for them (4.5c matches them as phrases). Values are kebab-case. A sidecar value not in the vocabulary is `search-invalid`. A closed list stops drafted metadata from inventing a new category per entry, which would make the platform match meaningless. Adding a value is a reviewed change, run against 4.5a's set.

An alias is unique within its category (`vocabulary-invalid` otherwise). The same phrase may appear in two categories when they rank different lists: "llm" names the product kind `ai-app` for stacks and the capability `ai` for fragments, and 4.5c ranks stacks and fragments separately. Bare "go" is not an alias of `go`, because it is an ordinary English word ("ready to go") and a false language match costs a stack its rank; the phrases cover the ways a request names the language. `swift` and `kotlin` have no bundled stack: they exist so "a native SwiftUI app" is understood as a language no stack lists, which the language rule turns into a penalty rather than a strong Expo match.

### Why a sidecar, outside the entry

Three places were possible:

| Option | Verdict |
|---|---|
| A `search:` block in `STACK.md` and `FRAGMENT.md` frontmatter | Rejected. Frontmatter is in `fingerprint` (2.0a) and the entry's bundle digest (4.0a), so rewording a synonym would make every composition of the stack "changed since last green" and, under 4.0c's proven-only serving, keep the old bundle in the index until a new bench run. Search words change for a different reason than composition and must not invalidate proof |
| A table in the API's D1, filled by a server job | Rejected. The bundled CLI works offline and would never see it; it would be a second source of truth about the registry beside this repository; review would need a UI or a cross-repository export; and an LLM key would live on the Worker for no reader the Worker has |
| A JSON file per entry under `registry/search/`, committed, reviewed in pull requests | Chosen. It ships in the bundled registry (offline search works), reaches index entries through a signed file, is reviewed as a diff, versioned by git, and sits outside every digest the proof chain uses |

`registry/search/` joins `removed.json` and `allowlist.json` as registry files that aren't entries (roadmap, Contracts: Registry files that aren't entries). The `Registry` service doesn't list it as an entry directory.

Outside `fingerprint` and `bundleDigest` doesn't mean outside trust. A sidecar changes what `search` ranks and prints (`summary`, `caveats`), so for a project entry 3.2a's trust digest (`trust/digest.ts::entryDigest`) covers the entry's sidecar too when one exists: editing a trusted project entry's card after `stacks trust` makes the entry untrusted again, as editing any of its files does (roadmap, Trust model point 2, and Contracts: Trust store). A git source's digest is over its whole checkout, so its `search/` is already covered. Until 3.2a lands, every project entry is untrusted anyway.

### Content digest and staleness

`source.digest` is `core/search/digest.ts::searchSourceDigest(entry)`: sha256 over the entry's kind, id, canonical decoded frontmatter and body, the same per-entry inputs `fingerprint` hashes, without files or adapters. Shipped files don't change what an entry is for; prose and metadata might.

When the entry changes, the sidecar is stale: `validate` reports `search-stale` and keeps using it (a stale card is still far better than none). The fix is either a new draft or, when a person reads the change and the card still holds, a restamp (`bun run decorate --restamp <id>`), which writes the new digest and today's `reviewedAt` without touching any other field.

### `validate` findings

| Finding | Severity | When |
|---|---|---|
| `search-invalid` | error | The sidecar doesn't decode (including wrong-kind fields or malformed editorial objects), a vocabulary value is unknown, `kind`/`id` don't match its path, or a project example's host and fragment selections are invalid |
| `search-orphan` | error | A sidecar names no entry in the same root |
| `search-missing` | warning in the bundled registry, note elsewhere | An entry has no sidecar |
| `search-stale` | warning | `source.digest` differs from the entry's current digest |
| `search-unreviewed` | warning | `source.reviewedAt` is null |
| `search-size` | warning | Search text exceeds 150 words, or a field exceeds its own editorial or count limit |
| `vocabulary-invalid` | error | The bundled vocabulary doesn't decode, or two values share an alias |
| `vocabulary-ignored` | note | A non-bundled root holds `search/vocabulary.json`, which is never read |

Warnings fail only the bundled registry's zero-warning test (1.5), so a bundled entry can't merge without a reviewed, current card, while a personal registry is never blocked by search.

### Drafting with a model, and where D2's line is

The CLI never calls a model (D2), and nothing here changes that: the CLI reads committed JSON. Drafting is a maintainer tool, like the bench (2.0b), that runs from this repository's checkout and is not in the packed package.

```
bun run decorate [<id>...] [--missing] [--stale] [--model <id>] [--max-usd 1.00] [--dry-run]
bun run decorate --restamp <id>
bun run decorate --approve <id>
```

- Input per entry: its frontmatter (id, name, description, tags, category, `applies_to`, dependency role names), its body, the vocabulary, two reviewed sidecars as examples, and compact recipe identity/compatibility context for selecting real example hosts and additions. The prompt is fixed text in `scripts/decorate/prompt.ts` with `PROMPT_VERSION`; changing the text bumps it. No 4.5a golden query may appear in the prompt text or its examples, and a drafted or hand-written `requests` entry may not equal, contain, or share a run of five consecutive words with any holdout query (both compared lowercased with punctuation stripped). The same people write the cards and the set, and a card that repeats the holdout split would pass the gate without searching better (4.5a, Format).
- The model is called through OpenRouter's chat completions API with JSON output requested. The default model is a mid-priced current model named in `scripts/decorate/config.ts`; `--model` overrides it; the sidecar records both the model id and `promptVersion`. Output is decoded with `SearchMetadata`; a decode failure gets one retry with the decode error appended, then the entry is skipped and listed. Transport failures (408, 429, 5xx) are retried up to three times with backoff; nothing else is retried, since the same prompt returns the same shape.
- New prompt-version-2 responses also require all three editorial fields:
  nonblank `description`, nonblank `seoDescription` and nonempty
  `projectExamples` with the schema's nonblank nested text. This requirement is
  enforced at the drafting response boundary, not merely written in the prompt.
  An old-shaped response is a correction failure even though an old stored card
  remains valid. The same single correction retry applies; two invalid responses
  write nothing and preserve any existing card. All reported costs still count.
- A draft is written with `by: "drafted"` and `reviewedAt: null`, so `search-unreviewed` holds it out of a merge until a person reads it. `--approve <id>` sets `reviewedAt`; it refuses with `PermissionDenied` under a detected agent (`AppConfig.agent` not `"none"`, reason `agent`) or without a TTY on stdin (`Host.stdinIsTTY` false, reason `no-tty`), the same rule as other confirmations (roadmap, Trust model, point 4), because the point is that a person read it.
- Cost: the script reads the per-request cost OpenRouter reports, stops before a request would pass `--max-usd` (default 1.00), and prints the total. `--dry-run` prints each prompt's size and an estimate without calling anything. Dozens of entries at a few thousand tokens each cost cents.
- Secrets: `OPENROUTER_API_KEY` is read from the maintainer's environment only, through the script's config, never written to a file, a sidecar or a log line; the request log records model, entry id, tokens and cost.
- An author can skip the script entirely and write the sidecar by hand (`by: "author"`); `validate` treats both the same.
- A maintainer may instead dispatch coding agents (one per entry, such as Codex delegates) to draft cards. The agent's brief is the script's prompt text and examples at the current `PROMPT_VERSION`, and its inputs are the same: the entry, vocabulary, two example sidecars and compact recipe references. The agent works in a checkout without `tests/fixtures/search/golden.json` and is told not to read 4.5a's set, because an agent that can grep the golden queries will echo them, and test 13a catches only copies and five-word runs, not close paraphrases. The card records `by: "drafted"`, `model` naming the agent and its model, and the `promptVersion` it was briefed with. Review and `--approve` are unchanged: the agent leaves `reviewedAt` null, and `--approve` refuses to run under it.

`create <kind> <id>` writes no sidecar skeleton: a personal registry of a few entries doesn't need search, and an empty card would be noise. `create --from <origin>` copies the origin entry's sidecar, when it has one, to `search/<kind>/<id>.json` in the user root with `source` unchanged, in the same exclusive-mode write as the entry. Without that, `create --from bundled mobile-expo` would shadow the bundled entry with a copy that has no card, and the user's own copy would rank below where the bundled one did. The copy's digest still matches until the user edits the entry; after that `validate` of the user root reports `search-stale`, a warning, which never blocks a personal registry. The authoring guide (`docs/authoring.md`) documents the file for authors contributing to the bundled registry.

### Index entries

With 4.0c, `build:index` reads each indexed entry's sidecar and writes `v1/search.json`, a `SignedIndex` envelope over `{ formatVersion: 1, entries: SearchMetadata[] }`, signed with the index key and checked by `build:index --check`. A sidecar whose digest doesn't match the indexed bundle's entry is written anyway with `stale: true`, so a carried-forward entry keeps its card. With 4.0d, `RemoteIndex` fetches it beside the index under the same refresh, signature and backoff rules, and the CLI treats it as the sidecar of each index entry.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/schemas/search.ts` | `SearchMetadata`, `SearchVocabulary` (4.5e moves them to `packages/format`; 4.5c adds `SearchResult` to this file) |
| `packages/cli/src/project-layout.ts` | The project's `.stacks/search/` path |
| `packages/cli/src/core/create.ts` | `create --from` copies the origin's sidecar |
| `packages/cli/registry/search/vocabulary.json`, `registry/search/{stacks,fragments}/<id>.json` | New: the vocabulary and one reviewed sidecar per bundled entry |
| `packages/cli/src/core/search/digest.ts`, `src/core/search/sidecar.ts` | `searchSourceDigest`; reading sidecars for an origin root through `Registry` |
| `packages/cli/src/core/registry/registry.ts` | `Registry` reads `search/` beside each root's entry directories without listing it as entries |
| `packages/cli/src/core/validate/search.ts`, `validate/index.ts` | The findings above |
| `packages/cli/scripts/decorate.ts`, `scripts/decorate/` | The drafting script, prompt, config |
| `packages/cli/scripts/build-index.ts` | `v1/search.json` (with 4.0c) |
| `packages/cli/src/core/remote-index.ts` or its 4.0d module | Fetch and cache `v1/search.json` (with 4.0d) |
| `packages/cli/docs/authoring.md`, `docs/maintaining.md` | The sidecar for contributors; drafting and review for maintainers |
| `packages/cli/tests/` | New |

## Acceptance tests

1. Every bundled entry has a sidecar that decodes, is current (`search-stale` absent) and reviewed; the bundled registry stays at zero warnings.
2. Changing one word of a bundled stack's body makes `validate` report `search-stale` for that entry only; `bun run decorate --restamp <id>` clears it and changes only `source.digest` and `source.reviewedAt`.
3. Editing a sidecar doesn't change the stack's `fingerprint`, and `validate`'s "changed since last green" check for its compositions is unaffected. Once 4.0a has landed, the same test also asserts the bundle digest (`bundleDigest`) is unchanged.
4. A sidecar with `platforms: ["ios", "watchos"]` is `search-invalid` naming `watchos`; one at `search/stacks/x.json` with `id: "y"` is `search-invalid`; one naming a missing entry is `search-orphan`.
5. A user registry with entries and no sidecars gives `search-missing` as a note and exits 0.
6. A vocabulary where `mobile` and `ios` share the alias `phone` is `vocabulary-invalid`.
7. A sidecar of 180 words gives `search-size`.
8. `bun run decorate --dry-run mobile-expo` makes no network request and prints the prompt size; against a local fake OpenRouter server, `bun run decorate mobile-expo` writes a sidecar with `by: "drafted"`, the model id, `promptVersion` and `reviewedAt: null`.
9. The fake server returning invalid JSON twice: the entry is skipped, listed, and no file is written; returning 429 then success: one sidecar written after a retry.
10. With the fake server reporting a cost that would pass `--max-usd 0.01` on the second entry, the script stops before the second request and prints the total.
11. `--approve` under a detected agent exits with `PermissionDenied` (reason `agent`); with no agent and stdin not a TTY it exits with `PermissionDenied` (reason `no-tty`); in both cases `reviewedAt` stays null. With no agent and a TTY it sets `reviewedAt`.
12. No log line and no written file contains the value of `OPENROUTER_API_KEY` (the test sets a sentinel and scans everything written).
13. The packed package's file list contains nothing under `scripts/`, and the bundle `dist/cli.mjs` contains no string `openrouter.ai`. (Shipped registry files already mention `openrouter.ai`, in the OpenRouter fragments and `typescript-api`, so the tarball as a whole can't be scanned for it.)
13a. The prompt `scripts/decorate/prompt.ts` builds for every bundled entry, examples included, contains no 4.5a golden query string; no bundled sidecar's `requests` entry equals, contains or shares five consecutive words with a holdout query; a fixture sidecar copying a holdout query fails the test, naming both.
13b. `validate` of a project registry holding `.stacks/search/vocabulary.json` reports `vocabulary-ignored` as a note, and a search over it uses the bundled aliases.
13c. `caveats` with four items, or one of 30 words, is `search-size`; a sidecar without `caveats` decodes.
13d. A stack card with `capabilities: ["auth"]`, a stack card without `languages`, and a fragment card with `platforms: ["ios"]` are each `search-invalid`; a fragment card with `capabilities: []` decodes.
13e. A vocabulary where `typescript` and `python` share an alias is `vocabulary-invalid`; one where the product kind `ai-app` and the capability `ai` share `llm` is valid; no alias of `go` is the bare word `go`.
14. With 4.0c: `build:index` writes `v1/search.json` that verifies with the test key and holds one sidecar per indexed entry; `--check` fails when one byte of it changes. With 4.0d: an index entry's sidecar comes from the cached file, and a bad signature leaves index entries without sidecars and bundled ones unchanged.

### Realistic edge cases

15. A stack and a fragment with the same id each get their own sidecar under `search/stacks/` and `search/fragments/`.
16. A project-origin registry with a sidecar that stuffs one word fifty times decodes (it is only text) and is held to the field counts by `search-size`; ranking treats it as untrusted (4.5c).
17. A sidecar file with a byte order mark or CRLF line endings decodes the same as without.
18. A registry root with `search/` but no `stacks/` or `fragments/` lists no entries and reports every sidecar as `search-orphan`.
19. `create stack mobile-expo --from bundled` writes `search/stacks/mobile-expo.json` in the user root with the bundled sidecar's bytes; `validate` of the user root reports no `search-missing` for it; `create --from` an entry with no sidecar writes none; a second `create --from` into an existing target leaves both files unchanged.
21. Optional `description`, `seoDescription` and closed `projectExamples` objects round-trip for both kinds and through index/copy paths; older cards decode unchanged. Editorial text has separate size warnings and does not consume the 150-word search budget. Example host and fragment references must compose without applicability warnings, missing dependencies, conflicts or multiple apps; valid optional additions pass.
22. Prompt version 2 distinguishes short search copy, fuller description, SEO prose and illustrative projects, carries real recipe reference context, and retains honest draft provenance and the human approval guard. Its new-response boundary requires all three editorial fields, nonblank text and nonempty examples. Missing/blank editorial data gets exactly one correction retry; a corrected complete reply writes one unreviewed v2 draft, while two invalid replies write nothing and preserve an existing card. Legacy stored/copied/index cards still decode unchanged. Mock new-draft success responses carry editorial fields without changing the original retry, budget, secret or provenance assertions.

## Deferred acceptance coverage

20. With 3.2a landed: editing the sidecar of a trusted project entry makes `list --json` report it `trusted: false`.

## Exit criteria

- Acceptance tests pass; the gate green.
- Every bundled sidecar reviewed by a maintainer, and 4.5a's set run against the 4.5c ranking with and without them, the difference recorded in 4.5c.

## What this plan may get wrong

- 2026-10-27: one 150-word budget cannot also carry useful directory descriptions and practical projects. The optional editorial fields have separate caps and explicit consumers. Ranking and embeddings use their existing allowlist; they must not flatten every string in an enriched card. A draft card is reviewable output, not proof of a finished application. The maintainer authorized landing all 30 enriched cards on 2026-10-28; their agent authorship remains recorded.
- 2026-10-27: optional storage fields do not enforce a new draft's completeness.
  The drafting client adds that response-boundary check so a legacy-shaped model
  reply cannot be written with a version-2 provenance stamp. Draft-only test
  responses migrate to the new contract; legacy storage fixtures remain intact.

- 2026-10-27: restamping must refuse a card whose `reviewedAt` is null, otherwise an agent can use it to bypass the human-only approval guard. Restamp refreshes an existing review; initial approval still requires a person.

- 2026-10-27: the implementation-only unit excludes bundled cards, but locked tests 13a, 19 and the HTTP prompt example assertion also read those cards. Those checks need the separate card unit before they can pass; item 1 is not the only card-dependent test. Existing exact-finding assertions and index fixtures also need updates for missing-card findings; synthetic bundled roots, including the installed-binary registry-real fixture, need a vocabulary to retain their previous validation outcomes.

- 2026-10-27: acceptance test 14 traces only the landed 4.0c build and signature checks. The 4.0d `RemoteIndex` half is outside this unit because its implementation is on another branch.
- 2026-10-27: "stops before a request would pass `--max-usd`" didn't say how the next request's cost is known. The script estimates it as the highest per-request cost reported so far in the run (the first request always goes if any budget remains), so the cap errs toward stopping early.
- 2026-10-27: `validate` of a root with `search/` and no `stacks/` or `fragments/` fails today with `NotFound`. Item 18 keeps the plan's rule: such a root lists no entries and reports every sidecar as `search-orphan`.
- 2026-10-28: 13a's "no golden query string" can't hold for a golden query that is itself a closed-vocabulary alias: "go cli" is both query `platform-go-short` and an alias of `languages.go`, and the vocabulary is in every prompt. Such a query is excluded from that check, since the vocabulary is matched literally and can't paraphrase it into a card. The card writer, not Biome, owns card bytes (`JSON.stringify` with two spaces, schema field order with `kind` beside `id`; the formatter is off for `registry/search/`), so `--approve` changes one line, and a test holds every bundled card to those bytes.
- 2026-10-27: acceptance test 20 needs deferred 3.2a trust storage. It is moved outside the traced acceptance section into Deferred acceptance coverage, preserving its number and intent until that prerequisite lands.

- Keying staleness to the body means every prose fix marks the card stale. If restamping becomes busywork, key the digest to frontmatter only and accept that a body rewrite can leave a card describing the old entry.
- The vocabulary will be too coarse for some requests and too fine for others. It is a closed list on purpose; grow it only when a golden query needs a value no existing one covers.
- A model drafting cards from bodies written by the same maintainers may echo the bodies' tool names instead of users' words. The prompt asks for users' words and the two examples show them; the review is the real check.
- 2026-10-27: the plan put `SearchMetadata` in `packages/format`, which doesn't exist before 4.0a, and tested `bundleDigest` without depending on 4.0a. The schemas now live in the CLI until 4.5e gives them a second reader (D11).
- The request was for metadata "authored or LLM-decorated through OpenRouter on the server". This plan keeps decoration in a maintainer script and rejects the server. The cost is that entries from outside this repository (git sources, 3.2a; future community index entries) get no card unless their author writes one; open question 39 asks whether that is acceptable.
- Leaving domain words out may lose queries where a fragment is domain-specific (a payments fragment for "a shop"). When such a fragment exists, its `useCases` say so in plain words; the rule is against guessing, not against domains.
- 2026-10-27: the first draft gave every card `platforms` and `productKinds` and had no field for language. A fragment has no product kind of its own, so drafters would have guessed one, and nothing let a "command line tool in Python" request rule out `go-cli`: the platform matched, "python" matched `python-react`'s name, and `go-cli` reached `strong` on half the request. Cards are now a union on `kind`: stacks add `languages` (4.5c gains a language rule beside the platform rule), fragments carry `capabilities` instead of platforms and kinds. Drafting by dispatched coding agents is allowed under the same inputs and review, with the golden set kept out of their checkout.
- Six languages and nine capabilities cover today's 10 stacks and 20 fragments. A fragment for a need outside the list (payments, email, search) adds a value in the same change, run against 4.5a's set.
