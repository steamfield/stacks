# Phase 4.0e: Official names and directory

Status: EXECUTED 2026-10-27 (`v1/names.json` here; the directory site in `stacks-api`, whose build-time decoder copies the format v1 schemas until `@steamfield/stacks-format` is published)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | The index build also writes a signed `v1/names.json` listing every stack and fragment id and verify step name that has ever been official, and `stacks-api/apps/web` builds a static directory page per indexed stack from the index output; both are deployed by a maintainer by hand with the index |
| Traces to | "Stacks don't rot" made visible: the directory shows each stack's last ledger run. "None of these are collected today": the telemetry server (4.1c) needs to know which names are official so official usage is counted and custom names are not |
| Depends on | 4.0c (the build script, the `SignedIndex` envelope, inline signing, `--check`, `_headers` and the deploy procedure), 4.0b (the `apps/web` site), 1.6c (`v*` release tags exist to read) |
| Blocks | 4.1c (official names come from `v1/names.json`), 4.2b (stats sections on the directory pages), 5.2 |
| Decisions needed | None beyond 4.0c's D21: the names file is signed exactly as the index is |
| Settles | The official-names format and sources; the directory's content and ownership; the site's design tokens; the cache rules for both |

## Scope

In:

- `OfficialNames` and `NamedComposition` schemas added to `packages/format` (additive).
- `v1/names.json`, written and signed by `build:index` in the same run as the index.
- `--check` extended to verify `v1/names.json`.
- The directory in `stacks-api/apps/web`: an Astro page at `/` and one `stacks/<id>/` page per indexed stack, generated at build time from the index output.
- The site's design tokens in `apps/web/src/styles/global.css` (below), used by every later page.
- `_headers` rules for the names file and the pages, and the deploy procedure's review step for both.

Out:

- Stats on the directory (4.2b adds them). Browsing views (4.2c).
- Any API route: everything here is a static file.
- Reading the names on the server (4.1c).

## Design

### Where this fits

4.0c built and signed the index. This sub-phase adds the names file 4.1c reads to the same build, so it is always published with the index and signed with the same key, and adds the directory pages 4.2b and 4.2c extend to the site in `stacks-api/apps/web`. The index and names file are built here because they need CLI code; the pages are built there because they are presentation and read only the published index.

### Official names (`v1/names.json`)

The index serves only proven content, so it can't be the list of what counts as official: a bundled stack that was never proven, or an optional fragment that stays bundle-only, still ships in a released CLI, and its users' events must not be rewritten to `custom` by 4.1b. Nor does `IndexEntry` list verify step names. The build therefore writes a second signed file with every name that has ever been official:

```ts
// packages/format/src/names.ts (shape)
export const NamedComposition = Schema.Struct({
  fragments: Schema.Array(EntryId),                  // the default set, or the default set plus one optional fragment
  steps: Schema.Array(Schema.String),                // verify step names of that composition
});
export const OfficialNames = Schema.Struct({
  formatVersion: Schema.Literal(1), generatedAt: Schema.String, commit: Schema.String,
  sources: Schema.Array(Schema.Struct({
    origin: Schema.Literals(["release", "index"]),
    version: Schema.optional(Schema.String),         // the CLI version for origin "release"
    stacks: Schema.Array(Schema.Struct({ id: EntryId, compositions: Schema.Array(NamedComposition) })),
    fragments: Schema.Array(EntryId),
  })),
});
```

| Source | How the build reads it |
|---|---|
| `release` | For every `v*` git tag (each a published CLI version, 1.6c and 5.0), the bundled registry at that tag: `git archive <tag> packages/cli/registry/` into a temporary directory, decoded and composed with that tree's entries using today's `compose`. A tag whose registry no longer decodes under today's format is recorded with the ids its frontmatter yields and a build warning, never dropped |
| `index` | Every entry in the index being written, and every carried-forward entry, composed from its bundles |

Each stack lists the composition of its default set and one composition per optional fragment it allows, so 4.1b can check a verify's step names against what that stack really ran. Names are only added: once a tag exists its names stay in the file. The payload is wrapped in the same `SignedIndex` envelope and signed inline by 4.0c's `--key` step with the same key, so 4.1c verifies it with `INDEX_PUBLIC_KEYS`. `--unsigned` leaves its signature empty like every other envelope. The build needs full git history (`git fetch --tags` in 5.2's checkout).

`build:index --check <base-url>` (4.0c) fetches `v1/names.json` as well as `v1/index.json`, verifies its signature, and decodes it as `OfficialNames`.

### Directory

Astro pages with static output, generated at build time from the index entries and their bundles. `apps/web` reads the `--out` directory of a `build:index` run (its path is site build config), verifies the index signature with the published `INDEX_PUBLIC_KEYS` from `@steamfield/stacks-format`, and decodes it as `RegistryIndex`; a build over an index that fails either check fails. The pages ship no island here, so no client JavaScript beyond the theme toggle and the copy script (Design tokens and Copy buttons, below). The directory ships whether or not D17 is agreed, and is rebuilt after each index deploy.

- `/`: each stack's name, description, tags, last ledger run (`passed <date> with <agent>` or `carried forward from <date>`), and the copy command.
- `/stacks/<id>/`: deps by role and default and optional fragments from the stack's frontmatter, the verify steps (name, phase, layer, command), the last ledger run, a link to the entry's source in the repo, and the exact command `npx @steamfield/stacks new <id>`.

The stack's prose body is not rendered here, and the source link covers it; rendering it with Astro's Markdown support is a later choice that needs no new dependency. Each stack page has one stats section component that 4.2b fills; until then it renders as nothing.

When 4.5b's signed `v1/search.json` is available, directory copy can use its
optional editorial fields under the `SearchMetadata` contract. Detail pages
prefer reviewed sidecar `description` over entry frontmatter description; page
meta descriptions prefer reviewed `seoDescription`, then reviewed `summary`,
then entry description. An illustrative “What you could build” section uses
`projectExamples` and labels its host and extra `withFragments` selections.
Preserve stale labels, and keep drafts out of public copy until reviewed. This
is a downstream consumer contract, not directory implementation in 4.5b.

### Copy buttons

Added 2026-10-27. Every copy command (on `/`, on each stack page, and on the pages 4.2c and 4.2e add) is a `<pre>` or `<code>` element whose text is the whole command, with a Copy button beside it. One shared inline copy script, the same bytes on every page, finds those buttons and copies the text of the element each one names through the Clipboard API. It is progressive enhancement: with JavaScript off, or when the Clipboard API is unavailable, the buttons stay hidden and the command stays selectable text, so nothing depends on the script. It sends nothing and reads nothing but the element's text.

### Design tokens

Added 2026-10-27. The site uses one token set, owned here because these are the first directory pages and they ship without D17: 4.2c's telemetry-free pages and 4.2f's stats components use the same tokens, and a set owned by a D17-gated sub-phase would leave these pages to be restyled later. The tokens are CSS variables with a Tailwind `@theme` block in `apps/web/src/styles/global.css` (`stacks-api/.claude/rules/web/astro.md`: shared tokens in `styles/global.css`), light values first and a `.dark` override; components use token classes, never hex. Values (a proposal for the maintainers):

| Token | Light | Dark |
|---|---|---|
| `background` | `#fafafa` | `#09090b` |
| `card` | `#ffffff` | `#111113` |
| `secondary` (surfaces, hover) | `#f4f4f5` | `#27272a` |
| `foreground` | `#09090b` | `#f7f8f8` |
| `muted-foreground` | `#71717a` | `#a1a1aa` |
| `border` | `#d4d4d8` | `rgba(255,255,255,0.08)` |
| `primary` (links, focus, interactive state only) | `#0891b2` | `#22d3ee` |

- Type: Inter for text with weights 400 (reading), 510 (labels) and 590 (emphasis), never 700; JetBrains Mono with `tabular-nums` for numbers, ids and commands. Body 15-16px; captions 12-13px.
- Spacing on an 8px base; cards `rounded-lg` (8px) with a 1px border and no shadow; badges 2px radius, monospace, 11px, for real state only.
- Max content width 1200px; one column on phones.
- Theme follows `prefers-color-scheme`, with a toggle whose small inline script sets `.dark` on `<html>` before first paint. An explicit choice from the toggle is persisted in `localStorage` and wins over the system preference on later visits; with no stored choice, or when storage throws, the page follows the system. The theme toggle and the copy script (above) are the only scripts these pages carry.
- Fonts are self-hosted: the Inter and JetBrains Mono files are build-time assets of `apps/web`, served from the site's own origin. Icons are inlined as SVG at build time. No page loads anything from a third-party origin (no font, script, stylesheet or image host), so a page view sends the visitor's IP to no one but the site.

4.2f adds the chart palette to the same file.

### Output

This repository's build adds to 4.0c's tree:

```
<out>/
  v1/names.json                                  SignedIndex envelope around OfficialNames
```

The site build in `stacks-api/apps/web` writes:

```
apps/web/dist/
  index.html                                     directory: every indexed stack
  stacks/<id>/index.html                         one page per indexed stack
```

4.0b's deploy assembles both into one static directory.

`_headers` rules added:

| Path | Cache-Control |
|---|---|
| `/v1/names.json` | `public, max-age=300, stale-while-revalidate=3600` |
| `/`, `/stacks/*` | `public, max-age=300` |

### Deploying by hand

4.0c's procedure in `stacks-api/apps/api/README.md` is unchanged except step 2, which also reviews the names added since the live `v1/names.json` (the script prints them), and step 3, whose deploy now builds `apps/web` over the `--out` directory first and lists the pages added or removed.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/scripts/build-index.ts` | Names output; `--check` covers `v1/names.json` |
| `packages/format/src/names.ts`, `src/index.ts` | New schemas, published before the site uses them |
| `packages/cli/tests/build-index.test.ts`, `tests/fixtures/index/` | Names cases, a fixture repo with tags |
| `stacks-api/apps/web/src/pages/index.astro`, `src/pages/stacks/[id]/index.astro`, `src/lib/index-data.ts` | New: the directory pages and the build-time index reader |
| `stacks-api/apps/web/src/styles/global.css`, `src/layouts/` | Design tokens, light and dark; the theme toggle and its persisted choice; the copy script |
| `stacks-api/apps/web/src/assets/fonts/`, `src/components/CopyCommand.astro` | Self-hosted font files; the command element with its Copy button |
| `stacks-api/apps/web/tests/directory.test.ts` | New, over a fixture index output |
| `stacks-api/apps/api/README.md` | Review step for names and pages |

## Acceptance tests

Over 4.0c's fixtures plus a fixture git repo with tags:

1. `v1/names.json` verifies with the test key; over a fixture repo with tags `v0.1.0` and `v0.2.0`, it lists a stack that exists only at `v0.1.0`, a never-proven bundled stack and a bundle-only optional fragment, and each stack's compositions carry the step names their verify sections define (default set and each optional fragment).
2. A tag whose registry fails today's decode still contributes its ids, and the build prints a warning naming the tag.
3. `--check` against the local server fails, naming `v1/names.json`, when one byte of its payload changes, and passes on a good build.
4. `--unsigned`: `v1/names.json` has `signature: ""`.

### Realistic edge cases

11. Release discovery from an unrelated working directory with inherited git selectors still reads the build checkout's tags, including paths with spaces and non-ASCII characters.
12. With no release tags, a carried-forward index composition contributes the step names in its pinned bundles, not changed working files.
13. `--check` rejects a missing or unsigned names file and a correctly signed payload that fails `OfficialNames`, naming `v1/names.json` while the index and bundles remain valid.

## Acceptance tests in stacks-api

These are traced by `stacks-api`'s own tests, not by this repository's trace check, and keep their numbers so tags stay stable.

5. In `stacks-api`, the site built over a fixture index output has one directory page per indexed stack, containing the exact string `npx @steamfield/stacks new <id>` and no `<script>` other than the theme toggle and the copy script; a fixture index with a bad signature fails the site build.
6. The copy script, run in Playwright, puts a page's exact command on the clipboard; with JavaScript disabled the command is in a `<pre>` or `<code>` as selectable text and no Copy button is visible.
7. The theme toggle set to dark persists across a reload with the system preference light, and the reverse; with nothing stored, the page follows `prefers-color-scheme`; with `localStorage` throwing, the toggle still switches the page.
8. A scan of every built HTML file finds no `src`, `href`, `srcset` or CSS `url()` pointing at a host other than the site's own (relative URLs and the page's origin only; outbound links in `<a href>` to the entry's source in the repo are the one allowed exception, as navigation rather than a load), and the font files are present in the build output.
9. Every text token pair passes WCAG AA (4.5:1) against `background` and `card` in both themes, and no component under `src/components/` uses a hex color (a scan).
10. `_headers` has the rules above; served by 4.0b's Node server, `GET /v1/names.json` and `GET /stacks/<id>/` carry them.

## Exit criteria

- Acceptance tests pass; `bun run check` green from the repo root.
- A maintainer has deployed the names file and directory once by hand with the index, and `build:index --check` passes against the live host.

## What this plan may get wrong

- 2026-10-27: this repository's existing 4.0c test fixes the generated `_headers` to exactly its two index/bundle rules. This unit preserves that output; `stacks-api` must add the names cache rule when assembling the deployed static directory.
- 2026-10-27, settled for the `stacks-api` site half from its test author's questions:
  - The site build reads the index output from `STACKS_INDEX_DIR` and the trusted keys from `STACKS_INDEX_PUBLIC_KEYS` (JSON `[{ keyId, publicKey }]`), set only for the build. Production keys will come from `@steamfield/stacks-format`'s `INDEX_PUBLIC_KEYS` once it is published; until then a deploy supplies them through the variable.
  - The deploy assembler rejects colliding paths. `_headers` is the one allowed overlap: the assembled file is the site's rules followed by the index output's, plus the names rule, with a test.
  - The plan's `CopyCommand.astro` follows the site rule for reusable components instead: a server-rendered `.tsx` component in `components/` with a colocated test.
  - The directory takes over `/`, so 4.0b's `ApiStatus` island moves to `/status/`, and test `[4.0b#9]` checks that page instead. The directory pages keep only the theme toggle and the copy script.
  - The proposed light `primary` (3.53:1 on `background`, 3.68:1 on `card`) fails item 9. The token gets darker, keeping its hue, until it passes 4.5:1 on both.
  - Dates show as ISO dates (`YYYY-MM-DD`) in a `<time>`. There is no source link until the repository has a public URL; item 8's exception allows one and doesn't require it. Carried-forward state isn't shown, because the index doesn't record it.
  - Ids have no maximum length in the schema; the 255-character case is a filesystem boundary and stays.
- 2026-10-27: indexed optional fragment bundles need not have been published, so the index source can reconstruct only each stack's pinned composition. Release sources supply the default-plus-optional compositions from complete historical registries. The build is a maintainer script with text output and no audience or `--json` flag; its QA uses that interface.
- 2026-10-27: release tags and the selected index alone do not preserve names from an index composition updated or withdrawn between releases. The build verifies and merges the previous names payload too. HTTP 404 bootstraps from the previous index's pinned bundles; other fetch, signature and payload failures stop publication. Pinned step names concatenate the bundled verify sections directly, since today's composer requires metadata for default fragments even when a sandbox proof omitted their unpublished bundles.
- Composing old tags with today's `compose` may disagree with what that release composed if composition rules changed. Step names are what 4.1b checks, and those come from verify sections, which compose by concatenation; if a rule change ever alters step names, the build should run the tag's own CLI instead.
- 2026-10-27: the directory pages were planned as plain template strings in `packages/cli/scripts/site/`. Under D35 the visualization layer moved to `stacks-api/apps/web` as an Astro site, so that directory is no longer planned here; only the signed files are built in this repository.
- 2026-10-27: the design tokens were first planned in 4.2f, which is D17-gated. They moved here so the directory has them whether or not telemetry is agreed; the theme toggle's inline script replaces "no `<script>`" on these pages.
- 2026-10-27: a review of the site's design mocks found they load their fonts and icons from third-party hosts at view time, need copy buttons on every list row and page, and persist the theme choice. Fonts are now self-hosted and icons inlined, with a scan for third-party origins; one shared copy script joins the theme toggle as the only scripts; an explicit theme choice persists, while this plan's `.dark` class and system default stay (the mocks are dark-first with a `.light` class).
- 2026-10-27: the mocks show stars (counts on every list row and stack page, a "Starred" view, an avatar in the nav). The site leaves them out, per roadmap "Won't have" ("Ratings, reviews, accounts").
- 2026-10-27: items 5–10 are `stacks-api`'s and can have no tagged test here, so they moved under "Acceptance tests in stacks-api", outside this repository's trace check, with their numbers kept. The schemas' `EntryId` is `entry.ts::Kebab`, the existing kebab-case id schema; no new id export is needed.
- Reading every tag with `git archive` grows with the number of releases. At a release a week that is years before it matters; cache per tag in the build's temporary directory if it ever does.
