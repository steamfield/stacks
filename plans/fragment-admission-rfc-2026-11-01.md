# RFC: stacks declare their fragments; fragments stop listing stacks

Status: REVIEWED 2026-11-01 by one devils-advocate pass (its findings are applied below and summarized at the end). Not yet scheduled.

## Problem

A fragment says which stacks it fits in `applies_to`, as stack ids or tags (`core/compose/selection.ts::fitsStack`, with a copy in `packages/format/src/search/rank.ts::fits`). Sixteen of the 23 bundled fragments use stack ids (14 fragments and both apps). For every one of them the admitted set is exactly the set of stacks that already list the fragment in `fragments.required`, `default` or `optional`, which the review confirmed entry by entry. The fragment's list is a hand-written reverse dependency.

That makes the relationship N×M. Adding the 27 stacks in `plans/stack-expansion-rfc-2026-10-31.md` meant editing `claude-harness` and `rest-api` to add ids, and `docker-deploy` and `goreleaser` would have needed the same. Each such edit costs more than the line:

- `fingerprint.ts::fingerprintFromFiles` hashes each composed entry's `canonicalJson(meta)`, so one id added to `claude-harness` changes the fingerprint of every stack composing it and stales those `runs.json` proofs.
- `core/search/digest.ts::searchSourceDigest` hashes the same meta, so the fragment's reviewed search card goes `search-stale` and needs a maintainer restamp (five cards on 2026-11-01).
- The edit lands in an entry owned by someone other than the person adding the stack.

The list exists because the alternative failed. Before the fragment audit (`plans/archive/fragment-audit-2026-10-31.md`, finding 3, D4, D5), `claude-harness` admitted `[node, bun]` and `rest-api` admitted `[api]`, and those tags let in stacks the fragments couldn't serve. A tag said what a stack is, not whether it met the fragment's assumptions, so the audit replaced tags with ids.

This RFC removes the frontmatter edit for fragments that ship nothing per stack (`claude-harness`, `rest-api`, `clerk`, `bun-release`, `cloudflare-*`, `effect-otlp`, `goreleaser`, `openrouter-ai`). A fragment with per-stack overlays or `stacks:when stack=` branches (`docker-deploy`, `postgres`, `posthog`, `effect-sql-postgres`, `drizzle-postgres`) still needs a per-stack edit inside the fragment, because those files implement the fragment for one host; what goes away for them is only the `applies_to` line, and D4 makes that edit checked rather than optional.

## Constraints

- `packages/format` changes are additive (`.claude/rules/format/format.md`): new optional keys, and existing exports keep their output for inputs that don't use the new keys. `FragmentMeta` and the ranker are shared with the hosted API.
- Decoded meta feeds fingerprints and search digests, so a new key must be absent when unset (`Schema.optionalKey`, AGENTS.md "Schemas"), or every entry's fingerprint changes.
- Admission is not trust. Trust stays `registry.ts::trustOf` by origin; nothing here runs anything.
- Registry-wide passes belong in `validate` and tests, never on a per-entry command path; no command may download extra bundles to decide fit.

## Convention

Dependency systems put each side of the relationship in one place. The dependent declares what it uses (npm `dependencies`, Debian `Depends`). The provider declares constraints on capabilities, never a list of its dependents (npm `peerDependencies` ranges, Debian `Provides`, OSGi `Require-Capability`, Bazel `target_compatible_with`, Kubernetes `nodeSelector`). The reverse list is derived when needed (`apt-cache rdepends`), never authored. A declared dependency doesn't override the provider's constraint: npm still checks a peer range when the dependent installs the package.

This repo already has both halves: `fragments.required|default|optional` is the dependent's declaration, and stack `tags` with `applies_to` is the capability constraint (`effect` and `effect-schema` use `applies_to: [effect]`, the audit's D4). The id lists are the piece that breaks the convention, because they encode "only these dependents" as a provider-side list. This RFC adds one way for a provider to say "only dependents that declare me", the role Kubernetes taints and tolerations play, and adds no new relationship.

## Design

D1. `FragmentMeta` gains `listedOnly: Schema.optionalKey(Schema.Boolean)`, encoded `listed_only`, absent unless set. A `listed_only` fragment fits a stack that lists it in `fragments.required`, `default` or `optional`, plus any stack its non-empty `applies_to` matches. Every other fragment keeps today's rule exactly: `applies_to` matches the stack's id or a tag, and empty fits any stack. A listing never overrides `applies_to` for a fragment that isn't `listed_only`, so `optional-fits` and the add-mode `applies_to` conflict stay as they are for those.

A fragment pulled in through another fragment's `requires` is admitted when its requirer is (the `requires` edge is a declared dependency too). So a stack listing `openrouter-chat-cli` needn't also list `openrouter-ai` and `claude-harness` to admit them.

The `FragmentMeta` app filter becomes "an app names at least one stack or tag, or is `listed_only`".

D2. One fit function, owned by `packages/format`: `fragmentFits(fragment, stack)`, where the fragment is `{ id, meta: FragmentMeta }` and the stack is `{ id, tags, listed: ReadonlyArray<string> }`, `listed` being the union of its three fragment lists. It replaces `selection.ts::fitsStack` and `rank.ts::fits`. For a fragment without `listed_only`, its output equals `fitsStack`'s for every input, which a property test pins, so `rank`'s output is unchanged for every existing input.

D3. Each caller gets the listing from data it already has, with additive fields where it has none:

- Compose (`selection.ts`), validate (`compose-each.ts`, `compositions.ts`, `conditionals-reach.ts`, `files.ts`, `add-compositions.ts`) and `prompting.ts::pickNew` hold the full stack entry; they read `meta.fragments`.
- `list.ts::projectChoices` and the add picker work on `ListRow`s. `ListRow` (`schemas/list.ts`) gains `listedOnly` on fragments and `fragments` (the union) on stacks, both optional keys, filled from the entries `list` already loads.
- `show.ts::selectionMetadata` filters `Registry.catalog` rows. `CatalogEntry` gains the stack's listing for bundled, user and project entries (read with the entry it already decodes). For index stacks, `IndexEntry` (`packages/format/src/index-schema.ts`) gains an optional `fragments` union, written by `build:index`; an index without it makes `show` print that index stacks weren't checked rather than fetch bundles.
- `rank` reads `fragments` from the stack records it is given. The index's `v1/search.json` already publishes each entry's decoded meta beside its card (`scripts/index/search.ts`), so the hosted ranker has the listings with no change to what it receives.
- Add with no known recorded stack keeps fitting everything, and keeps its one warning: `checkFit` warns `with_not_applicable` when `applies_to` is non-empty or the fragment is `listed_only`.

D4. Overlays and `stack=` branches. `validate/files.ts::overlayStackFinding` and `conditionals-reach.ts` use `fragmentFits`. New check, `overlay-missing` (error): a fragment that ships any `stacks/<id>/` overlay must ship one for every stack that fits it, so a listing can't silently admit a stack the fragment has no files for. A stack outside the bundled registry (user or project) that wants such a fragment must also have the overlay, which means a copy of the fragment in that registry (`create fragment --from bundled`) or a bundled change; `stacks submit` of a stack alone can't add one. The authoring docs say so.

D5. Output keeps meaning what it says. `applies_to: []` keeps meaning "fits any stack" in every output. `ListRow`, `SearchHit` (`packages/format/src/search/schema.ts`) and `ShowReport` gain `listedOnly`, and their human and agent text (`list-report.ts`, including the app line and the apps `Next:` hint, `search/report.ts`, `show-report.ts`) prints "Applies to: stacks that list it" (plus any ids or tags) for a `listed_only` fragment. `stacks schema list` and `stacks schema search` pick the fields up through `RESULT_SCHEMAS`.

D6. A new fragment's review queue comes from validate. A note, `fits-unlisted`, prints one line per fragment whose non-empty `applies_to` admits stacks that don't list it, naming them. It never fails a run and stays silent for empty `applies_to`.

D7. Migration of the bundled fragments, with no change in admission:

| Fragment | Today | After |
| --- | --- | --- |
| bun-release, claude-harness, clerk, cloudflare-d1, cloudflare-pages, docker-deploy, drizzle-postgres, effect-otlp, effect-sql-postgres, goreleaser, openrouter-ai, postgres, posthog, rest-api | stack ids equal to the listing stacks | `listed_only: true`, `applies_to: []` |
| openrouter-chat, openrouter-chat-cli (apps) | one stack id | unchanged |
| effect, effect-schema | `[effect]` | unchanged |
| agent-ops, ce-plugin, ci-github, git-hooks, rr | `[]` | unchanged |

Before the migration, a script writes the full fragment × stack admission matrix of the bundled registry to a committed fixture; after it, a test recomputes the matrix with `fragmentFits` and asserts it equals the fixture. `tests/bundled-compositions.test.ts` drops its own `fits` for `fragmentFits`, so its per-stack `--with` runs and `writeFragment` stay on admitted stacks. The 14 fragments' meta changes once (new key, emptied list): every default composition containing one of them (about 21 stacks; `claude-harness` alone is listed by 14) gets a new fingerprint, and the 14 search cards need a restamp.

## What doesn't change

Fit for every fragment that doesn't set `listed_only`, which includes every existing user and project entry; the manifest, run records, `fingerprint`'s algorithm and the bundle format; trust; `--with`/`--without` semantics; `requires_tools`.

## Costs

- The one-time fingerprint and card churn in D7: ledger proofs for about 21 stacks go stale and need a bench re-run, and 14 cards need a maintainer restamp. Landing it with another brief-changing release keeps it to one round.
- Release order: `@steamfield/stacks-format` with `listedOnly`, `fragmentFits`, the `SearchHit` and `IndexEntry` fields (`bun run release:format`, a maintainer step); stacks-api adopts it; then the CLI release; then the index redeploy. Older format decoders reject `listed_only` as an unknown key (`entry.ts` decodes with `onExcessProperty: "error"`). The index protects older CLIs through `minCli`; a project registry shared over git with someone on an older CLI gets those fragments rejected until they update, which is the same rule as any new key.
- A fragment owner loses the veto over which stacks list a `listed_only` fragment. For default fragments the stack's own fresh-scaffold `verify` catches a bad pairing; for optional ones only the composed brief is checked, the same level as today. Reviewing a stack's `fragments.*` lists becomes part of reviewing the stack. Fragments with overlays keep the veto through D4.

## Alternatives considered

- Keep id lists: N×M edits, churn in entries the editor doesn't own, stale proofs on every addition.
- Tags only, as before the audit: tried, and descriptive tags admitted stacks the fragments couldn't serve.
- A listing admits any fragment, ignoring `applies_to`: simpler, but it lets a stack bypass a real capability constraint (`effect`), which no dependency system allows.
- CLI-only first step: let a listing admit the id-list fragments with no format field, leaving the id lists as harmless subsets. It removes the N×M edit for new stacks without format churn, but the lists keep shipping, still look authoritative and drift; and with no field, "fits only listing stacks" can't be told apart from "fits these ids". A reasonable interim if the format release has to wait.
- Per-fragment opt-in tags on stacks: repeats the listing inside the stack and puts fragment ids into `tags`, which search scores (`rank.ts::fieldsFor`).
- Stack-side overlays: moves per-pair files into stacks, splitting a fragment's implementation across entries so its bundle digest and review no longer cover its own files.
- Checking tags against shipped files (inferring `make`, `bun`, `node` from the neutral snapshot): dropped after review. The snapshot has no lockfile or `packageManager`, `python-react` has no root `package.json`, and `rust-wasm` ships only a Makefile while tagged `node`, so most findings would be false.

## Work

1. Format: `listedOnly` (optional key) on `FragmentMeta` with the app rule; `fragmentFits` with unit tests and a property test against the old rule for fragments without `listedOnly`; `rank` on `fragmentFits` with a test that a `listed_only` fragment inherits its listing stacks' languages; optional `listedOnly` on `SearchHit` and `fragments` on `IndexEntry`.
2. CLI: `fragmentFits` at every caller (D3); `ListRow`, `CatalogEntry` and `ShowReport` fields; `checkFit`'s no-stack warning; validate's `overlay-missing` error and `fits-unlisted` note; text output per D5; `build:index` writes `IndexEntry.fragments`.
3. Registry: the matrix fixture first, then the D7 migration, `bundled-compositions.test.ts` on `fragmentFits`, card restamps listed as a maintainer step.
4. Docs: `packages/cli/docs/authoring.md`, `skills/stacks-author/references/fragment.md`, `anatomy.md` and `search-card.md`, the committed copies under `packages/cli/plugin/skills/`, `scripts/decorate/prompt.ts`'s "empty fits anywhere" instruction, and the repo's `fragment-authoring` and `stack-authoring` skills ("Tags are a compatibility contract").

Tests through `runCli`: `new` with a listing stack composes a `listed_only` fragment and one pulled in by `requires`; `add <listed_only fragment>` into a project whose recorded stack doesn't list it is a `ComposeConflict` with reason `applies_to`, as an unmatched id is today; `add` with no recorded stack admits and warns; a stack listing `effect` without the `effect` tag still fails `optional-fits`; `list --json` doesn't offer a `listed_only` fragment for an unlisting stack; `overlay-missing` fires for a listing stack with no overlay; the matrix test.

## Review record

The devils-advocate pass confirmed the audit table and the `fitsStack` caller list, and raised: listing overriding `applies_to` for every fragment (now `listed_only` only, D1); a decoding default changing every fingerprint (now an optional key); three callers without the listing (D3); overlay fragments still needing a fragment edit and a listing skipping the overlay (narrowed Problem, D4 `overlay-missing`); `applies_to: []` changing meaning in public output (D5); the bundled-compositions test and a matrix that can't be recomputed after migration (D7 fixture); the lost no-stack warning, `requires` closures, add-mode wording, release order, and false positives in tag checking (dropped). Its question about the hosted ranker is answered in D3: `v1/search.json` carries entry meta.
