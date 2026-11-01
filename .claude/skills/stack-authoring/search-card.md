# Writing a search card

Shared by the `stack-authoring` and `fragment-authoring` skills. `packages/cli/docs/authoring.md` ("Add a search card") owns the field list and word budgets. `packages/cli/scripts/decorate/prompt.ts::buildPrompt` holds the drafting rules a card's `promptVersion` claims it followed: read them and follow them. This file covers how to fill the fields so the entry ranks for the right requests and stays out of the wrong ones. The rules come from an audit of the bundled registry, and bundled cards predate them, so copy an existing card's shape, not its `notFor` or facets.

## How the ranker reads a card

The ranker is `packages/format/src/search/rank.ts` (BM25 over weighted fields, then facet and exclusion penalties, then tiers). Its rules decide what a card has to say:

- Field weights: `requests` 2.5, `id` and `name` 2, the frontmatter `description`, `summary`, `useCases` and `synonyms` 1.5, `tags` and `goodFor` 1, the body 0.15. `deps` and the editorial fields aren't ranked. Facet matches (closed vocabulary words in the request) add on top.
- Only the one request closest to the query is scored. Five requests with the same words count as one; make each a different intent or phrasing.
- The strong tier needs at least half the query's content words covered by fields weighted 1.5 or more. A word that appears only in `tags`, `goodFor` or the body never gets an entry to strong.
- Any penalty (a `notFor` match or a facet mismatch) drops the entry out of the strong tier, and tier sorts before score. A penalty is a demotion below every strong hit, so one that fires on a request the entry should win costs a lot.
- Common words are removed before matching: "app", "tool", "project", "build", "use", "make" and the usual articles. "desktop app" in `notFor` fires on any request containing "desktop".
- Closed vocabulary words in `search/vocabulary.json` work as aliases. `api` is an alias for both `platforms.server` and `productKinds.api`, so a stack that ships an API but lists no `server` platform takes a platform penalty on every query containing "api" or "backend".
- A `notFor` phrase fires on an exact match, when every content word in it appears in the request, or on its acronym when the phrase has three or more words. "server-rendered pages by default" needs four words in the query and in practice never fires; "server-side rendering" fires on "SSR".
- Language and platform penalties apply only when the request names a vocabulary alias. "go release" matched no Go alias, so a Bun release fragment tied with goreleaser for it.
- Stack scores saturate (raw over raw plus one), so generic requests like "react app" return several strong hits. Metadata fixes order and penalties, not tier sharpness.

## Field by field

`summary` is one plain sentence a person reads in a search hit. Say what you get and where it runs.

`requests` carry the most weight. Write 3 to 5 things a developer would type or say, each a different need, in their words, about what this entry delivers. Never describe an optional fragment as if it were built in: "build an AI chat assistant into my web app" on a stack whose chat comes from an optional fragment sends that request to the wrong entry; "start a web app I can add an AI chat assistant to" is honest.

`synonyms` hold the other names people search with: the predecessor or rival name ("Remix" for React Router framework mode, "Electron alternative" for Tauri, "Husky alternative" for git hooks), the plain word a compound hides ("Docker" when only "Dockerfile" appears, because words don't split), and the plain phrasing of a niche tool ("offload tests", "remote machine"). Misspellings and single-word forms of shared terms ("fullstack" for "full stack", "postgress") belong in `vocabulary.json` aliases, once, rather than on one card.

`notFor` holds short phrases for near misses the entry attracts in testing and doesn't serve: the other CI host ("GitLab CI"), the vendor's other products ("error tracking", "feature flags" on an analytics fragment), the sibling's job ("Cloudflare" on a Node-served stack), and anything the name suggests but the files don't ship ("Claude Code hooks" on a fragment with no hooks). Add one only for a miss you saw in the ranker, and pair it with a request the entry should still win that contains the excluded word, so you can check it isn't demoted ("a fastapi app with a typer cli" against a "command line interface" exclusion). A `notFor` must never contradict the files: a fragment that ships an eval report format can't list evaluations as out of scope.

`goodFor`, `useCases` and `caveats` describe needs the entry supports. Put a real operating limit in `caveats` ("Local API development needs Docker for the Postgres container") when `tools` or the body imply one a reader would trip on.

Closed facets (`platforms`, `productKinds`, `languages`, `capabilities`) must match what ships. List every platform the entry runs code on: an Expo app with a Hono API is `mobile` and `server`. Don't add a facet that is a sibling's main job: a site-plus-API stack listing `content-site` outranked the blog stack for "docs site".

The editorial fields (`description`, `seoDescription`, `projectExamples`) are for people browsing the directory, and a new bundled card has all three, with at least one project example. Write them as plain prose: what the entry sets up, then what a product still needs. Project examples are illustrative; name the optional fragments they need in `withFragments` and never imply auth, persistence or compliance the entry doesn't provide.

`plain` (directly after `projectExamples`) is the copy `show` and the directory lead with, written for someone who has never used this ecosystem: `whatItIs` (one sentence, at most 30 words), `goodAt` (2 or 3 jobs, at most 15 words each) and `notGoodAt` (1 to 3 limits, ideally naming what to use instead). Explain any unavoidable technical word in the same sentence, and keep it version-neutral (`plain-versioned` flags a version number). Every name in the entry's `deps` also needs a card in `registry/deps/<ecosystem>.json` (`whatItIs`, plus `goodAt`, `notGoodAt` and an `example` for a package a person would choose; support packages such as `@types/*` and plugins get `whatItIs` only), or `validate` reports `deps-missing`; follow the existing cards' tone.

## Provenance: you write the card and stamp it

A card you write or rewrite starts as a draft: `source.by: "drafted"`, `model` set to your model id, `promptVersion` set to `PROMPT_VERSION` from `scripts/decorate/prompt.ts`, `reviewedAt: null`, and a placeholder `source.digest` (`sha256:` and 64 zeros). If you change any card field, reset `source` to a draft as above.

Once the card is final and its requests rank where they should ("Testing the card"), stamp it: `bun run decorate --restamp <id>` from `packages/cli` sets the review date and the digest against the entry as it stands. After any later entry edit, reread the card; if every claim and request still fits, restamp it, and if not, rewrite it and restamp. Name each restamp in your hand-back.

Never set `reviewedAt` by hand and never run `bun run decorate --approve`, which refuses under an agent anyway. Approval is for a submitted card (`by: "author"`): a stranger's copy that ends up public, so a person reads it first, and `--restamp` refuses an unread one.

A dependency card you add to `registry/deps/<ecosystem>.json` follows the same rule: `source.by: "drafted"`, your model id, `promptVersion` as above, and `reviewedAt` set to the date you wrote it.

## Testing the card

Run realistic requests through the real ranker from the repo root and read the order and tier, not just the top hit:

```sh
bun run dev search --local --kind stack --json "hono api"
bun run dev search --local --kind fragment --json "gitlab ci"
```

Try at least five requests the entry should win, three it should lose to a sibling, one near miss its `notFor` should push down, and one request it should win that contains each excluded word. Report them as a table in your hand-back.

Don't read `packages/cli/tests/fixtures/search/golden.json` while writing a card: holdout queries must not leak into `requests`. After the card is written, run from `packages/cli`:

```sh
bun run test:unit tests/search-golden.test.ts tests/search-metadata-holdout.test.ts tests/search-golden-coverage.test.ts
```

`search-golden.test.ts` ranks the real registry against the golden set; a new entry that takes another entry's first-result query fails it, and that failure is yours to fix in your card. A new entry needs golden judgments (a stack two first-result queries, a fragment one relevant judgment), which are product decisions. Propose them in the hand-back, phrased differently from your own `requests`, as tune candidates; the maintainer adds them and picks the holdout split.

## Checks that stay red on a new entry

Leave exactly these and report them; fix everything else:

- `tests/search-golden-coverage.test.ts`, failing on the new id's missing judgments
- `tests/search-metadata-holdout.test.ts`, when stamping changes which reviewed cards it takes as prompt examples and the new example contains a golden query. A failure that names one of your own cards' requests is yours to fix.
