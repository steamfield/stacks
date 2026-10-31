# R1. Search and guidance an agent can follow

Priority P0. Depends on R0. Evidence: `contracts.md`. CLI-only changes in quickstack; no
format release and no API change.

## Outcome

In the demo, an agent that only reads `stacks --help` or `stacks guide` finds `search`, uses
it, explains its pick, and knows what to do when nothing matches or the API is unreachable.

Most of the search fixes already landed and only need deploying: format 0.4.0's
positive-hit ranking (nonsense queries return nothing instead of zero-score padding), the
structured penalties, and stats evidence on API hits (stacks-api commit `f8426a4`). R5
deploys them. This task is the CLI side the demo touches.

## Read first

- `quickstack/AGENTS.md` (search architecture paragraph).
- `packages/cli/src/core/guide.ts` (`guideText`, `guideCommands`, `helpFooter`),
  `packages/cli/src/core/search/report.ts`, `packages/cli/src/core/list-report.ts::nextLines`
  (the existing `Next:` line style).
- Tests: `packages/cli/tests/guide.test.ts`, `help.test.ts`, `search-api-ux.test.ts`.

## Steps

1. One loop everywhere. Put `search` in `guideCommands` and `helpFooter`. The guide prose,
   the help footer and the structured command list must all teach the same order: search,
   then show, then new, then verify (`verify --all` before calling it done). Keep `list` as the
   way to browse and recover. Update `guide.test.ts` and `help.test.ts`.

2. No match. When `noStrongMatch` is true, the human report prints `Next:` lines in the
   `list-report.ts` style, for example `Next: stacks list stacks` and
   `Next: stacks search "<fewer, broader words>"`. Change the guide's "If noStrongMatch, say
   nothing fits well" to also say to run `stacks list --json` and offer the closest entries.
   An empty result still exits 0. JSON shape doesn't change (no format release).

3. Visible fallback. When results were ranked locally because the API was unreachable, off
   or backed off, the human report prints one line saying so and why (`remoteReason` is
   already in the JSON). Test in `search-api-ux.test.ts`.

4. Evidence wording. One guide sentence saying `stats` are aggregate outcomes across all
   projects using that stack over the window shown, not a promise for this project. Keep
   the existing `lastRun` sentence.

## Done when

- [ ] Scoped tests pass: `guide.test.ts`, `help.test.ts`, `search-api-ux.test.ts`, and any
      search tests whose expected output changed.
- [ ] Against `bun run dev:bg` in stacks-api (port from `bun run dev:status`), from
      quickstack:

      ```sh
      STACKS_DEV_API_URL=http://127.0.0.1:<port> bun run dev search "python api with a react dashboard"
      STACKS_DEV_API_URL=http://127.0.0.1:<port> bun run dev search "!!!"
      STACKS_OFFLINE=1 bun run dev search "python api with a react dashboard"
      ```

      The first ranks with the API and the top hit fits; the second prints no hits and the
      `Next:` lines; the third prints local results with the fallback line.
- [ ] A fresh agent given only "use the stacks CLI to pick a stack for a Python API with a
      React dashboard" finds `search` from help or the guide. Paste the transcript excerpt.
