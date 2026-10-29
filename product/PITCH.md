# stacks — pitch

Status: DRAFT 2026-10-28 — aligned with the current CLI and live directory. Recheck the deployed dataset and installed release before recording.

## The promise

**Find a tech stack that works. Have your agent build it.**

stacks gives your coding agent a reusable project recipe, a clear build brief, and checks that define a finished setup. Describe what you need or browse the catalog, inspect the fit, then let the agent you already use build the project and work toward green verification.

## The problem

Your next idea needs a foundation: frameworks, structure, tests, lint, CI, and instructions for your agent. Those decisions are familiar, but every project makes you assemble and explain them again.

Templates preserve a snapshot of yesterday's files. A bare prompt makes the agent choose everything again. stacks preserves the engineering decisions while the agent resolves current versions and configuration.

## Thirty-second pitch

> Someone has already worked through the setup your next project needs. stacks makes those project recipes discoverable and gives your coding agent a clear target. Find a suitable stack, inspect its tools and checks, and have your agent build from the brief. Then stacks verify runs the declared checks so you can see what passed and what needs work. Start with a foundation you can inspect, and spend your time on the product.

## Sixty-second demo pitch

> I want a small Python API and React dashboard, with a simple Rho sandbox example. My agent searches for a suitable foundation and explains the choice. We inspect its requirements and available evidence before starting.
>
> stacks combines the recipe with reusable fragments and writes a build brief. My coding agent handles current dependencies and implementation. We follow one requirement from the brief into the code and a meaningful test, then run the declared checks.
>
> The website lets me inspect the same stack and its outcome views. Usage, successful verification, and time to green answer different questions; the sample and data source matter.
>
> The result is a useful local starter I can change. stacks provides the foundation. My agent builds the project.

Keep Rho to a minimal read-only sandbox connection if ready. Otherwise demonstrate the starter's local API-to-UI example. Transaction thresholds, duplicate detection, and application deployment are outside this demo.

## What the developer gets

| Stage | Product contribution | Visible result |
| --- | --- | --- |
| Find | Searchable stack and fragment metadata, with local fallback | An explained recommendation grounded in the request |
| Inspect | Recipe requirements, tools, declared checks, and available evidence | A starting point the developer can review |
| Compose | A stack plus reusable fragments | Stable starter files and a project brief |
| Build | A concrete task for the existing coding agent | Current dependencies and an implemented starter |
| Verify | Checks from the project's manifest and run history | Passing and failing steps the agent can act on |

Search matches requests against metadata without calling a model. Fit and conflicts determine relevance; evidence can settle near-ties within a tier. Project counts do not raise search scores. The coding agent explains the recommendation to the developer.

The CLI writes context and stable starter files. The coding agent writes the application. Only verification executes the commands declared in the project's own manifest; scaffolding does not execute commands supplied by entries.

## Why it matters

- Reuse layout, tooling expectations, and verification requirements across projects.
- Let the agent resolve current versions instead of freezing a generated application.
- Inspect a recipe before creating a project.
- Finish against declared checks instead of stopping at a dev server.
- Add fragments to an existing project, parking conflicts for review rather than overwriting files.

Start with developers who repeatedly build with coding agents, teams that need consistent foundations, and builders under time pressure. Using a bundled recipe does not require authoring one first.

Shared recipes are central to the story. Show an actual source or contribution route before inviting submissions; the maintained directory alone does not establish an open third-party marketplace.

## What the website adds

The [live directory](https://stacks.steamfield.io/) connects the promise to specific stacks, tools, fragments, verification commands, and outcome views. The homepage's interactive walkthrough is scripted and runs no commands; record a separate real agent build.

The [Python + React page](https://stacks.steamfield.io/stacks/python-react/) exposes outcomes, time to green, failure categories, and composition breakdowns. Its ledger panel displayed “No ledger run recorded” during the October 28 inspection. Aggregate outcomes and current-recipe bench evidence are different signals.

**Data qualification:** as of the October 28 inspection, production serves seeded history. Treat displayed counts, rates, and timings as sample analytics until deployed provenance is confirmed. The site's four-hour self-setup baseline is illustrative, not a measured control run.

Keep the time window, sample, uncertainty interval, and dataset label visible. Time to green is conditional on projects that reached green; it is not a completion promise.

## Claims we can support

| Claim | Basis and boundary |
| --- | --- |
| A published CLI and documented quickstart exist | Package `@steamfield/stacks`; rehearse the exact release used |
| Search, scaffolding, composition, and verification exist | Current CLI and [command reference](../packages/cli/docs/reference/commands.md) |
| A live directory and outcome interface exist | Observed October 28; qualify the seeded metrics |
| A recipe has been exercised | Cite its dated run, configuration, and fingerprint |
| This demo reached green | Show a full recorded run and inspect meaningful assertions |

The handoff records an API/format transition affecting hosted search decoding and incomplete API evidence fields. Rehearse the installed client against the deployed API. If it falls back locally or evidence is absent, show that behavior honestly.

## Closing and next step

**Find your starting point. Give your agent a clear target. Verify what it builds.**

Browse [stacks.steamfield.io](https://stacks.steamfield.io/), then inspect the catalog:

```sh
npx @steamfield/stacks list stacks
```

See [DEMO_OUTLINE.md](DEMO_OUTLINE.md) for the recording and [PREP.md](PREP.md) for rehearsal.
