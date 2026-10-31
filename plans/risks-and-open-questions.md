# Risks and open questions

Status: DRAFT 2026-10-26, from the assumptions and open questions in
[PROBLEM_STATEMENT.md](../product/PROBLEM_STATEMENT.md#assumptions) and the demo-first
proposal (D23). Updated 2026-10-27 after phases 1 to 3: questions answered by what shipped
say so and keep their numbers, because plans link to them by number.

## Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Agents don't follow a long brief faithfully (confidence medium at 3,000 words, low at 10,000) | Skipped instructions show up as incomplete projects that still look finished; this is the assumption the problem statement says to test next | Set the brief budget (D5) before the second stack; run a brief near 3,000 words and one near 5,000 (D13) and count hesitations and skipped instructions. The budget keeps stacks away from 10,000 words; it sidesteps the 10,000-word question rather than answering it, and the plan has no run that tests it. First data, 2026-10-27 ([1.6b runs](runs/)): Claude Code followed composed briefs of 3,233 to 4,753 words to green in 3 to 5 minutes with nothing asked; what earlier rounds missed traced to contradictions and gaps in the briefs, not skipped instructions. One agent, one counting run per stack |
| Stack prose grows without a budget | Each stack and fragment adds a little prose for one more case, so briefs can grow several times over across a handful of stacks; past a point nobody cuts them | `validate` enforces the budget (D5); detail that only one project needs goes into a fragment |
| Version-less prose rots anyway (confidence medium) | The product's main advantage over templates is unproven past one stack | Record prose edits per stack per quarter; bench reruns by hand ([2.0b](archive/phases/phase-2.0b-bench-2026-10-30.md)); the canary ([5.1](phases/phase-5.1-scheduled-canary.md), phase 5 under D8 and D23) |
| Until phase 5, nothing reruns stacks on a schedule (D23) | Rot shows up only when a maintainer reruns the bench or a user reports it | The bench makes a rerun one command per stack; `validate`'s rot checks ([2.2](archive/phases/phase-2.2-deterministic-rot-checks-2026-10-30.md)) run without an agent; the ledger shows each stack's last green date |
| `verify` isn't enough to keep an agent honest (confidence medium) | An agent can reach green with no-op targets or weakened tests, and the user trusts a project they shouldn't | Tamper detection on verify steps with the coverage in the [trust model](roadmap.md#trust-model) point 5; the brief forbids weakening a step and says what counts as weakening; changed steps fail verify (D14, [1.3b](archive/phases/phase-1.3b-tamper-detection-and-run-records-2026-10-30.md)); inspect projects from bench runs ([2.0b](archive/phases/phase-2.0b-bench-2026-10-30.md)) for no-op targets and weakened tests |
| Stacks are only tested by hand | The only quality signal is a manual end-to-end run nobody has time for; stacks silently break | Run records from the MVP on ([1.3b](archive/phases/phase-1.3b-tamper-detection-and-run-records-2026-10-30.md)); ledger and bench ([2.0c](archive/phases/phase-2.0c-run-ledger-2026-10-30.md), [2.0b](archive/phases/phase-2.0b-bench-2026-10-30.md)); the canary (D8, [5.1](phases/phase-5.1-scheduled-canary.md)). As of 2026-10-27 the run records, ledger and bench exist, but only D13's three stacks have a green run; the other bundled stacks, and the bench proofs 3.3a-c, 3.4a, 3.4b and 3.5b name, wait on maintainer bench runs |
| Nobody besides the maintainers writes a stack (confidence low) | Jobs 3 and 4 and the registry plans assume they will | Make release 1 worth using with bundled stacks alone; watch for any outside stack before investing in third-party sources |
| A community registry never forms (confidence low) | Work on third-party sources and a directory would be wasted | Third-party sources ([3.2a](phases/phase-3.2a-git-sources-and-untrusted-origin.md)) start only when someone outside the maintainers asks for them; nothing in phase 4 depends on them |
| The entry point is wrong (confidence low) | Handoff to the agent on PATH matches how the maintainers work, not necessarily anyone else | Support both entry points and measure which is used (D9) |
| A cloned repo ships project-local entries | An agent that picks a stack the repo shipped follows prose nobody reviewed | Every project-origin entry is untrusted until allowlisted (D19, [trust model](roadmap.md#trust-model) point 2); the agent never picks one unless the user names it |
| Third-party stacks ship hooks or scripts the user's agent will run | A source is a supply-chain path into the user's machine | The CLI never runs entry commands (D2); untrusted origins are marked in `list --json`; git sources are pinned, fetched with hardened git calls, and confirmed after an allowlist trust report ([3.2a](phases/phase-3.2a-git-sources-and-untrusted-origin.md), [3.2b](phases/phase-3.2b-source-updates-and-trust-report.md), trust model point 6) |
| The base stack ships a Bun binary, but users arrive through `npx` | Without a Node-runnable package, the problem statement's first command fails | Decide A1 in [0.2](archive/phases/phase-0.2-npm-distribution-artifact-2026-10-30.md) ([roadmap](roadmap.md#open-architecture-questions)); local e2e tests the packed tarball that's actually published. A1 decided 2026-10-27: one `stacks` package on npm, a Node ESM bundle with every dependency bundled |
| The name is taken before it's published | An unreserved name can be taken by an unrelated package at any time, and a lookalike can follow. The agent skill and its plugin copy fall back to `npx -y @steamfield/stacks@latest`, so whoever publishes the name runs code on those users' machines | Publish only inside the maintainers' `@steamfield` scope (D36), where no one else can claim a name: the CLI is `@steamfield/stacks`, the format package `@steamfield/stacks-format` and the MCP server `@steamfield/stacks-mcp`. Corrected 2026-10-28: the `@stacks` scope recorded as reserved on 2026-10-27 belongs to an unrelated project |
| A manual publish ships something the gate didn't test (D23) | No release workflow checks the tarball before it reaches npm | [1.6c](archive/phases/phase-1.6c-first-release-2026-10-30.md) publishes the exact tarball 1.6b's gate ran, by file digest; [5.0](phases/phase-5.0-ci-release-and-checks.md) automates it. D34: 0.1.0 is published by hand from the packed tarball, without provenance |
| Agents running inside sandboxes can't write the user's state directory | The second copy of the step digest and first-green times go missing, so tamper detection falls back to the manifest's own copy | Commands still work and report `stateRecord: false`; `manifest-only` never passes the gate (D20) ([1.2b](archive/phases/phase-1.2b-manifest-state-and-detection-2026-10-30.md), [1.3b](archive/phases/phase-1.3b-tamper-detection-and-run-records-2026-10-30.md)) |
| Headless agent logins don't survive a throwaway HOME | Copied OAuth credentials rotate and invalidate the original; keychain logins can't be copied | Long-lived tokens passed by env (D24) |
| The canary depends on one maintainer machine and one agent subscription (D15) | A machine that's off or a lapsed subscription looks like stacks passing silently | The canary reports its own last successful run; a missed schedule is itself an alert; infra failures are a separate class from rot ([5.1](phases/phase-5.1-scheduled-canary.md)) |
| Telemetry, once added, costs trust in a tool that already hands a repo to an agent | The emotional job is trust | No collection before D17 and a published schema; the first enabled run sends nothing; consent is checked again at send time ([4.1a](archive/phases/phase-4.1a-telemetry-cli-client-2026-10-30.md) to [4.1c](archive/phases/phase-4.1c-telemetry-maintenance-and-retention-2026-10-30.md)) |
| A stack's own prose and one of its fragments cover the same ground | `validate` only catches mechanical clashes (file owners, env, step names). A stack body that already sets up CI, hooks or a database and a fragment that does it differently compose cleanly but give the agent contradictory guidance; the result is a messy project or a red bench run, found late. The 1.6b runs bear this out: what earlier rounds missed traced to contradictions and gaps in the briefs, not to their length | An authoring rule that a stack's body never does what one of its own fragments does; `conflicts` declared by hand for known overlaps; a bench run of each stack's default composition ([2.0b](archive/phases/phase-2.0b-bench-2026-10-30.md)). A `validate` heuristic for overlap (shared tools, deps or headings between a stack and a fragment that applies to it) is open |

## Open questions for the maintainers

1. Who is the bundled registry for: a community catalog, or the maintainers' own stack
   written down once? Proposal D6 picks the catalog. The answer decides which entries
   ship bundled.
2. What is the brief budget, per stack and for stack plus fragments? Proposal D5.
   Answered 2026-10-27: D5's amended numbers shipped in 1.5 (`validate/budget.ts::BUDGET`:
   stack body 2,000 words, fragment 1,000, app 3,000, composed brief 6,000, or 9,000 with an
   app). The 1.6b briefs of 3,200 to 4,800 words fit with room to spare; no run has tested a
   brief near the limit.
3. Does the canary belong before `add` and authoring? Proposal D8, revised under D23:
   no, it moves to phase 5; local bench reruns come before authoring and sources.
   Answered 2026-10-27: the canary stays in phase 5; the bench (2.0b), ledger (2.0c) and
   rot checks (2.2) shipped before `add` and authoring.
4. Which stack goes first in phase 1? Proposal D13 says `astro-blog`. Ideally one with a
   small brief and a dev server, so phase 1 exercises every verify layer in D7 without
   testing the long-brief assumption at the same time. Answered 2026-10-27: D13 as amended;
   1.6b gated `astro-blog`, `go-cli` and `python-react`, each with a green counting run.
5. Should there be usage telemetry, and if so opt-in or opt-out? Two success measures
   ("finishes without help" across real users, "people write their own") can't be
   collected without it. Proposal D17; blocks
   [4.1a](archive/phases/phase-4.1a-telemetry-cli-client-2026-10-30.md).
6. Superseded 2026-10-27: the product was renamed to `stacks`, the repository's name,
   so there is no second name to reserve.
7. Does D5's budget count the brief's fixed text (about 700 words of ground rules,
   versions and definition of done), or only what authors write? The plan's default is to
   count it, because that is what the agent reads, and 1.5 reports `fixedWords` beside
   `briefWords` so a CLI wording change that pushes a stack over is visible. Answered
   2026-10-27: counted, as 1.5 shipped it. Switching to authored text only remains a small
   change where `src/core/validate/compositions.ts` compares a size with its limit.
8. Is the agent's own log of the questions it asked the user (`## Asked` in
   `.stacks/NOTES.md`) good enough to count interventions in interactive runs, or do
   interactive runs only count as anecdotes and headless bench runs carry the measure?
   Answered 2026-10-27: headless runs carry the measure. The 1.6b gate ran headless, and
   the bench counts `## Asked` lines (`countAsked`) plus one for each resume. Interactive
   runs count only with a maintainer watching as the second source. Whether a permission
   approval at the interactive handoff counts as an intervention is still open (1.6b).
9. `verify --accept-changes`, `stacks trust` and confirming a source are refused
   when an agent is detected or stdin is not a TTY. Some agents' shell tools may allocate
   a TTY and not set a marker, and the state directory and trust store are files the
   user's account (and so the agent) can edit. Is "a determined agent can still accept
   changes" acceptable, given D14 guards against accidental weakening and not an
   adversary? Answered 2026-10-27: accepted. 1.3b shipped the refusal (exit 6) as the guard
   against accidental acceptance, and does not claim to stop a determined agent.
10. Should dev-server probes be limited to local hosts as a format rule (so a verify step
    can't be pointed at an external URL)? Answered 2026-10-27: yes. 1.3a shipped it:
    `verify/probe.ts::probeTarget` accepts only http URLs on `localhost`, `127.0.0.1` or
    `::1` after `${VAR}` expansion.
11. The bench ([2.0b](archive/phases/phase-2.0b-bench-2026-10-30.md)) runs the agent with full permissions in
    a throwaway directory on a maintainer's own machine, because allowlisted headless runs
    can't write the agent config or git hook files every stack ships. A throwaway HOME
    doesn't stop that agent reading the real home by absolute path. The alternative is an
    allowlist of tools for the agent plus an explicit opt-in flag for full permissions; the
    plan keeps full permissions because the allowlisted run can't finish any stack.
    Answered 2026-10-27: full permissions approved for local runs by a maintainer (2.0b).
    Unattended runs are still isolated per D15, which 5.1 must honor.
12. A green bench run whose notes show a deliverable was never built is relabeled
    `partial` by hand, which means a maintainer reads every bench run. Is that a
    commitment the maintainers want, or should only failing and regression runs get a
    human read? Blocks 2.0b's exit.
13. Which GitHub token scopes does the canary get? Proposed answer, now part of D15: a
    fine-grained token on this repo only with contents, pull-request and issues write, with
    `main` protected so the token can't push to it. Blocks
    [5.1](phases/phase-5.1-scheduled-canary.md).
14. Should the registry index serve only stack content whose fingerprint has a passing
    ledger run (bench now, canary from phase 5)? Recommended in
    [4.0c](archive/phases/phase-4.0c-registry-index-2026-10-30.md): an index entry carries the
    digests of the composition that passed, and the last proven entry is carried forward
    when the current content isn't proven. Blocks 4.0c and
    [4.0d](archive/phases/phase-4.0d-cli-remote-origin-2026-10-30.md). Answered 2026-10-27: yes, proven only,
    with carry-forward; recorded with D21 in the decisions log.
15. What starts the MCP server ([4.3](phases/phase-4.3-mcp-server.md))? Revised proposal:
    documented agent struggles with the shell path (2.0b bench notes, issues), or a user
    asking for a client that has no shell tool. A majority of handoffs from inside an agent
    (4.2a, if D17 is agreed) shows the shell path works, so it is supporting context, not
    the trigger. Without telemetry, the two evidence sources above are enough. Blocks 4.3.
16. If D17 is declined, does the API still need a Worker at all, or does static hosting of
    the index and directory cover phase 4? Blocks
    [4.0f](phases/phase-4.0f-workers-migration.md); its spike answers it.
17. Does the Cloudflare Workers Vitest pool run with the API's Vitest 5 on Node? If not,
    API tests need another harness. Blocks 4.0f; its spike answers it first.
18. Should git sources keep the user's global git credential helper (so private repos
    work) or run with it disabled? Blocks
    [3.2a](phases/phase-3.2a-git-sources-and-untrusted-origin.md).
19. Is running the published package under Bun unsupported acceptable for release 1
    (D22)? Some users run `bunx` by habit. Answered 2026-10-27: yes (D22); the package's
    entry refuses the Bun runtime.
20. Is a manual `npm publish` without provenance acceptable for the first releases (D23),
    with provenance arriving in [5.0](phases/phase-5.0-ci-release-and-checks.md)?
    Answered 2026-10-27: yes, for 0.1.0 (D34).
21. The 80%-per-month target means about four bench or canary samples per stack per month,
    so one failure misses it. Keep the number, widen the window to a quarter, or set a
    minimum sample count? Blocks [5.1](phases/phase-5.1-scheduled-canary.md)'s report.
22. Is "under 20 minutes from `new` to green" an acceptable stand-in for the problem
    statement's "time to first passing test" for the time-pressure user? The plan records
    both (`firstTestPassAt`) and targets the stricter one. Answered 2026-10-27: both times
    are recorded and reported against the 20-minute target, as 1.6b did; its counting runs
    reached green in 3 to 5 minutes.
23. Do the maintainers own, or want to reserve, the `@stacks` npm scope? The MCP
    server ([4.3](phases/phase-4.3-mcp-server.md)) publishes as `@stacks/mcp`, with
    `stacks-mcp` as the fallback name. Answered 2026-10-27: a maintainer reserved the
    `@stacks` scope. Corrected 2026-10-28: the npm `@stacks` scope belongs to an unrelated
    project; the maintainers own `@steamfield`, where the CLI and the format package publish
    (D36). The MCP server publishes as `@steamfield/stacks-mcp`.

Questions 24-31 are behavior the plan chose on purpose where a gentler option exists. The
plan keeps its choice in each case; the maintainers confirm or change it.

24. Edited verify steps fail `verify` (exit 5, `VerifyChanged`) instead of warning (D14).
    The risk is an agent that "fixes" a step, hits the failure, and keeps editing. The
    brief ([1.1](archive/phases/phase-1.1-composition-and-brief-2026-10-30.md)) and the agent skill
    ([3.4c](archive/phases/phase-3.4c-agent-skill-2026-10-30.md), once it ships) tell the agent to stop, report what changed,
    and leave `verify --accept-changes` to the user. Is a hard stop with that instruction
    acceptable, or should the first changed run warn? Answered 2026-10-27: the hard stop,
    as 1.3b and the shipped skill (3.4c) have it.
25. Exit codes are specific (2, 3, 4, 5, 6, 130, and 128+N when passing through the
    agent's signal) rather than a generic 1 for every failure
    ([0.3a](archive/phases/phase-0.3a-errors-and-output-2026-10-30.md),
    [1.4](archive/phases/phase-1.4-handoff-and-entry-points-2026-10-30.md)). They are permanent once
    published. Keep the table as is? Answered 2026-10-27: kept, under A4
    (`errors.ts::errorTable`).
26. `--with` naming a fragment that doesn't apply to the chosen stack fails
    `ComposeConflict` rather than being dropped with a warning
    ([1.1](archive/phases/phase-1.1-composition-and-brief-2026-10-30.md)). An agent learns of its mistake
    immediately, at the cost of one more call. Keep the error? Answered 2026-10-27: no,
    reversed in 1.1. The fragment is kept with a `with_not_applicable` warning, because
    `--with` is an explicit request and `appliesTo` is the author's guess about fit.
27. An entry in a higher origin that fails to decode is listed as rejected and hides a
    working copy with the same id in a lower origin, rather than falling back to it
    ([1.0](archive/phases/phase-1.0-entry-format-and-registry-2026-10-30.md)). Safer, but a broken user
    override hides a good bundled stack until it's fixed. Answered 2026-10-27: kept, as 1.0
    shipped it; the rejected row's error names the copy it hides (`hides bundled copy`).
28. Default target agents are `--agents`, else `Settings.agents`, else Claude Code only; a
    detected non-Claude agent doesn't change the set
    ([1.1](archive/phases/phase-1.1-composition-and-brief-2026-10-30.md)). Until native adapters land (D27),
    adding the detected agent would only add AGENTS.md, which every stack writes anyway.
    Revisit when 3.4b ships: should the detected agent then join the default set? Still
    open: 3.4b shipped on 2026-10-27 without changing the default, so a Codex, OpenCode or
    Cursor user gets their adapters only with `--agents` or `Settings.agents`.
29. Network hashes use one secret key and expire after 30 days, rather than a key that
    rotates weekly ([4.1b](archive/phases/phase-4.1b-telemetry-ingest-and-storage-2026-10-30.md)). One key
    keeps 28-day concentration and capping counts exact; the cost is that a network can be
    linked across events for up to 30 days, which the `/telemetry` page says. Acceptable?
    Blocks 4.1b.
30. Concentration is handled by capping each contributor's share of a stats cell (each
    install counts at most 3 projects, and the effective sample is at most three times the
    distinct networks) rather than suppressing any cell where one contributor is over 20%
    ([4.2a](archive/phases/phase-4.2a-stats-rollup-and-routes-2026-10-30.md)). Capping keeps a stack's stats
    visible when one heavy user or a maintainer's own runs dominate it; minimum-sample
    suppression still applies. Confirm the cap values. Blocks 4.2a.
31. Green rates are broken down by the agent that ran the project, shown inside a stack's
    page and detail route and never as a ranking of agents across stacks
    ([4.2a](archive/phases/phase-4.2a-stats-rollup-and-routes-2026-10-30.md)). Is a per-stack breakdown
    acceptable to publish, given it lets readers compare agents on one stack? Blocks 4.2a.
    Settled in part 2026-10-27: there are no per-agent pages (4.2c dropped `/agents/*`);
    the per-stack breakdown is still open.

32. How does a change to a stack or fragment get accepted? The plan supplies the
    mechanical proof (`validate`, a green bench run of the affected compositions, "changed
    since last green") but no review protocol: what evidence a contribution carries (its
    own bench run record?), who blesses a change to a stack, how much an agent's first-pass
    review and refactor can stand in for a human's, and how a team enforces its own rules
    beyond its stacks' verify steps and a private source. Revisions are likely to arrive in
    bursts (a new tool, a stack still being learned), and a burst of fragment edits
    invalidates many compositions at once, which bench cost and the phase 5 schedule
    assume won't happen. Needed before
    [3.2a](phases/phase-3.2a-git-sources-and-untrusted-origin.md) opens outside sources
    and before [3.3a](archive/phases/phase-3.3a-release-and-deploy-fragments-2026-10-30.md) proves entries in
    bulk.
33. Should every public stats count be rounded to the nearest 5 (rates and interval bounds to
    two decimals), as [4.2a](archive/phases/phase-4.2a-stats-rollup-and-routes-2026-10-30.md) now proposes?
    Suppression stops small cells; rounding also blunts differencing between adjacent windows
    and filtered series points, at the cost of "215 projects" where the real number is 213.
    Blocks 4.2a's time filtering.
34. Should a stack page draw green rate by agent as a dot plot
    ([4.2f](phases/phase-4.2f-stats-pages-and-charts.md))? It is the same per-stack breakdown
    question 31 asks about, but a chart invites comparing agents more than a table row does.
    If not, the numbers stay in `show --json` and the page lists them without a chart.
35. How does the search golden set ([4.5a](archive/phases/phase-4.5a-search-evaluation-set-2026-10-30.md)) grow
    when no query text is ever logged (D36)? The plan's answer is bench requests, issues,
    the demo script and maintainers' own requests, reviewed by hand. That keeps queries
    private and makes the set reflect what maintainers imagine people ask.
36. Which embedding provider does [4.5d](phases/phase-4.5d-semantic-retrieval.md) use, if it
    starts: Workers AI through the Worker's binding (no new secret, request text stays on the
    API's platform), or a model through OpenRouter (wider model choice, a key on the Worker,
    and the request text sent to one more party)? The plan picks Workers AI. A third option
    keeps the request on the machine: embed the query locally with a small WASM model that
    the CLI downloads on demand into its cache (never bundled), and ship entry vectors in
    the signed index. It keeps D2 (no model call leaves the machine, and the model is data
    the CLI runs, not a service) and would let semantic search work in the local fallback and
    under `--local` (D36 as amended sends the request to the API by default). The cost is the download size, a model file the CLI
    must verify like the index, and an exception to A1's single-bundle rule. Blocks 4.5d.
37. `stacks-api/.claude/rules/api/effect-api.md` puts each store in
    `api/services/<Name>Store.ts` (its "Store" row: an in-memory layer for tests and local
    dev, a SQL layer needing only `SqlClient`); `apps/api/src` has no `services/` folder yet.
    The 4.1 and 4.2 plans name `store/`, `ingest/`, `stats/` and `maintenance/` folders; the
    new plans (4.2g, 4.5d) follow the rule for stores and still cite 4.1c's
    `maintenance/maintain.ts`. The rule is settled; the question is only whether the older
    plans move to it when they are executed. Related: [4.1b](archive/phases/phase-4.1b-telemetry-ingest-and-storage-2026-10-30.md)'s
    `GET /v1/schema/telemetry-event.v<N>.json` route ends in a file extension, which the
    API's routing rule reserves for static documents under `/v1/` (lowercase kebab segments
    ending `.json`); publishing it as a static document such as
    `v1/schema/telemetry-event-v1.json` fits that rule. 4.1b is not changed yet.
38. Should the stats routes offer only 7- and 28-day windows
    ([4.2a](archive/phases/phase-4.2a-stats-rollup-and-routes-2026-10-30.md))? A 90-day window was asked for, as
    trending-data APIs often have one. The plan refuses it: nothing reads it, and network
    hashes expire after 30 days (4.1c), so a 90-day cell couldn't apply the network cap; long
    trends come from the weekly series of 28-day values. Saying yes means either keeping
    hashes longer (a privacy cost) or publishing a 90-day cell with the install cap only.
39. Should search metadata ever be written on the server
    ([4.5b](archive/phases/phase-4.5b-search-metadata-2026-10-30.md))? The request was for metadata "authored or
    LLM-decorated through OpenRouter on the server". The plan keeps drafting in a
    maintainer-only script with review in pull requests, so every card is reviewed and the
    CLI works offline. The cost: entries from outside this repository, git sources (3.2a) and
    any future community index entries, get no card unless their author writes one, and rank
    on name, description, tags and body only. A server decorator is the only thing that would
    cover them, and it would need an LLM key on the Worker and a review step for text no
    maintainer wrote.
40. Should there be a native iOS stack? A request for "an iOS health app" now answers
    `mobile-expo`, an Expo and React Native app whose tags don't include `ios` and whose body
    warns that entitlements make `expo run:ios` demand signing; HealthKit is one such
    entitlement. [4.5a](archive/phases/phase-4.5a-search-evaluation-set-2026-10-30.md) records that answer and
    adds "a native SwiftUI iPhone app" with `mobile-expo` relevant at grade 1 and no `first`,
    like the Kotlin case; [4.5b](archive/phases/phase-4.5b-search-metadata-2026-10-30.md)'s `caveats` field lets
    the card tell the agent what HealthKit needs. The choice is a native Swift stack (with its
    own verify loop on macOS only) or accepting cross-platform as the answer to platform
    requests.
