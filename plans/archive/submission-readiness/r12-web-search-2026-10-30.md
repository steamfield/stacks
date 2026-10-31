# R12. Website search page

Priority P0. Depends on R0; the final walkthrough comes after R13's tuning lands. Evidence:
`web-search.md`. Works in `stacks-api/apps/web`. Added 2026-10-28 at the user's request.

## Outcome

A judge on the site types what they want to build and gets the same ranked results the
CLI gets from `/v1/search`, with each result one click from its detail page and the
command to start it. This is the most direct way to show the hosted API working without
installing anything.

## Read first

- `stacks-api/.claude/rules/web/astro.md`, `.claude/rules/web/styling.md`,
  `.claude/rules/workspace/testing.md`, `apps/web/README.md`.
- `stacks-api/docs/operations.md` "Proxy access logs" (search text must not reach logs).
- Code to reuse, not copy:
  - `apps/web/src/lib/api.ts`: the only module that builds the API client; islands run calls
    with `runApi`, which maps failures to a `FailureView`. Add the search call here.
  - `packages/contract/src/groups/search.ts`: the `Search.list` endpoint. Its success schema is
    format's `SearchResponse`; the contract client decodes the columnar wire shape into
    ordinary `stacks` and `fragments` arrays of hits, so the island never sees columns.
  - `apps/web/src/components/BrowseEntries.tsx` (result rows), `StackEvidence.tsx` (evidence
    wording), `CopyCommand.tsx` and `AgentPrompt.tsx` (the handoff), `SiteNav.tsx` (nav).
- `apps/web/astro.config.mjs:156`: the dev server proxies `/v1` to the API, so `bun run dev:bg`
  gives a working page locally.

## Design

- Page: `apps/web/src/pages/search/index.astro` with one React island
  (`apps/web/src/islands/SearchPage.tsx`). Static shell, all results client-side.
- Entry points: a "Search" link in `SiteNav`, and a search field on the home page whose
  submit goes to `/search/#q=<text>`.
- Query in the URL fragment (`#q=`), never the query string. A fragment never reaches the
  server or proxy logs, which keeps the search-privacy rule, and Back and sharing still work.
  Read it on load and on `hashchange`.
- Request on submit (Enter or the button), not on every keystroke: the API rate-limits search.
  Trim the text; ignore empty; cap at 500 characters (the API's limit).
- Results: stacks first, then fragments, each list with a count. Each row shows the name
  linked to `/stacks/<id>/` or `/fragments/<id>/`, the summary, a tier label ("Strong match",
  "Partial match"), the matched words from `why` ("Matched: postgres, auth"), caveats if
  present, and the stats evidence line when `evidence.stats` exists, worded like
  `StackEvidence`. A stack row has its copy command (`npx @steamfield/stacks new <id> <dir>`,
  matching what stack pages show).
- No match (`noStrongMatch` true and both lists empty): say nothing fits well, suggest fewer
  or broader words, and link `/browse/` and `/fragments/`.
- Partial-only results: show them under a note that none is a strong fit.
- Errors: show the `FailureView` message; for rate limiting, say to wait a moment; always
  offer the browse link.
- Without JavaScript: a `<noscript>` note with links to browse.
- Accessibility: a labelled search field, results count announced in an `aria-live` region,
  focus moves to the results heading after a search, full keyboard use, fits 390 pixels.
- Visuals: the existing design system and result-row styling. No new tokens.

## Steps

1. Add `searchEntries({ q, limit })` to `lib/api.ts` using the contract client
   (`client.Search.list({ query: { q, limit } })`). Unit test it next to `api.test.ts`.
2. Build the island and page per Design. Component tests in
   `apps/web/src/islands/SearchPage.test.tsx` covering: strong results, partial-only,
   no match, rate-limited, unavailable, hash load and change, empty submit ignored.
3. Nav link and home search field, with tests updated in `SiteNav.test.tsx` and the home tests.
4. Browser spec `apps/web/tests/browser/search.spec.ts`, following how the existing specs get
   their data (read `directory.spec.ts` and the Playwright config first): search from the
   home page, open a result, use Back, and the no-match state.
5. Walk it locally with `bun run dev:bg` (site port from `bun run dev:status`) using R13's
   query list once R13 has tuned results. Record screenshots or notes for five queries.

## Done when

- [ ] Component, unit and browser tests pass (`bun run test --project web`,
      `bun run test:browser apps/web/tests/browser/search.spec.ts`).
- [ ] The local walkthrough with R13's queries reads well; notes recorded.
- [ ] The query never appears in a page URL's query string (checked in the browser spec).
- [ ] `web.md`'s post-deploy smoke list includes `/search/#q=python%20api%20with%20a%20react%20dashboard`.
