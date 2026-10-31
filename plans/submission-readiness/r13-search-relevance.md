# R13. Search relevance tuning from manual QA

Priority P0. Depends on R0. Evidence: `search-relevance.md`. Works mostly in quickstack
(search metadata, vocabulary, golden set); a ranking change also touches the format package.
Added 2026-10-28 at the user's request.

## Outcome

Realistic queries, phrased the way developers and their agents actually ask, return the
right stack or fragment first, and out-of-scope queries return nothing instead of a weak
guess. The CLI and the website (R12) both show these results, since both use the same
ranking over the same index.

## Read first

- Phases `plans/archive/phases/phase-4.5a-search-evaluation-set-2026-10-30.md` (golden set, tune and holdout
  split, the rule against leaking holdout queries into metadata), `phase-4.5b-search-metadata.md`
  (what each sidecar field does, how cards are reviewed), `phase-4.5c-search-command-and-local-ranking.md`
  (ranking, tiers, penalties), and `plans/runs/2026-10-28-search-lexical.md` (the last eval run).
- `quickstack/AGENTS.md`, the search architecture paragraph.
- Files: `packages/cli/tests/fixtures/search/golden.json` (47 queries),
  `packages/cli/registry/search/{stacks,fragments}/<id>.json` (sidecar cards),
  `packages/cli/registry/search/vocabulary.json` (aliases),
  `packages/format/src/search/rank.ts` (ranking),
  `packages/cli/scripts/search-eval.ts` (`bun run search:eval`).
- Tests that guard the cards: `packages/cli/tests/search-metadata-*.test.ts`,
  `search-golden.test.ts`, `search-golden-coverage.test.ts`.

## Three levers, in order of preference

| Lever | Files | Ships through | Release cost |
| --- | --- | --- | --- |
| Card metadata: summary, requests, productKinds, capabilities, platforms, notFor | `registry/search/<kind>/<id>.json` | The index (API, at R5's deploy) and the CLI bundle (R5's publish) | None extra |
| Vocabulary: aliases and synonyms ("postgres", "postgresql", "pg") | `registry/search/vocabulary.json` | Same as cards | None extra |
| Ranking: weights, tier thresholds, penalties | `packages/format/src/search/rank.ts` | A format release, then the stacks-api dependency bump, then the CLI | One more user publish (format patch) before R5; add it to `release.md` |

Fix with cards and vocabulary first. Change `rank.ts` only when a failure can't be fixed with
metadata, and record why.

## Steps

1. Baseline. From `packages/cli`: `bun run search:eval` (both splits) and
   `bun run search:eval --split tune`. Record the metrics.

2. Write about 40 realistic queries into `search-relevance.md`, before running any, from
   what the catalog covers (`bun run dev list --json`). Cover:
   - product descriptions: "a SaaS with auth and Stripe billing", "an internal dashboard for
     support tickets", "a blog with a CMS";
   - stack-shaped requests: "next.js with postgres", "python api and react frontend",
     "a go cli tool";
   - constraints: "typescript only, no python", "deploy to cloudflare", "no docker";
   - fragment needs in an existing repo: "add CI", "add e2e tests", "deploy my app to fly";
   - how agents rephrase: long, keyword-heavy requests copied from a user's message;
   - typos and shorthand: "postgress", "ts api", "rn app";
   - out of scope: "firmware for a drone", "a Unity game", "!!!", "asdf".
   For each, write the expected first stack or fragment (or "no match") and why, before
   seeing results. Don't use queries from `golden.json`'s holdout split.

3. Run each against the local API and the CLI. In stacks-api, `bun run dev:bg`; in quickstack:

   ```sh
   STACKS_DEV_API_URL=http://127.0.0.1:<port> bun run dev search "<query>" --json \
     | jq '{ranking, noStrongMatch, stacks: [.stacks[:3][] | {id, tier, score}], fragments: [.fragments[:3][] | {id, tier}]}'
   ```

   The local API serves the index it was started with. After changing cards or vocabulary,
   rebuild the index (`bun run build:index --out <dir> --previous none --unsigned
   --include-unproven` in `packages/cli`) and restart the API on it (`STATIC_DIR=<dir>`, see
   `stacks-api/apps/api/README.md` "Running it"); or judge with `--local`, which ranks with the
   same code over the working tree. Use the API path for the final pass.

   Grade each query: good (expected first), acceptable (expected in top 3, or a defensible
   alternative first), wrong (a poor fit first, or a strong match on an out-of-scope query),
   or missing (the right entry absent).

4. For every wrong or missing query, find the cause (which fields matched in `why`, what
   `understood` parsed, which penalty applied) and pick the lever from the table. Make the
   smallest change. Cards were maintainer-approved: keep their voice, follow 4.5b's field rules
   and the `search-metadata-*` tests, and list every edited card in the evidence so the user can
   skim the diff. Never copy a holdout query, or five consecutive words of one, into a card's
   `requests`; the tests enforce this.

5. Lock each fix in: add the query to `golden.json` with `split: "tune"`, its `first` and
   graded `relevant` entries, matching the existing format. Keep the 4.5a ratio (about a third
   holdout) by also adding some new queries you didn't tune against as `holdout`.

6. After each batch: `bun run search:eval`, then
   `bun run test tests/search-golden.test.ts tests/search-metadata-*.test.ts` from
   `packages/cli`. Holdout metrics must not drop. Revert a change that helps tune and
   hurts holdout.

7. Repeat steps 3 to 6 until the bar below is met or three rounds have passed; then stop and
   report what's left.

8. Check the demo recipe's proof survived: cards and vocabulary sit outside entries (D37), so
   R3's fingerprint shouldn't change. Re-run R3 step 9 once and confirm.

9. If `rank.ts` changed: record the format version needed (patch, for example 0.4.1) in
   `release.md`. The user publishes it before R5 step 1, and stacks-api takes it with
   `bun install` before its gate.

## Bar

| Measure | Target |
| --- | --- |
| Realistic queries graded good or acceptable | at least 90% |
| Wrong first result at `strong` tier | 0 |
| Out-of-scope queries with `noStrongMatch: true` | all |
| Golden gate (`search-golden.test.ts`) | passes; holdout metrics not below baseline |

## Done when

- [ ] `search-relevance.md` has the query list with expectations written before running,
      grades before and after, every change with its lever and reason, and eval metrics
      before and after.
- [ ] The bar is met, or the remaining failures are listed with causes.
- [ ] New golden queries added and tests pass.
- [ ] R3's fingerprint confirmed unchanged; any format release recorded for R5.
