# Phase 4.5f: Plain-language metadata

Status: EXECUTED 2026-10-29. Copy drafted by Codex, rewritten for non-developers by Claude Haiku agents, and approved by a maintainer; the stacks-api site pages and the 4.2e `DEPS_ENABLED` split are the follow-up in that repository
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | Every bundled stack, fragment and allowlisted dependency carries reviewed plain-language copy (what it is, what it's good at, an example, what it's not good at); `show` leads with it, `validate` checks it, and the index publishes the dependency copy for the directory site |
| Traces to | A person browsing the directory or reading `show` output who doesn't already know what React Router, Clerk or `pytest-randomly` is. The 4.5b editorial copy is technical and the `goodFor`/`notFor` phrases are search keywords; dependency pages (4.2e) say nothing before telemetry publishes |
| Depends on | 4.5b (the sidecar, `source`, `search-size`), 4.2d (the allowlist), 3.1a (`show`), 4.0c (signed documents) |
| Blocks | Nothing; the stacks-api pages follow in that repository |
| Decisions needed | D40 (decided 2026-10-29) |
| Settles | `SearchMetadata.plain`, `DependencyCard`, `DependencyCardFile`, `DependencyCards`, `registry/deps/<ecosystem>.json`, `v1/deps.json`, the `plain-*` and `deps-*` findings, and what `show` prints from them |

## Scope

In: the `plain` sidecar field; per-ecosystem dependency card files in the bundled registry; their `validate` findings; `show` output in all three audiences; `v1/deps.json` in `build:index` and `--check`; the drafted copy for all bundled entries and allowlisted names, approved by a maintainer before it lands.

Out: `search` output and `SearchHit` (see Design); `list`; the composed brief; a dependency command; dependency copy for user, project or index registries; reading `v1/search.json` or `v1/deps.json` from the CLI; the site pages (stacks-api, after this lands).

## Design

### Entry copy: `SearchMetadata.plain`

An optional object on both `SearchMetadata` kinds, unscored and unembedded like 4.5b's editorial fields:

```json
"plain": {
  "whatItIs": "A starter for a website whose pages are built on the server, so they load fast and read your own data directly.",
  "goodAt": ["Sites with forms and pages that show data from your own backend"],
  "notGoodAt": ["Purely static sites you want to host for free on a CDN"]
}
```

`whatItIs` is nonblank prose; `goodAt` and `notGoodAt` hold 1 to 3 nonblank items. The example on every surface is `projectExamples[0]`; entries get no separate example field. Editing `plain` changes no fingerprint, bundle digest or run evidence, and ranking's field allowlist doesn't include it. `plain` is not added to `SearchHit`: `SearchResponse` is columnar and `columnar.ts` rejects any column set that differs from the schema, so a new column would break every installed CLI's decode of the API's response.

### Dependency copy: `registry/deps/<ecosystem>.json`

One file per ecosystem in the bundled registry (`npm.json`, `pypi.json`, `crates.json`, `go.json`), keyed by the name exactly as `allowlist.json` spells it, so no filename encoding is needed:

```json
{ "formatVersion": 1, "cards": { "hono": { "whatItIs": "...", "source": { ... } } } }
```

`DependencyCard`: `whatItIs` (required), `goodAt` and `notGoodAt` (optional, 1 to 3 items), `example` (optional), `homepage` (optional, `https:` only) and `source` (`by`, `model`, `promptVersion`, `reviewedAt`; no digest, since there is no recipe to hash). `DependencyCardFile` is one file; `DependencyCards` (`formatVersion`, `generatedAt`, `cards` keyed by ecosystem then name) is the published document. All three live in `packages/format/src/deps/` because the site build decodes them. Copy is version-neutral. Type, font and lint-plugin packages get only a templated `whatItIs`.

### Validation

Findings use the existing `search-size` for length and `search-invalid` for structure, plus new `deps-*` codes:

| Check | Finding | Severity |
|---|---|---|
| `whatItIs` over 30 words, a `goodAt`/`notGoodAt` item over 15, more than 3 items, `example` over 40 | `search-size` | warning |
| A version-looking token (`/\bv?\d+(\.\d+)+\b/` or `\d+\.x`) in any plain text | `plain-versioned` | warning |
| A dependency card file that doesn't decode, or a card naming a name not on that ecosystem's allowlist | `deps-invalid` | error |
| One name on two ecosystems' allowlists | `deps-ambiguous` | error |
| A name a bundled entry's `deps` uses with no card | `deps-missing` | warning |
| A card with `source.reviewedAt: null` (a draft) | `deps-unreviewed` | warning |
| A card whose `reviewedAt` is more than 365 days before today | `deps-review-due` | note |

The `deps-*` checks run only on the bundled registry root (or a root holding `allowlist.json`); user and project registries have neither file. `deps-missing` lands with the cards, so the zero-warning bundled-registry test never goes red in between.

### `show`

`showReport` reads the entry's own sidecar through `Registry.search`, and the bundled dependency cards through a new `Registry` read of `deps/<ecosystem>.json` from the bundled root only (as `vocabulary` is), once per invocation. `ShowReport` gains optional `plain` (with `example`, the first project example's title and description) and optional `dependencyCards`, keyed `<ecosystem>/<name>` for the entry's deps. Missing copy prints nothing.

Text, human and agent alike, follows the name line with `whatItIs`, then `Good at:`, `Example:`, `Not good at:`, before the existing description. A sidecar whose `source.digest` differs from `searchSourceDigest` is labelled `(written for an earlier version of this entry)`. An untrusted entry's block is labelled `(from the entry's author, not reviewed by stacks)`. In human mode the `app` dependencies print one per line with their `whatItIs`; the `dev` list and agent mode keep `Dependencies (<role>): a, b, c`. Agents get the entry copy because they don't know a project's own stacks, but not the dependency copy, since they know what `hono` is. All text passes through the existing `safeLine`/`printable` escaping.

### Index

`build:index` publishes `v1/deps.json` in the `SignedIndex` envelope beside `v1/allowlist.json`, built from the card files (an ecosystem with no file publishes `{}`). `--check` fetches and verifies it. The CLI never fetches it; the site build is its reader and verifies the signature.

## Files and areas touched

`packages/format/src/search/schema.ts`, `packages/format/src/deps/`, `packages/format/src/index.ts`; `packages/cli/src/core/registry/registry.ts`, `src/core/validate/` (`search.ts`, a new `deps.ts`, `index.ts`), `src/core/show.ts`, `src/core/show-report.ts`, `src/schemas/show.ts`; `packages/cli/scripts/index/` (`publish.ts`, `remote.ts`, the build entry); `packages/cli/registry/deps/`, `packages/cli/registry/search/`.

## Acceptance tests

1. A sidecar with `plain` decodes for both kinds and round-trips through copy (`create --from`) and index assembly unchanged; a sidecar without it decodes as before.
2. `plain` with `goodAt: []`, a blank `whatItIs`, or an excess key is `search-invalid`.
3. A `whatItIs` of 31 words, a `goodAt` item of 16 words, or four `notGoodAt` items is `search-size`; a `plain` text containing `React 19.1` or `v4.x` is `plain-versioned`.
4. Editing `plain` changes neither the entry's `fingerprint` nor its `bundleDigest`, and a synthetic ranking whose only difference is `plain` text returns the same order and scores.
5. `SearchHit`'s fields and the columns of an encoded `SearchResponse` are unchanged by this sub-phase.
6. A `DependencyCardFile` decodes; a card without `whatItIs`, with `homepage: "http://..."`, or with an excess key fails; `DependencyCards` decodes with all four ecosystems.
7. `validate` of a registry whose `deps/npm.json` names a package not in `allowlist.json`'s npm list is `deps-invalid` and exits 2; a malformed `deps/npm.json` is `deps-invalid`.
8. A name in both the npm and pypi allowlists is `deps-ambiguous`.
9. With a bundled entry depending on `hono` and no card for it, `validate` warns `deps-missing` naming `npm/hono`; with the card, it doesn't.
10. A card reviewed 400 days before the test clock gives `deps-review-due` as a note and exits 0; a card with `reviewedAt: null` gives `deps-unreviewed` as a warning.
11. A user registry with entries and no `allowlist.json` or `deps/` reports no `deps-*` finding.
12. `show <stack> --json` includes `plain` (with `example` from `projectExamples[0]`) and `dependencyCards` for its deps; an entry with no sidecar, or a sidecar with no `plain`, omits `plain`, keeps `dependencyCards`, and still exits 0; with no card for any of its deps, `dependencyCards` is omitted.
13. Agent-mode `show` prints the `whatItIs` line and `Good at:`, `Example:` and `Not good at:` before the description, and keeps `Dependencies (app): ...` as one line.
14. Human-mode `show` prints each `app` dependency with its `whatItIs` on its own line and keeps the `dev` role as one line.
15. A sidecar whose digest no longer matches the entry prints the earlier-version label; an untrusted entry's block prints the author label; a `whatItIs` holding an escape sequence prints escaped.
16. `build:index --unsigned` writes `v1/deps.json` that decodes as `DependencyCards`; a signed build verifies with the test key, and `--check` fails when one byte of the served file changes.
17. Every bundled entry's sidecar has `plain`, every name the bundled entries use has a card, and the bundled registry stays at zero warnings.

### Realistic edge cases

18. A scoped npm name (`@tanstack/react-query`) and a Go module path (`github.com/jackc/pgx`) are looked up and shown correctly.
19. A dependency that appears in an entry's `deps` but in no card file prints only its name in human mode, without a blank or placeholder line.
20. A `deps/` file in a project or user registry root is ignored by `show` and `validate`.
21. A dependency card key with different letter case from its allowlist name is `deps-invalid`; the matching name remains `deps-missing` when a bundled entry uses it.
22. An allowlisted ecosystem with no card file publishes an empty object in `v1/deps.json`, without fabricating cards.

## Exit criteria

Acceptance tests pass and the gate is green. A maintainer has read and approved the drafted copy before it lands on main.

## What this plan may get wrong

- The 30-word `whatItIs` cap may be too tight for apps; it is a warning, so loosen it from evidence.
- 2026-10-29 (test authoring): test 12 said a missing `plain` omits `dependencyCards` too, which contradicted the design (dependency cards come from the bundled root, independent of the entry's sidecar). The test and item now keep the cards.
- 2026-10-29 (implementation): acceptance test 3 requires four plain-list items to decode and produce `search-size`, although the design says 1 to 3 items. The schema enforces a nonempty list and validation warns above three; dependency-card lists still reject four items at decode time as test 6 requires.
- 2026-10-29 (implementation): drafted dependency cards carry `deps-unreviewed` warnings until a maintainer stamps them, and `build:index` (signed or unsigned) refuses a registry with warnings, so an index carrying the cards can be built only after review.
