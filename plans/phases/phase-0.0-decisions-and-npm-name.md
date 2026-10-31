# Phase 0.0: Decisions and name

Status: IN PROGRESS 2026-10-26. Competitive research and the name check are done (see
[requirements.md](../requirements.md#what-were-replacing) and the name check below). On
2026-10-26 the maintainers deferred the npm reservation and every decision that does not
block the prototype (see Deferred); the rest waits on them. The reservation is now part
of the final step before public release, with 0.2 and 1.6c.

| Field | Value |
|---|---|
| Goal | The npm name is held, the requirements are agreed, every decision an MVP sub-phase blocks on is made or explicitly deferred with a reason, A2-A4 are reviewed, and the first stack is named |
| Traces to | Open question "Is the npm name available? ... The name needs resolving before anything else in the roadmap matters"; open questions "Who is the bundled registry for?" and "What is the brief budget?" |
| Depends on | nothing. The A2-A4 review needs [0.3a](../archive/phases/phase-0.3a-errors-and-output-2026-10-30.md) and [0.3b](../archive/phases/phase-0.3b-processes-and-signals-2026-10-30.md) to have landed their answers |
| Blocks | [0.2](../archive/phases/phase-0.2-npm-distribution-artifact-2026-10-30.md) (A1, D12, D22, D23), [1.0](../archive/phases/phase-1.0-entry-format-and-registry-2026-10-30.md) (D19), [1.1](../archive/phases/phase-1.1-composition-and-brief-2026-10-30.md) and [1.6a](../archive/phases/phase-1.6a-bundled-stack-content-2026-10-30.md) drafting (D18), [1.3b](../archive/phases/phase-1.3b-tamper-detection-and-run-records-2026-10-30.md) (D14), [1.4](../archive/phases/phase-1.4-handoff-and-entry-points-2026-10-30.md) (D9), [1.5](../archive/phases/phase-1.5-validate-and-brief-budget-2026-10-30.md) (D5, D7), [1.6a](../archive/phases/phase-1.6a-bundled-stack-content-2026-10-30.md) (D5, D6, D13), [1.6b](../archive/phases/phase-1.6b-mvp-gate-runs-2026-10-30.md) (D20), [1.6c](../archive/phases/phase-1.6c-first-release-2026-10-30.md) (A2-A4 in the log, D20), phase 2 start (D8), [2.0b](../archive/phases/phase-2.0b-bench-2026-10-30.md) (D24), [4.0f](phase-4.0f-workers-migration.md) (D16), [4.0c](../archive/phases/phase-4.0c-registry-index-2026-10-30.md) and [4.0d](../archive/phases/phase-4.0d-cli-remote-origin-2026-10-30.md) (D21), [4.1a](../archive/phases/phase-4.1a-telemetry-cli-client-2026-10-30.md) (D17), [4.2d](../archive/phases/phase-4.2d-dependency-telemetry-client-and-ingest-2026-10-30.md) (D25), [3.4b](../archive/phases/phase-3.4b-native-agent-adapters-2026-10-30.md) (D27), [5.1](phase-5.1-scheduled-canary.md) (D15, D24) |
| Decisions needed | A1 and D5-D9, D12-D28 from [requirements.md](../requirements.md#proposed-decisions), plus the maintainers' review of A2-A4. Not all at once: the gating table below says which ones the MVP needs. A "no" on any of them sends the blocked sub-phase back to its plan before work starts; it does not block this file |
| Settles | Nothing by itself. Each agreed proposal moves to the [README decisions log](../README.md#decisions-log) with its ID unchanged |

## Scope

In: reserving the name, reviewing the requirements, deciding or deferring each proposal,
reviewing A2-A4 once 0.3a and 0.3b have answered them, confirming the success-rate target,
and naming the first stack.

Out: any code. The repo baseline is [0.1](../archive/phases/phase-0.1-repo-baseline-2026-10-30.md); distribution is
[0.2](../archive/phases/phase-0.2-npm-distribution-artifact-2026-10-30.md).

## Design

### Tasks

| Task | Owner | Done when |
|---|---|---|
| Reserve `quickstack` on npm with a placeholder package | maintainers | `npm view quickstack` shows the placeholder |
| Check `quickstack` on GitHub and as a domain; record what's taken in the name check below | an agent | The table below filled in, with the date checked |
| Review [requirements.md](../requirements.md) and mark it AGREED or list the changes | maintainers | Its `Status:` line says AGREED with a date |
| Decide the MVP-gating proposals (table below) | maintainers | Each is in the decisions log or under Deferred below with a reason |
| Review A2-A4 as answered in [0.3a](../archive/phases/phase-0.3a-errors-and-output-2026-10-30.md) (A2, A4) and [0.3b](../archive/phases/phase-0.3b-processes-and-signals-2026-10-30.md) (A3) | maintainers | A2-A4 are in the decisions log before [1.6c](../archive/phases/phase-1.6c-first-release-2026-10-30.md) publishes. Exit 5, the `details` envelope and the signal policy are permanent once agents depend on them ([roadmap, MVP cutline](../roadmap.md#mvp-cutline)) |
| Confirm the success-rate target for "the agent finishes without help" | maintainers | D20 agreed or changed: the gate is every bundled stack with one recorded green zero-intervention run with `tamperCheck: "full"`; two of three green on the first attempt is the success-rate target, not the gate; then 80% of bench and canary runs per stack per month (open question 21 asks whether the monthly window is too small) |
| Name the first stack (open question 4) | maintainers | D13 agreed or changed. Proposal: `astro-blog`, the smallest brief with a dev server, so [1.3a](../archive/phases/phase-1.3a-verify-runner-and-probes-2026-10-30.md) exercises every D7 layer without also testing the long-brief assumption |
| Answer the open questions that block MVP sub-phases: 7 ([1.5](../archive/phases/phase-1.5-validate-and-brief-budget-2026-10-30.md)), 8 and 22 ([1.6b](../archive/phases/phase-1.6b-mvp-gate-runs-2026-10-30.md)), 9 ([1.3b](../archive/phases/phase-1.3b-tamper-detection-and-run-records-2026-10-30.md)), 10 ([1.6a](../archive/phases/phase-1.6a-bundled-stack-content-2026-10-30.md)), 19 ([0.2](../archive/phases/phase-0.2-npm-distribution-artifact-2026-10-30.md)), 20 ([1.6c](../archive/phases/phase-1.6c-first-release-2026-10-30.md)) | maintainers | Each answered in [risks-and-open-questions.md](../risks-and-open-questions.md#open-questions-for-the-maintainers) or deferred below |
| Competitive research | an agent | Done 2026-10-26 |

### Which decisions gate what

The MVP needs thirteen answers (A1 and twelve proposals), plus the A2-A4 review. The
other ten proposals can wait until their phase starts; the roadmap is written so a "not yet" on
them doesn't block phase 1. The sub-phase each one blocks matches the
[roadmap's decision table](../roadmap.md#decisions-and-open-architecture-questions-by-sub-phase).

| ID | Proposal, short form | Blocks | Needed by |
|---|---|---|---|
| A1 | Ship a Node ESM bundle on npm | 0.2 | Before 0.2 starts |
| D12 | Node range `>=22` for the published package | 0.2 | Before 0.2 starts |
| D22 | macOS and Linux on the Node runtime only; Bun runtime refused | 0.2 | Before 0.2 starts |
| D23 | Demo first: CI and scheduled inference move to phase 5 | The roadmap order; 0.2 and 1.6c scope | Before 0.2 starts |
| D19 | Project-origin entries untrusted by default | 1.0 | Before 1.0 |
| D18 | Entry format v1 | 1.1 start; 1.6a drafting | Before 1.1 |
| D5 | Brief budget numbers | 1.5 enforcement, and 1.6a's stack prose | Before 1.5 |
| D7 | Verify layers every stack must cover | 1.5 | Before 1.5 |
| D9 | Both entry points, handoff kind recorded | 1.4 | Before 1.4 |
| D14 | Changed verify steps fail verify | 1.3b | Before 1.3b |
| D6 | Bundled registry is a curated catalog | 1.6a | Before 1.6a |
| D13 | The three MVP stacks and their word targets | 1.6a | Before 1.6a (drafting can start after 1.0) |
| D20 | The MVP gate rule | 1.6b, 1.6c | Before 1.6b |
| A2, A4 | Live progress on stderr only; closed `details` and exit 5 | 1.6c publishes | Reviewed after 0.3a; in the log before 1.6c |
| A3 | Signal policy for interactive children | 1.6c publishes | Reviewed after 0.3b; in the log before 1.6c |
| D8 | Canary in phase 5; local proof before authoring and sources | Phase 2 start | After the MVP gate |
| D24 | Headless agent auth by long-lived token | 2.0b, 5.1 | Before 2.0b |
| D16 | API hosting | 4.0f | Decided 2026-10-27 with D35 |
| D21 | Signed default index | 4.0c, 4.0d | Before 4.0c |
| D17 | Telemetry consent | 4.1a | Before 4.1a |
| D15 | Where the canary runs, on whose agent account, with what isolation and token | 5.1 | Before 5.1 |
| D28 | Superseded 2026-10-26 by the amended D18 (`package_scope` is in v1) | n/a | n/a |
| D27 | Native adapters for Codex, OpenCode and Cursor | 3.4b | Before 3.4b |
| D26 | Superseded 2026-10-26 by the amended D18 (apps are `category: app` fragments) | n/a | n/a |
| D25 | Dependency-version telemetry, allowlisted names only (needs D17) | 4.2d | Before 4.2d |

A2-A4 are architecture questions an agent answers in 0.3a and 0.3b, building to the
roadmap's recommendation. Building first is deliberate: the review is of working code and
tests, and the review can still change details because nothing is published until 1.6c.

### Name check

| Where | `quickstacks` | `quickstack` | Checked |
|---|---|---|---|
| npm | Free (404) | Free (404) | 2026-10-26 |
| GitHub user or org | Free (404) | Taken: user `QuickStack`, created 2013 | 2026-10-26 |
| GitHub repos with the name | 2 unrelated, 0 stars (`QuickStacks-Software-Developpment/MainSite`, an org with that name, and `QuickStackSort`) | About 100, including `yoshinorim/quickstack` (336 stars, a MySQL stack-trace tool) and `biersoeckli/QuickStack` (363 stars, a self-hosted PaaS) | 2026-10-26 |
| Domain `.com` | Registered 2005 (Tucows) | Registered 2000 (GoDaddy) | 2026-10-26 |
| Domain `.dev` | Free (RDAP 404) | Registered (Infomaniak name servers) | 2026-10-26 |
| Domain `.io` | Free | Registered 2025-11-29 (Porkbun) | 2026-10-26 |
| Domain `.sh` | Free | Free | 2026-10-26 |

`quickstacks` is the clearer name: free on npm, as a GitHub account, and on `.dev`, `.io`
and `.sh`. `quickstack` collides with two established GitHub projects and has its `.com`,
`.dev` and `.io` taken, so holding it on npm (open question 6) would only guard against
typo-squatting. Superseded 2026-10-27: the maintainers renamed the product to
`quickstack`, the repository's name, which was still free on npm (D0, amended).

### Deferred

Decisions the maintainers chose not to make yet, each with its reason and the sub-phase
that will ask again.

On 2026-10-26 the maintainers deferred everything here that does not block the prototype:
the first goal is a working core loop run from the repo (`bun run dev`, or the compiled
binary), and packaging for npm is a distribution task that can come later. Each deferred
item is asked again by the sub-phase it blocks, and none of them blocks
[0.3a](../archive/phases/phase-0.3a-errors-and-output-2026-10-30.md) or [0.3b](../archive/phases/phase-0.3b-processes-and-signals-2026-10-30.md).

| Item | Deferred to | Reason |
|---|---|---|
| Reserving `quickstack` on npm | The final step before public release, together with [0.2](../archive/phases/phase-0.2-npm-distribution-artifact-2026-10-30.md) and [1.6c](../archive/phases/phase-1.6c-first-release-2026-10-30.md), not before 1.6b; sooner only if someone else takes the name | Distribution is not needed for the prototype. The name was free on 2026-10-26; the risk of waiting is that someone registers it |
| A1, D12, D22 and open question 19 | Before [0.2](../archive/phases/phase-0.2-npm-distribution-artifact-2026-10-30.md), which now runs as part of the final step before public release, after the roadmap's feature gaps and not before [1.6b](../archive/phases/phase-1.6b-mvp-gate-runs-2026-10-30.md) | They only shape the npm package. Until 0.2 lands, phase 1 uses the stubs its files already describe (a stub registry path, `Host.invocation` fixed to `quickstack`) |
| D23 | Before [1.6c](../archive/phases/phase-1.6c-first-release-2026-10-30.md) | The roadmap is already written to it; nothing before 1.6c changes if it is agreed later |
| requirements.md review and the remaining MVP-gating proposals (D5-D7, D9, D13, D14, D18-D20) | Each before the sub-phase the gating table names | None of them blocks phase 0's code; each phase-1 sub-phase asks for its own decision before work starts |
| Review of A2-A4 | After 0.3a and 0.3b land, before 1.6c | The review is of the built code, as planned |

## Files and areas touched

`plans/README.md` (decisions log), `plans/requirements.md` (status line, proposals that
move out), `plans/risks-and-open-questions.md` (answered questions), and this file. No
code.

## Acceptance tests

None in code. The checks are on the documents:

- Every MVP row in the gating table (A1 through D20, and A2-A4) has a row in either the
  README decisions log or the Deferred list above, with a date.
- `grep -n "Status:" plans/*.md plans/phases/*.md` shows no file without a status line.

## Exit criteria

- `npm view quickstack` shows the maintainers' package.
- requirements.md is AGREED.
- A1, D5, D6, D7, D9, D12, D13, D14 and D18-D20, D22 and D23 are each in the decisions
  log or deferred with a reason. Anything deferred that gates an MVP sub-phase blocks
  that sub-phase, not this one.
- A2-A4 are in the decisions log, or this file stays IN PROGRESS for that row alone
  until they are; 1.6c checks it before publishing.
- The first stack is named.
- `bun run check` is still green from the repo root (no code changes are expected; this
  is the same check [0.1](../archive/phases/phase-0.1-repo-baseline-2026-10-30.md) ends with).

## What this plan may get wrong

- 2026-10-27: the maintainers renamed the product to `quickstack`, which is also free on npm.

- Reserving a name with a placeholder package can trip npm's policy on squatting if
  nothing is published for a long time. If phase 1 slips, publish a real 0.0.x with
  `doctor` and `--version` rather than leave the placeholder.
- Thirteen decisions in one review is a lot. If the review stalls, take A1, D12, D22 and
  D23 first: they unblock 0.2. 0.3a and 0.3b need no decision, and 1.0 needs only D19.
- Reviewing A2-A4 after the code exists risks the review rubber-stamping what was built.
  0.3a and 0.3b each state the options they rejected, so the maintainers review a choice,
  not only a diff.
