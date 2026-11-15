# Problem statement

What stacks is for, who it is for, and what has to be true for it to be worth building. Written from the product side so that technical decisions (the format, the CLI, the registry, the hosted API) can be checked against it. Designs should trace back to a line here.

## The problem in one sentence

Developers who start projects with a coding agent can't get a consistent, current, fully tested setup from either side of the table: templates hand them a frozen snapshot that starts aging the day it ships, and an agent with no target builds a different project every time and skips the parts that make a project trustworthy (tests, lint, CI, agent config). Each new project costs an afternoon of setup, and the result is still less complete than what they'd build by hand.

## Who has it

Four kinds of user, in order of how much they matter today.

**The developer who starts projects often.** Senior, opinionated, has a setup they have built by hand five times and would rather write down once. Uses a coding agent for most work. Their frustration is not that they can't set up a project; it's that they keep redoing it, and that an agent left to its own devices doesn't build it the way they would. Success is a project that matches what they'd have built, with the tests and tooling they'd have added, in the time it takes to make coffee.

**The coding agent.** The CLI's main reader. It runs `search "<the user's words>" --json`, reads `show <id> --json` for the strongest matches, explains its pick, runs `new`, follows the brief, and loops on `verify`. An agent whose client prefers tools reaches the same results through the MCP server. Its frustration is ambiguity: a brief that says "set up testing" without saying which layers, a verify command that doesn't exist, a decision with no default, two stacks it can't tell apart. Success is reaching a green `verify` without asking the user anything the brief or the catalog could have answered.

**The developer under time pressure.** A technical interview with AI allowed, a hackathon, a spike. They need a running environment with tests in minutes and will never deploy it. Success is time to first passing test.

**The stack author.** Someone with a project they trust who wants to distill it into something reusable, for themselves, their team, or strangers. Their frustration is that the only proof a stack works is an end-to-end agent run, and nothing tells them when their prose has gone stale. Success is knowing a stack still produces a working project without running it by hand.

## What's broken today

Two existing approaches, each with a failure mode the other doesn't have.

**Templates and generators** (Yeoman, cookiecutter, the `create-*` family) ship files with versions in them. The template is correct the day it's published. Six months later a new project starts with outdated dependencies and a deprecated config format, and its first task is a migration. Maintainers spend their time bumping versions instead of improving the template, and most templates stop being maintained. Templates also can't express intent: "mypy strict with the pydantic plugin" has to be a committed `pyproject.toml` that will be wrong for the next mypy.

**A bare agent prompt** ("set up a FastAPI and React project with tests") has the opposite problem. The agent is good at the perishable part: it can read current docs, run the generators, and fix what breaks. It's bad at the durable part. It has no definition of done, so it stops when the dev server starts. It makes a fresh set of layout and tooling choices every run. It skips test setup, lint config, CI, and agent config unless asked, and asking in enough detail is the afternoon the user was trying to save.

The split stacks makes is that humans own what lasts (what the project is made of, how it's laid out, what the tools must enforce, what "working" means) and agents own what ages (versions, generator flags, config formats). Neither existing approach draws that line.

## What exists today

A short map for someone, or some agent, arriving cold. Counts are as of November 2026.

- **The CLI** (`@steamfield/stacks`, command `stacks`). `search`, `list` and `show` find and review entries; `new` composes a stack with its fragments into starter files, `.stacks/BRIEF.md` and a manifest, then hands the project to the user's agent; `add` applies fragments to an existing repository without overwriting anything; `verify` runs the manifest's steps and is the definition of done; `runs` reports a project's own verify history. `create`, `validate` and `submit` are the author's path from a personal entry to a pull request against the public registry.
- **The registry.** 42 stacks and 23 fragments ship inside the CLI, each with a search card. A run ledger records agent runs that took a stack to a green verify; every bundled stack has at least one.
- **The format package** (`@steamfield/stacks-format`) owns the contracts the CLI and the hosted side share: entry format, manifest, run record, telemetry events, bundles, the signed index, search and stats shapes.
- **The MCP server** (`@steamfield/stacks-mcp`) wraps the CLI's `--json` results as three tools (list, new, verify) and serves the guides as resources, under the same trust rules as a shell.
- **The hosted side** (a separate repository) serves search, published usage and outcome stats, and the catalog site at stacks.steamfield.io. It receives anonymous telemetry, which is on by default after a one-time notice and can be turned off.
- **Agent skills and a Claude Code plugin** teach an agent the loop and the authoring workflow.

The trust model is what makes the rest safe to use: the CLI executes nothing it reads and never calls a model, only `verify` runs commands and only the project's own manifest steps, trust comes from where an entry was found, and anything that needs a confirmation needs a person. `.claude/rules/architecture.md` has the numbered points.

Every network feature is optional. Search falls back to local ranking, stats and the remote index are simply absent, and `--offline` turns all of it off. The signed remote index and the signed dependency allowlist are built but switched off until the maintainers publish index keys.

## Evidence

Most of this is the maintainers' own experience, not data from users. The assumptions log below says what's still unproven.

- The repetition is real for at least the maintainers: each stack worth bundling comes from a production project that has been set up by hand more than once.
- End-to-end agent runs are where stack prose gets corrected. A run surfaces agent-specific behavior (a dev server that never exits, a step the agent misreads) that fails `verify` until the stack says what to do, and the fix goes back into the stack so the next project starts with it. A bare prompt would hit the same problems with nothing carried forward, and a template could not carry the lesson at all.
- Stack prose grows without a budget, so there is one. `validate` fails a stack body over 2,000 words, a fragment over 1,000, an app over 3,000, and a composed brief over 6,000 (9,000 with an app).
- The run ledger holds 51 agent runs, 50 of them green, covering all 42 bundled stacks. All used the sandbox preset and a default composition, so no optional fragment and no decision-making run has its own evidence yet.
- The quality signal is still manual. A maintainer runs the bench by hand; nothing scheduled takes a stack to a green `verify` after a change, so a stack can go months untested against current releases.
- The hosted stats are seeded development data until real telemetry replaces them. They show what the measures look like and say nothing yet about real use.

## Jobs to be done

When I start a new project, I want the same well-tested setup I'd build by hand, without spending the afternoon, so I can start on the actual problem.

When I'm in a timed exercise, I want a running dev environment with tests in a few minutes, so the time goes to the task and not to tooling.

When I've settled on a stack I rebuild often, I want to write it down once, including the agent tooling, so every new project starts where the last one ended.

When I have an existing repo, I want to add a known-good piece (CI, agent hooks, Postgres) without it overwriting what's there, so the repo gets better instead of different.

When I'm an agent asked to set up a project, I want to find the right starting point from the user's own words and a target I can verify against, so I know what to pick, when I'm done, and don't have to guess at what the user considers complete.

When I'm choosing between stacks, I want to see what each sets up, what it's good and bad at, and whether projects started from it reach green, so I can decide without reading every recipe.

The emotional job underneath all of these is trust: the user wants to start work in a project they don't have to audit first. That is why `verify` exists, why the brief refuses to let the agent weaken a step, and why the CLI never runs commands from an entry.

## What success looks like

Measured per stack, not per release.

| Outcome | Measure | Collected by |
| :---- | :---- | :---- |
| The agent finishes without help | Fraction of projects that reach a green `verify`, and how often the agent had to ask | Telemetry (green rate with a confidence interval, the `asked` count from the project's notes), published as stats |
| It's faster than by hand | Median time from `new` to green `verify` (target: under 20 minutes for a sandbox run) | Telemetry and the run ledger's minutes to green; `stacks runs` for one project |
| The result is complete | Every shipped stack's verify covers install, lint, typecheck, test, and a dev-server probe where there is a server | `validate` on the bundled registry |
| Stacks don't rot | A stack that passed last month still passes this month without a prose change | Nothing yet: needs a scheduled canary |
| People write their own | Stacks and fragments in `~/.config/stacks` and third-party sources, and pull requests from `submit` | Not measured; no outside entry exists yet |

Published stats are suppressed below a minimum sample and rounded, so a new or rarely used stack shows no numbers. That is the intended state, and anything that reads stats has to work without them.

## Assumptions

| Assumption | Evidence | Confidence | How to validate |
| :---- | :---- | :---- | :---- |
| Agents can follow a brief of up to 6,000 words faithfully (9,000 with an app) | 50 green ledger runs at or under the budget, all sandbox preset; hesitations and skipped instructions not counted | Medium | Count `asked` and skipped instructions per run once real telemetry exists; tighten the budget if they rise with size |
| Version-less prose rots much more slowly than templates | Reasoning only | Medium | The scheduled canary; count prose edits per stack per quarter |
| `verify` is enough of a definition of done to keep an agent honest | The step-digest tamper check and the brief's rules; not yet tested against an agent trying to get to green | Medium | Inspect projects from runs for no-op targets and weakened tests |
| Search over the user's own words finds the right stack | Search cards for every entry and a ranking shared by the CLI and the API; judged by the maintainers' own example requests | Low | Compare what search returned with what was scaffolded, from telemetry |
| Aggregate outcome stats help someone choose | None; the stats are seeded | Low | After launch, watch whether picks follow the stats and whether they predict a project's own result |
| Users want to bring their own stacks (not only consume a registry) | The maintainers' own need; `create`, `validate --submission` and `submit` exist | Low | Watch whether anyone besides the maintainers writes a STACK.md or opens a submission |
| Handoff to whatever agent is on PATH is the right entry point | Matches how the maintainers work | Low | Telemetry's entry-point split: `new` from a terminal against an agent running it |
| A community registry will form | The submission path exists; no outside entry yet | Low | Count pull requests to the registry from outside |

## What this is not

- Not a template engine. `files/` ships as much of a working project as it can (source, tests, configs), but never a version: the agent installs current releases and brings the shipped files up to them, and verify fails when a shipped file has gone stale. A template's stale files become the user's migration; a stack's become one fix loop for the agent at setup.
- Not an agent. The CLI never calls an LLM and never runs a command from a stack. The agent the user already has does the work.
- Not a package manager or version resolver. Versions are the agent's problem on purpose.
- Not a way to retrofit an existing project onto a stack. `add` applies fragments; it does not restructure what's there.
- Not a service you depend on. The CLI works offline from its bundled registry; the hosted side adds search quality, stats and a catalog, and nothing breaks when it is unreachable.

## Open questions

- **Who is the bundled registry for?** Some entries are ones a stranger would want (a Python and React app, a Go CLI, GitHub CI, Postgres); others encode one team's tooling. If the product is "write your stack down once", the personal ones belong in the user registry or a personal source. If it's a community catalog, every bundled entry needs to earn its place. The registry's origin layering supports either; the bundled content should pick one.
- **How does a stack prove it still works?** Manual bench runs don't scale past a handful of stacks, and the ledger only says a stack passed once. A scheduled canary is the product's CI; until one exists, someone has to run the bench by hand.
- **When do the signed index and real stats go live?** Both are built. The index needs published keys, and the stats need real telemetry in place of the seeded data. Until then the catalog's numbers describe nothing real and a new stack reaches users only through a CLI release.
- **What does evidence for a non-default composition look like?** Every ledger run is a default composition under the sandbox preset. Optional fragments, apps and the decision-making preset ship without their own proof.
