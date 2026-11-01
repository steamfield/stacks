# RFC: stacks declare their fragments; fragments stop listing stacks

Status: DRAFT 2026-11-01, awaiting one devils-advocate review.

## Problem

A fragment says which stacks it fits in `applies_to`, as stack ids or tags (`core/compose/selection.ts::fitsStack`, with a copy in `packages/format/src/search/rank.ts::fits`). Fourteen of the 23 bundled fragments use stack ids. For every one of them the admitted set is exactly the set of stacks that already list the fragment in `fragments.required`, `default` or `optional`. The fragment's list is a hand-written reverse dependency.

That list makes the relationship N×M. Adding the 27 stacks in `plans/stack-expansion-rfc-2026-10-31.md` meant editing `claude-harness` and `rest-api` to add ids, and `docker-deploy` and `goreleaser` would have needed the same. Each such edit is expensive beyond the line itself:

- `fingerprint.ts::fingerprint` hashes each composed entry's decoded frontmatter, so adding one id to `claude-harness` changes the fingerprint of every stack composing it and stales those `runs.json` proofs.
- `core/search/digest.ts::searchSourceDigest` covers decoded metadata, so the fragment's reviewed search card goes `search-stale` and needs a maintainer restamp (five cards on 2026-11-01).
- The edit lands in an entry owned by someone other than the person adding the stack.

The list exists because the alternative failed. Before the fragment audit (`plans/archive/fragment-audit-2026-10-31.md`, finding 3, D4, D5), `claude-harness` admitted `[node, bun]` and `rest-api` admitted `[api]`, and those tags let in stacks the fragments couldn't serve (mobile-expo's jest, python-react's nested frontend, envelopes the rule contradicted). So the audit replaced tags with ids. A tag said what a stack is, not whether it met the fragment's assumptions.

The reverse case matters too: a new fragment shouldn't need a manual audit of every stack to find where it belongs.

## Constraints

- `packages/format` contracts change additively (`.claude/rules/format/format.md`); `FragmentMeta` and the search ranker are shared with the hosted API.
- Admission is not trust. Trust stays `registry.ts::trustOf` by origin (architecture rule, trust model); nothing here runs anything.
- Registry-wide passes belong in `validate` and tests, never on a per-entry command path (AGENTS.md, "Code structure").
- Existing user and project entries with id lists keep working unchanged.

## Convention

Dependency systems put each side of the relationship in one place. The dependent declares what it uses (npm `dependencies`, Debian `Depends`, a Bazel target's `deps`). The provider declares constraints on capabilities, never a list of its dependents (npm `peerDependencies` ranges, Debian `Provides` and virtual packages, OSGi `Require-Capability`, Bazel `target_compatible_with` over `constraint_value`s, Kubernetes `nodeSelector` over node labels). The reverse list is derived when someone needs it (`apt-cache rdepends`, `npm ls`), never authored.

This repo already has both halves. `fragments.required|default|optional` is the dependent's declaration. Stack `tags` with a fragment's `applies_to` is the capability constraint, and `effect` and `effect-schema` already use it correctly (`applies_to: [effect]`, the audit's D4). The id lists are the one piece that breaks the convention. This RFC removes them and adds no new kind of relationship.

## Design

D1. One admission rule, owned by `packages/format`. A fragment F fits a stack S when any of these holds:

1. S lists F in `fragments.required`, `default` or `optional`;
2. F's `applies_to` names S's id or one of S's tags;
3. F's `applies_to` is empty and F is not `listed_only` (D2).

It is exported as `fragmentFits(fragment: FragmentMeta & { id }, stack: { id, meta: StackMeta })` from `packages/format/src/index.ts`, beside the entry schemas, and replaces `selection.ts::fitsStack` and `rank.ts::fits`. Every current caller of `fitsStack` takes the stack entry it already has: `compose/selection.ts`, `list.ts`, `show.ts`, `prompting.ts`, `validate/compose-each.ts`, `compositions.ts`, `conditionals-reach.ts`, `files.ts` (overlay fit), `add-compositions.ts`. A stack that's absent keeps today's behavior: `add` with no known recorded stack fits everything (`selection.ts`, "`!stack ||`").

D2. `FragmentMeta` gains `listedOnly: Boolean` (encoded `listed_only`, decoding default `false`), the same shape as `needsOwnRepo`. With `listed_only: true` and an empty `applies_to`, F fits only the stacks that list it. With `listed_only: true` and a non-empty `applies_to`, F fits listing stacks plus the matches. `listed_only` with no effect (a non-empty `applies_to` that already matches every listing stack) is legal. The app rule in `FragmentMeta`'s filter becomes "an app must name at least one stack or tag, or be `listed_only`".

D3. Migration of the bundled fragments, with no change in admission:

| Fragment | Today | After |
| --- | --- | --- |
| bun-release, claude-harness, clerk, cloudflare-d1, cloudflare-pages, docker-deploy, drizzle-postgres, effect-otlp, effect-sql-postgres, goreleaser, openrouter-ai, postgres, posthog, rest-api | stack ids equal to the listing stacks | `listed_only: true`, `applies_to: []` |
| effect, effect-schema | `[effect]` | unchanged |
| openrouter-chat, openrouter-chat-cli (apps) | one stack id | unchanged (apps name their host) |
| agent-ops, ce-plugin, ci-github, git-hooks, rr | `[]` | unchanged |

A test computes the full fragment × stack admission matrix for the bundled registry before and after and asserts it is identical, so the migration is a pure refactor. Where a fragment's body or overlays show a real capability need (claude-harness runs root vitest, rest-api needs JSON routes), the fragment may later swap `listed_only` for a trait tag; that's a per-fragment decision for its owner, not part of this change.

D4. Overlays and `stack=` branches follow D1. `validate/files.ts::overlayStackFinding` and `conditionals-reach.ts` accept a stack admitted by listing, so a stack that opts in to docker-deploy lists it and adds `fragments/docker-deploy/stacks/<id>/`, with no edit to the fragment's frontmatter. The per-pair files stay inside the fragment: they implement the fragment's contract for one host, the fragment's bundle digest covers them, and its owner reviews them.

D5. Search. A fragment inherits languages and platforms from the stacks it fits (`rank.ts`, the `platforms`/`languages` penalty and the "applies to" `notFor` penalty), so the ranker uses `fragmentFits` over the stack records it already has. A `listed_only` fragment inherits from its listing stacks rather than opting out as `applies_to: []` does today. The hosted API picks this up from the same format release.

D6. A new fragment's audit queue comes from validate. A note, `fits-unlisted`, prints one line per fragment with a non-empty `applies_to`, naming the stacks its tags admit that don't list it. It never fails a run (severity note), stays silent for empty `applies_to`, and gives the author and maintainer the review list that today requires reading every stack.

D7 (separate phase, may be dropped). Tags that `applies_to` relies on must be true. `add/tags.ts::inferTags` already derives `make`, `scripts`, `bun`, `node`, `typescript`, `go`, `python`, `rust` and `monorepo` from repository files. Split it into a pure function over a path set (with the package manifest's text) and the existing filesystem adapter, and have validate run the pure function over each stack's neutral composed snapshot (`compose/files.ts::composeFilesWithNeutral`): a stack that declares one of those tags its files contradict, or ships files implying one it doesn't declare, gets a warning. That makes the derivable tags trustworthy as constraints and keeps add mode and new mode on one vocabulary. Descriptive tags (`web`, `api`, `cli`) stay unchecked.

## What doesn't change

The manifest, run records, `fingerprint`'s algorithm, the bundle format, trust, `--with` and `--without` semantics (an unlisted `listed_only` fragment named with `--with` warns `with_not_applicable` as an unmatched one does now), the `requires` closure, and `requires_tools`.

## Costs

- Migrating 14 fragments' frontmatter changes their decoded metadata once: every default composition with one of them gets a new fingerprint (ledger proofs stale, a bench re-run per stack) and their search cards need a maintainer restamp. Doing it in the same release as other brief changes keeps it to one round.
- `@steamfield/stacks-format` needs a release before the CLI that uses `fragmentFits` (`bun run release:format` is the maintainer's step), and stacks-api adopts it to keep server ranking identical.
- A fragment's owner loses the veto over which stacks list it. A stack could list a fragment whose assumptions it breaks. For default fragments the stack's own fresh-scaffold `verify` catches it; for optional ones only the composed brief is checked (`validate` composes each optional), which is today's level too. Reviewing a stack's `fragments.*` lists becomes part of reviewing the stack.

## Alternatives considered

- Keep id lists. N×M edits, frontmatter churn in entries the editor doesn't own, and a stale ledger for every stack using the fragment on each addition.
- Tags only, as before the audit. Already tried; descriptive tags admitted stacks the fragments couldn't serve.
- Per-fragment opt-in tags on stacks (a stack adds tag `claude-harness`). No schema change, but it repeats the listing inside the stack and puts fragment ids into the `tags` field, which search scores (`rank.ts::fieldsFor`, weight 1).
- Stack-side overlays (`stacks/<id>/with/<fragment>/`). Moves the per-pair files to the stack, but splits a fragment's implementation across entries, so the fragment's bundle digest and review no longer cover its own files.
- A general provides/requires capability vocabulary with all-of matching. No bundled fragment needs a conjunction today; it would be a new contract surface for no current case.

## Work

1. Format: `listedOnly` on `FragmentMeta` with the app rule; `fragmentFits` exported with unit and property tests (listing, ids, tags, empty, `listed_only`); `rank.ts` on `fragmentFits` with a test that a `listed_only` fragment inherits its listing stacks' languages.
2. CLI: replace `fitsStack` at every caller; `validate` checks per D4 and the `fits-unlisted` note per D6; `show`/`list` "Applies to" text renders "stacks that list it" for `listed_only`.
3. Registry: the D3 migration, the admission-matrix test, card restamps listed as a maintainer step.
4. Docs: `packages/cli/docs/authoring.md`, `skills/stacks-author/references/fragment.md`, `anatomy.md` and `search-card.md`, and the repo's `fragment-authoring` and `stack-authoring` skills ("Tags are a compatibility contract").
5. D7 as its own change after 1 to 4 land.

Tests through `runCli`: `new` with a listing stack composes a `listed_only` fragment; `add <fragment>` into a project whose recorded stack doesn't list it fails as `with_not_applicable` does today; `add` with no recorded stack still admits; `validate` on a registry where a stack lists a fragment with no matching `applies_to` reports no `optional-fits` error; the matrix test above.
