# Submission (draft, R0)

## Demo scope

- Composition: `python-react --sandbox`, the site's example and `product/DEMO_OUTLINE.md`'s.
- App: a React view that makes a typed request to the Python API and renders the response, with
  one test that exercises that path end to end. No persistence, no auth, no expense tracker, no
  transaction review.
- Final acceptance: `stacks verify --all`. The sandbox manifest otherwise skips the production
  build; `--all` runs every step in the manifest and adds no fragments.
- Tools: `uv`, `bun`, `make`, `git`, `jq`, each checked with `--version` (`baseline.md`).
- Agent and model: Codex with Terra 6.1 (`gpt-6.1-terra`) for the proof run and rehearsal.
- Rho: excluded (S5, decided by the user 2026-10-28).

## Decisions recorded 2026-10-28

The user runs `npm publish`; agents run `prod:seed`, `prod:deploy` and push the release tag. CLI
version 0.4.0. `STACKS_DEMO` stays unset in production.

## Organizer requirements

The user owns these. Nothing before R6's recording waits on them.

| Item | State |
| --- | --- |
| Deadline and timezone | the user's |
| Video length, format, editing | the user's |
| Required links | the user's |
| Repository access (S6: the private `stacks-app`) | the user's |
| Sponsor eligibility | the user's |
| Live judging table | the user's |

## Rehearsal (R6 step 2, 2026-10-28)

A fresh Codex agent (`gpt-6.1-terra`, high effort) in an empty directory, with the packed 0.4.0
CLI on PATH and production as the API, got the demo request verbatim.

- It ran `stacks -h`, `stacks guide`, `stacks list --json` (not `search`), `stacks show
  python-react --json`, then `stacks new python-react dashboard-starter --sandbox --json`. The
  guide teaches `search` first; the agent skipped it. For the recording, keep the prompt and
  check the agent's first commands; rerun if it skips `search`.
- It picked `python-react` and named the tradeoff: generated client types keep API and UI
  aligned but add a regeneration step and more tooling.
- Plain `stacks verify` went green after three runs, zero interventions, 1.2 minutes from
  scaffold to green by `stacks runs`. It ran `make build` itself for the skipped `prod` step.
- `stacks verify --all` afterwards (run by Claude): green, 14 of 14 steps.
- Its hand-back said the brief was only partly implemented (CI, analytics, frontend coverage
  thresholds), which the sandbox brief allows ("fastest path to a green verify"). On camera,
  show `verify --all`, not that sentence.

## Production QA (2026-10-28)

A Terra QA agent walked the site at 1280 and 390 px and checked the API read-only. All API
routes returned the expected status in 0.09 to 0.25 s; 156 internal links returned 200; copy
buttons, Back, focus and canonicals were right; search ranks `python-react`, `go-cli` and
`ci-github` first for their queries. Findings: `/browse/trending/` is gone (removed on purpose
in stacks-api `e957690`; nothing links to it); search needs JavaScript (by design, with browse
links); and python-react's dependency reporter counts (5,445) exceed its project count (4,815)
in the same window. Fixed by stacks-api `1561803` and the final reseed: 5,080 projects, largest
dependency count 3,130 (`release.md`, "Final reseed and deploy").
