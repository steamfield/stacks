# Build: accurate display copy on stack and fragment pages

Status: done 2026-11-16 (tag `display-copy-final`). Started: 2026-11-15. Timebox: none. Landing branch: build/display-copy.
Gate: `rr check` (about 30 s). Filtered tests: `bun run test:unit tests/<file>.test.ts` in `packages/cli`. Typecheck: `bun run typecheck`.
Card check (cheap, run locally): `bun run dev validate` from the repo root.
Worktree setup: `ln -s <main checkout>/node_modules node_modules` at the worktree root and in `packages/cli`, `packages/format` and `packages/mcp`; lanes never touch `bun.lock`.
Scaffold commits: phase 1 f3d73c0d; phase 2 0ba630a4 (guard, after the fragment lanes). Worktrees were installed with `bun install --frozen-lockfile` per `.claude/delegate.md`.

## Spec

The directory page for a stack or fragment (stacks-web, in `stacks-api`) has two sections that read badly. "Good for" and "Not for" render `goodFor` and `notFor`, which are ranker inputs written as search phrases. "Project examples" render `projectExamples`, and about half of the 122 examples are build instructions and disclaimers rather than a description of a project, because the decorate prompt tells the model to label them illustrative and avoid promising features. This build fixes the copy at its source and keeps both sections.

In scope:
- Keep both sections. The page renders `plain.goodAt` and `plain.notGoodAt` for "Good for" and "Not for" (no new field; every card has `plain`, and it is already in `v1/search.json`).
- Check all `plain` blocks for accuracy against each entry's STACK.md or FRAGMENT.md and files, and fix the inaccurate items.
- Rewrite hedged `projectExamples` by hand, editing only display copy. Ranked fields (`summary`, `requests`, `useCases`, `synonyms`, `goodFor`, `notFor`, `caveats`, facets) don't change, so search results don't move.
- Change the decorate prompt's example rules (prompt version 4), including its two in-prompt example cards.
- Add a validate warning for hedged example copy, so the bundled zero-warning test catches regressions.
- The page change goes in a separate session in `stacks-api`.

Out of scope: rerunning `decorate` on any card; changing `goodFor`/`notFor` content or ranking; removing either section; new schema fields in `packages/format`; touching `description`, `seoDescription` or `summary` copy.

Assumptions:
- An edited card keeps `source.by` and `source.model` and gets `reviewedAt: "2026-11-15"` (the maintainer reviews each diff at landing). `source.digest` hashes the entry, not the card, so editing card copy doesn't make it stale.
- An example already written as a project description stays as it is. Lanes rewrite only examples that fail the copy rules below.
- Example `title`, `stack` and `withFragments` stay unless the title itself is the problem. A fragment example's host and additions must still validate.
- The guard's phrase list is short and explicit and catches the observed patterns. It isn't meant to judge style in general.

Error model: the guard adds one warning check id, `example-hedged`, with the message `Project example <n> reads as instructions or a disclaimer ("<matched phrase>"); describe the finished project and put limits in caveats.` It is a warning, so `validate` still exits 0 for user registries, and only `tests/bundled-registry.test.ts` fails on it. Copy errors a lane might introduce (over-length title or description, a bad host) are already reported by `search-size` and `search-examples.ts`.

## Copy rules (shared by every lane, and the prompt's v4 wording)

A project example describes a project someone would build with this entry, as its user would see it: what it is, who it's for, what it does. One or two sentences, at most 35 words, title at most 8 words. It describes the finished project; it doesn't tell the reader what to implement, configure or create.

It doesn't contain: the word "illustrative"; set-up or deployment chores ("create the Pages project", "configure credentials separately"); disclaimers about what's left to build ("remain separate product decisions", "is still the project's work", "you write the copy"); or references to the starter's own sample code ("replace the slug type", "the base already establishes"). A real operating limit belongs in the card's `caveats`, which lanes don't edit; drop it from the example.

It stays honest: name only capabilities the entry's files or default fragments provide, or ones a reader would obviously add as their own product code (screens, records, pages). Don't claim compliance, scale or timing.

Good: "A cover and a dozen MDX slides with click-by-click reveals and speaker notes, presented from the browser with a presenter window, and built to a static site for sharing afterwards." (decks)
Bad: "Implement local archive and checksum checks, then add goreleaser to distribute the utility through tagged GitHub releases." (go-cli)
Rewritten: "A command that checks release archives and their checksums before upload, shipped through tagged GitHub releases with goreleaser." (keeps `withFragments: ["goreleaser"]` if present)

`plain.goodAt` items name things the entry's files actually do or ship; `plain.notGoodAt` items name real near misses, each at most 15 words, version-neutral. Fix an item only when it's wrong or misleading about the entry.

## Contracts (scaffold commit)

No code contracts in phase 1; the lanes edit JSON cards only. The scaffold commit holds this plan, and the prompt v4 change, done inline before dispatch so lanes can read the final wording.

Files touched by the build:

    packages/cli/
      scripts/decorate/prompt.ts           drafting rules: PROMPT_VERSION 4, new example rules, rewritten EXAMPLE_CARDS examples
      registry/search/stacks/*.json        stack cards: projectExamples and plain copy only (phase 1 lanes)
      registry/search/fragments/*.json     fragment cards: same (phase 2 lanes)
      src/core/validate/search-examples.ts adds hedgedExample(): the example-hedged warning (phase 2)
      tests/search-metadata-editorial.test.ts  prompt v4 wording assertion; example-hedged cases (phase 2)
      docs/authoring.md                    "Add a search card": one sentence on what a project example says (phase 2)
    .claude/skills/stack-authoring/search-card.md   one paragraph on example copy (phase 2)

## Phases

### Phase 1: stack cards read as projects (MVP)

Demo: `bun run dev show mobile-expo` prints the rewritten first example and plain copy; `jq '.projectExamples, .plain' packages/cli/registry/search/stacks/{mobile-expo,go-cli,typescript-cli}.json`; `bun run dev validate` exits 0 with no warnings.
Test cases: none new. Prompt v4's test assertion (`tests/search-metadata-editorial.test.ts`, "prompt v3 supplies ... honest editorial instructions") is updated inline in the scaffold to the v4 wording; `tests/bundled-registry.test.ts` and `tests/search-golden.test.ts` must still pass (they prove copy edits didn't touch ranking).

Inline before dispatch (scaffold): prompt v4 and its test update.

| Lane | Size | Owns files | Reads | Tests | Model | Done when |
| --- | --- | --- | --- | --- | --- | --- |
| a | SM | `registry/search/stacks/` cards `astro-blog` through `go-tui` (14) | this plan's copy rules; each entry's `registry/stacks/<id>/STACK.md` and `files/` | validate | opus | validate clean, report table written |
| b | SM | stack cards `hono-api` through `react-router` (14) | same | validate | opus | same |
| c | SM | stack cards `react-vite` through `typescript-mcp` (15) | same | validate | opus | same |

Sizing check: lanes are within one card of each other; each is copy review over 14 or 15 files with no code. Opus because judging accuracy against an entry's files is judgment, and nothing but the maintainer's read catches a wrong claim.

#### Lane brief (a, b and c; each gets its own card range)

- Goal: make every card in your range's `projectExamples` and `plain` accurate and written as the copy rules say, without changing anything that affects search ranking.
- Interface: edit only `projectExamples[].title`, `projectExamples[].description`, `plain.whatItIs`, `plain.goodAt`, `plain.notGoodAt` and `source.reviewedAt` in the card files you own. Keep key order and two-space JSON formatting.
- Behavior:
  - For each card, read the entry's `STACK.md` (frontmatter and body) and list its `files/`.
  - Each example that breaks the copy rules: rewrite its description (and its title only if the title is a chore or disclaimer). Keep `stack` and `withFragments` unchanged.
  - Each example that already follows the rules: leave it byte for byte.
  - Each `plain` item that's wrong about the entry, or reads as a search phrase: rewrite it. Otherwise leave it.
  - Set `source.reviewedAt` to `"2026-11-15"` on every card you changed, and on no other card.
  - Keep counts: the same number of examples and `goodAt`/`notGoodAt` items as before.
- Decisions already made: keep both sections; hand edits only; ranked fields frozen; `caveats` untouched even when an example's dropped limit belongs there (list it in your report instead).
- Out of scope: `summary`, `description`, `seoDescription`, `requests`, `useCases`, `synonyms`, `goodFor`, `notFor`, `caveats`, facets, `source.digest`, any file outside your range, any code or test.
- Done when: `bun run dev validate` (repo root) reports no errors or warnings for your cards; `git diff --stat` shows only your card files; a report at `<scratchpad>/lane-<x>-report.md` has one row per changed card: id, which fields changed, old and new text, and any limit you dropped that might belong in `caveats`.

### Phase 2: fragment cards, and a guard against regression

Demo: `bun run dev validate` exits 0 with no warnings; a copy of a card with "Illustrative:" in an example, validated as a user registry, reports `example-hedged`.
Depends on: phase 1

| Lane | Size | Owns files | Model |
| --- | --- | --- | --- |
| d | SM | `registry/search/fragments/` cards `agent-ops` through `effect-otlp` | opus |
| e | SM | fragment cards `effect-schema` through `rr` (and any after it) | opus |
| inline | S | `search-examples.ts`, its test cases, `authoring.md`, `search-card.md` | me |

Lanes d and e use the phase 1 brief with `FRAGMENT.md` in place of `STACK.md`, and one extra rule: a fragment example's `stack` host and `withFragments` stay as they are and must still validate. The guard lands after d and e merge, because the bundled zero-warning test would fail on unrewritten cards before then.

Guard test cases (written in the phase 2 scaffold): a description containing each listed phrase warns `example-hedged` with the phrase and example position; matching is case-insensitive and on word boundaries ("Illustrative:" warns, "illustratively" does not); a clean description produces no finding; the title is checked as well as the description; `plain` text is not checked; the bundled registry still has zero warnings. Phrase list: `illustrative`, `separately`, `yourself`, `still the project's`, `remain separate`, `you write the`, `must be filled`, `before using it`, `before sharing`, `before launch`, `need additional`, `replace the`.

## Parallel work outside this repo

stacks-api session (the maintainer starts it there, per CLAUDE.md): in `apps/web`, render `plain.goodAt` and `plain.notGoodAt` under "Good for" and "Not for" in `components/entry/GoodFor.tsx`, carrying `plain` through `components/stack/data.ts::StackCard` and the fragment equivalent; hide the fit lists when a card has no `plain` rather than falling back to `goodFor`/`notFor`; update `GoodFor.test.tsx`, `StackDetail.test.tsx` and `FragmentDetail.test.tsx`. It needs nothing from this build, since `plain` is already published; the rewritten copy reaches the site with the next release and `prod:deploy`.

## Log

- 2026-11-15: plan approved. The maintainer asked for every lane to go to Codex (newest sol, through the `codex-delegate` runner and `.claude/delegate.md`) rather than Claude builder agents; the Model column now means a Codex delegate for every lane. The prompt v4 change and its test updates were done inline in the scaffold.
- Phase 1 (tag `display-copy-phase-1`): Codex lanes a, b and c rewrote 72 examples and 12 `plain` items on 43 stack cards; each lane ran one fresh Codex review. Lane c's reviewer caught rust-wasm's `plain` claiming Rust-to-JavaScript sharing the entry doesn't offer. Gate 7/7. The existing `phase-1` tag belongs to an earlier build, so this build's tags are prefixed.
- Phase 2 (tag `display-copy-phase-2`): Codex lanes d and e rewrote the fragment cards (24 of 26; `claude-harness` and `claude-harness-docs` were already clean). The guard landed after them; with it on, the bundled registry has 0 warnings and none of the 43 rewritten stack cards trips it. Gate 7/7.
- Final review (code-reviewer, opus): 12 findings, all applied. Docs and prompt text that still said "illustrative" (authoring.md, maintaining.md, validation.md, prompt line on promised features); module header; hedge variants (`remains`, `needs`, `replacing`) and curly apostrophes, with revert-verified tests; the test helper now requires the card itself to have no errors; test fixtures. A Codex fix-up lane rewrote astro-fullstack's second example and tauri-react's unsupported "process measurements" claim, and reset all 67 rewritten cards' `source` to prompt v4 drafts by `codex/gpt-6.1-sol` and restamped them with `decorate --restamp`, as `search-card.md` "Provenance" requires (the plan's hand-set `reviewedAt` was wrong). Gate 7/7, 3,859 CLI tests.
- Limits dropped from examples and not moved to `caveats` (left for the maintainer): memory-only stores and no access control (go-api, rust-api, spring-boot-api, sveltekit), no sign-in (django, django-api, go-htmx, go-grpc, spring-boot-web, cloudflare-react-router), Cloudflare Pages project and credential set-up (astro-blog, astro-product-site), and provider credentials, rate limits or write safeguards (typescript-api, typescript-mcp, tauri-react).
