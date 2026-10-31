# R4 website walkthrough (local, R2 sample)

stacks-api merges: R4 `e08c016`, R12 `d9d74d6` and `5f5b1e1`, search fixes `0d71dbf`. A Terra
QA agent built the site with `STATS_ENABLED=true` and `DEPS_ENABLED=true` against a 21-day
`active` seed (109,279 events) and a locally signed index, served it, and walked it at 1280 and
390 px with playwright-cli. Screenshots and saved responses stayed in the session scratchpad.

## Fine

- The 244-page build completed with stats and dependency pages. Home, `python-react`,
  `ci-github`, `/browse/newest/`, `/browse/trending/`, `/deps/`, scoped `@tanstack/react-query`
  and `/search/` returned 200 at both widths with no horizontal overflow.
- A stack's failing steps match its declared verify steps; `python-react` project counts agree
  between its page and trending.
- Canonical tags use `https://stacks.steamfield.io`; the footer's CLI source link goes to
  `https://github.com/steamfield/stacks`.
- Three home copy buttons copied their visible commands. A rejected clipboard write selected the
  prompt and announced the Cmd+C or Ctrl+C instruction.
- The fragment page leads with adding to an existing repository; `python-react` offers the full
  project and the quick experiment with its declared checks.

## Findings

| Severity | Where | Finding | Resolution |
| --- | --- | --- | --- |
| Product decision | Stack, trending, dependency stats | Seeded figures show as "Stacks projects" with no development label, although the API reports `population: "seeded development data"`. | Deliberate: stacks-api `f29dc79` (the maintainer's, 2026-10-28) removed the label and a test asserts it stays off. Left for the maintainer; S4's "keeps the seeded-data label" is out of date. |
| Should-fix | `/search/` | `add CI to my repo` listed ten weak stacks before the strong `ci-github` fragment. `noStrongMatch` is true because it counts stacks only (`rank.ts`), which is the contract. | `0d71dbf`: Fragments lead when no stack is strong and a fragment is. |
| Should-fix | Search ranking | `typescript api` ranks `python-react` first (both strong), ahead of `typescript-api`. | Known R13 limit in `rank.ts` (cached quality outweighs fit); needs a format release. Not in the demo path. |
| Nit | `/search/` | "1 stacks and 2 fragments found." | `0d71dbf`: singular counts. |

Not covered by this pass: the full RFC acceptance table (every filter, sort and Back combination,
every handoff mode, an audit of every number). The production walkthrough after R5 repeats the
main pages against the 120-day seed.
