# Metadata decoration

Status: EXECUTED 2026-10-28 (integrated with maintainer authorization; all gate partitions passed)

The existing search sidecar carries directory copy and practical project ideas
alongside its bounded discovery fields. All 30 bundled cards retain main's
approved discovery wording and current recipe digests. The new editorial copy
is the frozen Sol-authored version, with the maintainer's authorization to land it.

| Field or source | Purpose | Consumer and boundary |
|---|---|---|
| Entry frontmatter `description` | Technical synopsis of the recipe | Existing CLI display and search input; authoritative about recipe content |
| `summary` | Short search-hit sentence, at most 25 words | Existing search results and ranking/embedding inputs |
| `description` | Recipe, first working slice and remaining product work; at most 120 words | Directory details and agent comparisons; unscored and unembedded |
| `seoDescription` | Page-meta prose; at most 160 Unicode code points | Directory metadata; unscored and unembedded; no snippet-length guarantee |
| `projectExamples` | 1 to 3 illustrative ideas; titles at most 8 words, descriptions at most 35 | Directory and agent comparisons; fragment examples name a host `stack`, and `withFragments` names extra selections |
| `requests`, `useCases`, `synonyms`, `goodFor`, `notFor` | User phrasing, fit and non-fit | Existing discovery inputs |
| Controlled facets | Stack platforms, product kinds and languages; fragment capabilities | Existing vocabulary; apps remain fragments with `category: app` |
| `caveats` | Material platform or operating limits | Displayed unscored, including signing requirements, memory history and access limits |
| `source` and recipe/index data | Authorship, approval, staleness, compatibility, tools and proof | No guessed readiness, price, difficulty or compliance claims |

Directory details should prefer reviewed sidecar description, then entry
description. Page metadata should prefer reviewed SEO prose, then reviewed
summary, then entry description. This change prepares that contract; consuming
directory pages belong to `stacks-api`. Ranking and embeddings retain their
existing field allowlist.

## Compatibility and validation

All three editorial fields are optional in schema version 1, preserving old
stored cards, fixtures and carried-forward index records. New drafting responses
must include nonblank descriptions and SEO prose plus at least one valid example.
A missing, blank or malformed field triggers the existing single correction
retry. Two invalid replies preserve the old card and write nothing. Both calls'
reported costs count toward the cap, and correction diagnostics expose only
trusted field names.

This is backward read compatibility. Older strict decoders reject the new fields.
Publishing enriched remote cards must set `RegistryIndex.minCli` to the first
release that supports them; local authors also need that decoder. This work does
not publish an index or change its compatibility floor.

The legacy 150-word search budget remains separate from editorial caps.
Structural errors are `search-invalid`; excess text is `search-size`.
Examples reuse fragment selection rules for host compatibility, dependencies,
conflicts and the one-app limit. Validation selects metadata without rendering
source files. Copy and signed index assembly preserve the added fields.

Metadata stays outside recipe frontmatter, files and adapters. Editorial edits
do not change composition fingerprints, bundle digests or historical run evidence.
Cards use the decorator's canonical field order and bytes.

## Coverage and approval

All 30 entries have distinct descriptions, SEO prose and two practical examples:
10 stacks, 18 non-app fragments and 2 apps. The 60 examples include 40 named
fragment hosts and 7 explicit extra-fragment selections. Descriptions are 52–65
words, SEO prose is 112–144 Unicode code points, and legacy search text is 69–105
words per card.

The author used `ce:writer` with Engineer, Architect and UX Writer guidance.
Copy was grounded in recipes, decoded metadata, vocabulary and teaching cards.
The architecture skill informed keeping one sidecar and separate field consumers.
Examples distinguish starter capability from product work: persistence, sign-in,
provider use and deployment are included, explicitly selected, or described as
implementation work. Transient QA omissions and timings did not become capability
claims.

Editorial copy was frozen before independent query checks. The authoring checkout
excluded the golden set, and neither the author nor coding delegate read it.
During integration, main's approved discovery fields replaced the earlier draft
search wording. Frozen editorial prose and examples remained unchanged.

The maintainer instructed this session to finish, merge to main and clean up on
2026-10-28. The integrating agent treated that as approval to land the prepared
cards and recorded `source.reviewedAt: "2026-10-28"`. This was conversational
authorization; the guarded terminal `--approve` operation was not run or changed.
All cards retain `by: "drafted"`, `model: "codex/gpt-6.1-sol"` and
`promptVersion: 2`. Future drafts still require explicit maintainer approval;
validation alone cannot supply it.

## Verification

The original draft was independently code-reviewed with no actionable findings.
A subsequent parent integration fix made the drafting response boundary require
the new fields while leaving stored legacy cards compatible. Its regressions
failed when that fix was removed. Selector regressions also established that
validation need not render source files.

The original independent full check was blocked by unreviewed cards and had
several test watchdog failures under parallel load. That historical run was not
reported as green. Main subsequently landed the approved discovery cards and
corrected the vocabulary-alias exclusion in the drafting-prompt test. The final
integration is checked against that current baseline.

A synthetic ranking regression confirms that editorial strings cannot affect
search ranking. Temporarily scoring a description changed the synthetic result
and failed the test; restoring the existing allowlist passed it. No ranking
implementation or query fixture was changed.

Final integration checks ran from a separate full checkout at a1853ba:

| Check | Result |
|---|---|
| Focused editorial, decorator and card-byte regressions | 76 passed |
| CLI suite, excluding the separate bench partition | 156 files; 2,532 passed, 3 skipped |
| Bench partition | 47 passed |
| Format package | 155 passed |
| Root hooks, scripts and acceptance trace | 378 passed, 2 skipped |
| Installed Node package | Packed, installed and ran all 35 e2e tests successfully |
| Static partition | Lint passed across 1,127 files; root and package typechecks passed |
| Built CLI validation, human and JSON | 10 stacks, 20 fragments; 0 errors, 0 warnings, 11 existing notes |
| Decorator dry run for mobile-expo | No request; actual cost $0 |
| Content preservation | All 30 discovery cards and all frozen editorial fields compared equal, excluding the documented provenance changes |

The first partitioned rr run passed five partitions; the CLI partition hit 20
five-second test watchdogs on a laptop reporting a load average above 55. It had
no assertion failures. Rerunning the entire CLI partition through rr on m4-mini
passed with the existing assertions and watchdogs. All six gate partitions thus
passed for the same source tree: 3,112 tests passed, 5 skipped, plus 35 e2e tests.
The rr log identifiers are check-20261028-014714 and check-cli-20261028-015026.
The skips vary by host/platform; this is not a claim that skipped cases ran.

The QA fixes were already on main at 2873a32. This integration adds the editorial
schema, validation, drafting behavior and cards without changing recipe content,
run evidence, lexical ranking or query fixtures. The session's temporary QA apps
were removed. The auxiliary metadata, metadata-check and QA-fix worktrees were
archived after landing, with their checkout directories and Git registrations
confirmed absent. Codex refused to archive this chat's primary QA checkout; it
remains clean and synchronized with main. The merged auxiliary branches were
removed.
