# stacks — demo outline

Historical: written for the hackathon stacks was first built for and not kept current. [PROBLEM_STATEMENT.md](PROBLEM_STATEMENT.md) is the maintained description of the product.

Status: DRAFT 2026-10-28 — a produced 4:45 video backed by an actual agent-build recording. Confirm the event's limit and submission rules before export.

## The story

**Describe a project → find a suitable stack → inspect the brief → let the agent build → verify the result.**

Carry one stack's identity through the live catalog, search, project brief, build, and outcome. The viewer should leave knowing what to try, why the recipe fits, and what passing verification establishes.

Use a small Python API and React dashboard. End at a working local starter; application deployment is outside this recording.

Positioning: [PITCH.md](PITCH.md). Rehearsal: [PREP.md](PREP.md).

## The request

> I want a small web tool with a Python API and a React dashboard. Find a suitable stack, explain the choice and tradeoffs, then build a working local starter with tests. Show me the declared checks and run them before handing back.

Keep the language and product requirements visible.

## Shot list and narration

| Time | Recorded screen | Draft narration |
| --- | --- | --- |
| 0:00–0:20 | Live homepage headline, then a real stack detail | “Every new project needs a foundation. stacks makes those starting points discoverable and gives your coding agent a clear target.” |
| 0:20–0:55 | Request, actual search response, agent recommendation | “My agent finds a suitable recipe and explains why it fits before creating anything.” |
| 0:55–1:20 | Requirements, tools, fragments, and declared checks | “I can inspect the setup and what working will mean before the build starts.” |
| 1:20–1:45 | Fresh scaffold, real brief and manifest | “stacks composes the recipe into a build brief. The checks are declared before implementation.” |
| 1:45–2:35 | Agent builds; trace one requirement into code and a test | “The agent handles current dependencies and configuration. This requirement is now implemented and tested.” |
| 2:35–3:10 | Full verify output, assertion, labeled command-change refusal | “stacks runs the declared checks and detects changed commands. Passing still depends on meaningful tests.” |
| 3:10–3:35 | Working local example and run report | “Here is the working starter and the measured time this run took to reach green.” |
| 3:35–4:20 | Same stack's website outcomes and one useful comparison | “Usage, successful verification, and time to green answer different questions. These displayed metrics use sample data for this demonstration.” |
| 4:20–4:45 | Starter beside catalog URL and tested quickstart | “Find your starting point. Give your agent a clear target. Verify what it builds.” |

Keep the sample-data sentence while the deployed dataset is seeded. Do not imply the site's scripted homepage interaction performed the recorded build.

## Discovery: show the choice

Rehearse the selected CLI release with:

```sh
stacks search "Python API and React dashboard" --kind stack --limit 3 --json
stacks show python-react --json
```

Capture the agent reading the response and explaining one fit reason and one tradeoff. Inspect `ranking`, `remote`, caveats, matching fields, and available evidence. Search relevance comes from fit; project counts do not raise scores. Evidence can distinguish near-ties within a tier.

If only one entry fits, inspect it rather than staging competition. If hosted search fails or is incompatible, show local fallback. Absent API evidence is not proof that no historical run exists.

Source `main`, the published CLI, and the deployed API can differ. The current handoff records a format/API transition and incomplete API evidence fields; rehearsal decides which path the footage can support.

## Composition: make the brief tangible

Use a fresh directory and a manual handoff:

```sh
stacks new python-react stacks-demo --sandbox --dry-run --json
stacks new python-react stacks-demo --sandbox --no-launch --json
```

Have the agent read `.stacks/BRIEF.md` in the generated project and carry it out. Open the brief beside `.stacks/manifest.json`. Show the actual selected fragments: sandbox changes the composition, so do not promise full-project defaults that were omitted.

Follow one requirement into implementation and a meaningful test, such as the typed frontend client calling the API. Accelerate waiting, label elapsed time, and return to normal speed for decisions and results.

## Verification: show what passed

From the generated project:

```sh
stacks verify --all
stacks runs
```

Show a full green result, required steps, and a representative assertion. Exit 0 can also represent a partial run; it is insufficient by itself for a complete-verification claim.

For the safeguard scene, change one recorded verification command in a disposable copy and show refusal. Label it as controlled footage, then return to the unchanged successful project. Do not use `--accept-changes` to erase the staged refusal.

Command integrity does not guarantee assertion quality. Inspect the test and confirm checks were not weakened or replaced by no-ops.

Show the starter's local API-to-UI interaction. No charge threshold, duplicate detector, payments, or application deployment.

## Website: inspect the evidence

Open [Python API + React SPA](https://stacks.steamfield.io/stacks/python-react/). First show its verification commands, then one outcome panel. Keep the data window, sample, uncertainty interval, and sample-data label visible.

- Separate green rate among attempted projects from projects that never ran verification.
- Explain time to green as conditional on successful projects, not a prediction.
- Separate aggregate outcomes across configurations from the recipe's ledger panel, which showed no recorded run on October 28.
- Use seeded charts to demonstrate inspection, not to claim community traction.
- Include dependency trends only if an actual working view is found and supports a specific decision.

The homepage's four-hour baseline is illustrative. Do not compare it with this run to claim a speedup. Finalized public metrics will not immediately reflect a just-completed demo run.

## Visual direction

Use the site's actual typography, colors, and stack names. Open on working software; an optional six-second title animation fits inside the opening twenty seconds. A two-second stack + fragments → brief overlay can clarify composition over real files.

Match-cut the chosen stack name between search, site, and project. Keep a small Choosing → Building → Checking → Working caption. Use readable output, quiet transitions, and captions. Avoid simulated typing or animated charts that resemble observed results.

Keep the source recording distinct from the site's scripted walkthrough, which uses a fixed example and runs no commands.

## Rehearsal branches

| Available result | What to show |
| --- | --- |
| Compatible hosted search with evidence | Actual API-ranked response and explained choice |
| Local fallback | Local ranking and recipe inspection; website sample analytics separately |
| Missing current-recipe evidence | Say it is unavailable; identify any historical evidence used |
| Seeded metrics | Persistent sample-data labeling |
| Build incomplete | Working portion and remaining failures; reduce completion claims |

## Deliverable and judging evidence

Retain uncut footage, CLI version, repo revision, composition, agent/model, verify output, run report, and interventions. Distinguish scaffold time from agent/build time. A comparative speedup needs an equivalent measured bare-agent run; otherwise report this run's duration.

Show technical execution through the fresh build, technical depth through composition and command-change refusal, and usability through a tested next step. Let a judge inspect the source, rerun checks, and open the starter.

Confirm video length, edited-upload acceptance, and account upload support before export. Check captions, audio, processing time, and share permissions. Provide reproduction commands and access to private hosted implementation through the accepted judging route if needed.

Existing event notes record a GitHub link, description, and Loom video due at 5 pm Thursday, October 29. Confirm the deadline, event timezone, and submission time allowance with the organizer. Keep a local recording for connectivity failures.
