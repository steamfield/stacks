# Handoff for the next stacks session

Status: CURRENT 2026-11-15. Rewritten from scratch on that date. The dated running log it replaced,
phase 4 through the submission queue, is [archive/handoff-2026-10-28.md](archive/handoff-2026-10-28.md).

Start here, then read repo `AGENTS.md`, the README's
[product summary](README.md#product-to-preserve) and
[PROBLEM_STATEMENT.md](../product/PROBLEM_STATEMENT.md). Keep this file short: current state, next
steps, who owns each. When it grows past a couple of screens, move the dated detail to `archive/`
and leave a link. Update the "Where things stand" table whenever one of its facts changes; a stale
row here costs the next session more than a missing one.

## Where things stand (2026-11-15)

| Piece | State | Where to check |
| --- | --- | --- |
| CLI on npm | `@steamfield/stacks` 0.13.0, published 2026-11-15 by the tag-driven Release workflow from `v0.13.0` (`4bb7749c`) | `npm view <package> version` |
| This repo's `main` | At `v0.13.0` plus plans | `git log v0.13.0..origin/main` |
| `decks` stack | Shipped in 0.11.0 with its bench pass in the ledger; `@steamfield/decks` 1.0.0-rc.0 is on npm | `stacks show decks` |
| Hosted API and index | `stacks-api` `main` at `a0f3d0c`; production serves an index built from `v0.13.0` (`commit` `4bb7749c`, `minCli` `0.13.0`, checked 2026-11-15) | `curl https://stacks.steamfield.io/v1/index.json`, `bun run prod:health` in `stacks-api` |
| Public site | Cloudflare Worker `stacks-web`, rebuilt on every push to `stacks-api` `main` and after the `v0.12.0` deploy through its Workers Builds trigger; live with the table and trending redesign (below) | `stacks-api/docs/operations.md`, "The site on Cloudflare" |
| CLI reads the hosted index | No. Released CLIs ship `officialUrl: undefined` and an empty `INDEX_PUBLIC_KEYS`, so entry content reaches CLI users only through npm releases | `remote-first-index-rfc-2026-11-15.md` |

## Next steps

| # | Step | Owner | Notes |
| --- | --- | --- | --- |
| 1 | Remote-first index, then the registry repository split | An agent, in this repo (plus marked maintainer steps) | Execute from the RFCs, in this order: [remote-first-index-rfc-2026-11-15.md](remote-first-index-rfc-2026-11-15.md) (units R1 to R8, ships as CLI 0.14.0 together with the registry RFC's G2a, G2b and G2d), then [registry-repo-rfc-2026-11-15.md](registry-repo-rfc-2026-11-15.md) (G1, G3, then the G2c/G2e/G2f cut-over, ships as CLI 0.15.0). Both were reviewed by one devils-advocate pass on 2026-11-15 with every finding applied. Each unit is sized as one delegate contract and the "Sequencing" sections say what runs in parallel. Maintainer-only steps: generating the two index key pairs (R1), creating the GitHub repository and its branch protection (G1), and the submodule cut-over go-ahead (G2e). The request's interim registry-only CI was dropped (registry RFC, D-G10) |
| 2 | Recipe pages on the website (`/stacks/:id/recipe/`, `/fragments/:id/recipe/`): rendered guidance and a file browser | An agent, in `stacks-api` | Unblocked: `@steamfield/stacks-format` 0.8.0, which exports `shippedPath` and `outputPath` for it, is published |
| 3 | Confirm `AGENTS.md` "Pending user actions" | Maintainers | It still lists a telemetry launch sequence that ends in a release. The CLI has since been released several times (0.12.0), so most of it is probably done; remove what is, and say what is not |
| 4 | Decide the open drafts below | Maintainers | None is scheduled |

Each release follows `AGENTS.md` "Releasing" (changelog, `bun run release <x.y.z>`, push, tag; the Release workflow publishes), then `bun run prod:deploy -- --ref v<version>` in `stacks-api` (`--dry-run` first) and a rebuild of the `stacks-web` Worker. Deploy the API before pushing site changes that read new data (see Findings).

### Open plans (not executed)

| Plan | Status | What is needed |
| --- | --- | --- |
| [zero-edit-proof-gaps-2026-11-14.md](zero-edit-proof-gaps-2026-11-14.md) | DRAFT | Choose option 1, 2 or 3; three of four canaries cannot pass `bun run prove`, so shared-fragment changes still need agent runs for them |
| [remote-first-index-rfc-2026-11-15.md](remote-first-index-rfc-2026-11-15.md) | REVIEWED, ready to execute; step 1 | Implements [the remote-first request](feature-request-remote-first-registry-2026-11-14.md) |
| [registry-repo-rfc-2026-11-15.md](registry-repo-rfc-2026-11-15.md) | REVIEWED, ready to execute after the remote-first RFC; step 1 | Implements [the registry repository request](feature-request-registry-repo-2026-11-15.md) |
| [feature-request-react-component-library-2026-11-02.md](feature-request-react-component-library-2026-11-02.md) | PROPOSED | A stack or fragment for tree-shakeable React libraries; raised from `@steamfield/ui` |
| [fragment-admission-rfc-2026-11-01.md](fragment-admission-rfc-2026-11-01.md) | REVIEWED, not scheduled | Fragment compatibility is N by M; the RFC proposes how fragments are admitted |
| [stack-pairing-rfc-2026-11-18.md](stack-pairing-rfc-2026-11-18.md) | DRAFT, reviewed twice by the architect agent and once by devils-advocate; Phase 0 spikes run 2026-11-18 ([notes](runs/2026-11-18-stack-pairing-spikes/README.md)) with no stop condition met, and the RFC revised from them; that revision is unreviewed; not scheduled | Workspace stacks: a stack that mounts an API stack and a client stack as parts, so `python-react` stops duplicating `python-api`. Follows step 1 (it needs the index and the registry's `minCli`), and shares a placement input with the fragment admission RFC. Its Phase 1, convention alignment in the registry, can run before step 1 lands |
| [stack-pairing-v2-rfc-2026-11-18.md](stack-pairing-v2-rfc-2026-11-18.md) | DEFERRED DRAFT | Free composition by flag and workspace results in search. Starts only after version 1 ships and a second client stack exists |
| [edge-hosting-rfc-2026-11-01.md](edge-hosting-rfc-2026-11-01.md) | REVIEWED; D41 decided | The site is on Workers; the API stays on the container (cost). Search on the edge waits for the scale trigger in "Search" |
| [registry-expansion.md](registry-expansion.md) | APPROVED; Batch 1 EXECUTED | Batches 2 and later (`better-auth`, the `posthog` revision, Sentry, Stripe) are not recorded as started. The 27-stack expansion (executed 2026-11-01) landed some of their stacks another way (`nuxt`, `django`), so reconcile the plan with what is in `registry/` before starting; each new entry also needs its `plain` block and dependency card |
| [stack-audit-2026-10-29.md](stack-audit-2026-10-29.md) | EXECUTED except task 8 | Task 8, the dev-logs fragment extraction, is blocked on typecheck and the word budget: it needs a different design or should be dropped |
| [phases/phase-4.5d-semantic-retrieval.md](phases/phase-4.5d-semantic-retrieval.md) | DRAFT | Gated on 4.5c's evaluation |
| [phases/phase-5.0-ci-release-and-checks.md](phases/phase-5.0-ci-release-and-checks.md), [5.1](phases/phase-5.1-scheduled-canary.md), [5.2](phases/phase-5.2-ci-index-build-and-deploy.md) | DRAFT | Release workflow with provenance, scheduled canary, CI-built index deploys. `stacks-api` has a `deploy-index.yml` workflow that stays off until `INDEX_DEPLOY_ENABLED` is `true` |
| [phases/phase-3.2a-git-sources-and-untrusted-origin.md](phases/phase-3.2a-git-sources-and-untrusted-origin.md), [3.2b](phases/phase-3.2b-source-updates-and-trust-report.md) | DEFERRED | Start only when someone outside the maintainers asks for third-party sources |
| [submission-readiness/README.md](submission-readiness/README.md) | DRAFT 2026-10-28 | Hackathon-era tracker (R5, R6, R9, R10, R11, R13). Check its dates against the real deadline; if that has passed, archive it |

### Statuses that look stale and need a maintainer to confirm

- [phases/phase-0.0-decisions-and-npm-name.md](phases/phase-0.0-decisions-and-npm-name.md) is IN PROGRESS
  from 2026-10-26, but the name is `@steamfield/stacks` and it is published.
- [phases/phase-4.2c-directory-browsing.md](phases/phase-4.2c-directory-browsing.md) and
  [4.2f](phases/phase-4.2f-stats-pages-and-charts.md) are IN PROGRESS from 2026-10-27/28. The
  directory, stats pages, trending and dependency pages are built and live in `stacks-api`.
  Whether anything in those plans is still open is for whoever owns the site to say.

## Findings from the 2026-11-14/15 session

These come from work in `stacks-api` (the site and its deploys). Each is here so the next session
doesn't have to find it again.

### Deploy the API before pushing site changes

A push to `stacks-api` `main` rebuilds the site on Cloudflare, and that build reads the index and
stats from the live API. The first build of the redesign failed (`Workers Builds: stacks-web`,
conclusion `failure`, no log through the GitHub API) because the API and index it reads hadn't been
redeployed yet. Run locally with `WORKERS_CI=1` and the production index key, the same build passed
once production was deployed, and an empty commit then re-ran the Worker build successfully. I
didn't read the dashboard log, so the cause is inferred. Run `prod:deploy` first, or retry the build
after it.

### `prod:deploy` can't rebuild the old index

Its `--previous` check needs the production key that stacks 0.9.0 added. At `ed53c72`, the commit
the live index was built from, it fails with "signature verification failed". The first deploy after
that has to move the index to `v0.9.0` or later, which is what happened on 2026-11-15.

### A deploy doesn't change what the CLI writes

Released CLIs don't read the hosted index yet (see "CLI reads the hosted index" above), so
`prod:deploy` changes the site and the API, and entry content reaches CLI users only through npm.

### Smaller things

- `stacks-api`'s pre-push hook runs the whole browser suite, about five minutes. `bun run check` is
  the same gate: 225 test files, 1,993 tests and 207 browser tests passed (1 skipped) on the commit
  that was pushed.
- `bun run dev:bg` stops with "Port 4321 is already in use" when another checkout's servers are
  running. Pass `PORT_API=<free> PORT_WEB=<free>`; the machine has `free-port`.
- Claude Code sessions here are denied `bun run dev` (it runs a foreground server), `git reset
  --hard`, history rewrites and recursive deletes outside the project. Ask instead of rephrasing.
  `git checkout <ref> -- <path>` restores a single file.

### The site redesign

Merged to `stacks-api` `main` on 2026-11-15. Every table outside the landing page, `/browse` and the
docs is one sortable `DataTable` (TanStack Table v9). `/trending/` opens with a sentence naming what
is trending, ranks dependencies by reporting projects, and no longer has the single-package chart or
the not-trending chips. `/deps/` is a table of ecosystems, an ecosystem page is a table, and a
dependency page leads with the stacks that include it. The stack page draws a package's major
versions as a stacked bar.

The maintainer rates the pages about 5 out of 10 and wants more. Known gaps: the trending and
dependency tables scroll sideways on a 390px screen instead of stacking, the search page's tables
don't sort (they sit in an island slot), and the stack and fragment layouts are still as the
maintainer's own rebuild left them. `stacks-api/docs/web.md` ("Tables", "Trending", "Dependencies")
describes what exists.

## Branches and worktrees nobody owns

- This repo: pruned on 2026-11-15. Branches already in `main` were deleted with their worktrees,
  and so was every branch older than 2026-11-01 (unmerged, at these commits if one is wanted back):
  `delegate/biome-next` `97d2cff6` (`nextjs` on Biome), `feat/phase-2.3-code-analysis-records`
  `8a76d8c0` and `pr-1` `1e7c35fe` (the static-analysis records of closed PR #1), and on origin
  `feat/wizard-discovery` `67fc6fbd` and `feat/phase-4.3-typescript-mcp-stack` `3c87629e`
  (superseded by PR #8). Left: `origin/feat/ts-library-refinements` (already in `main`) and
  Dependabot PR #12 (the actions group), which is open.
- `stacks-api`: `delegate/a13` (the old handoff called it stale and superseded by 4.1e's tools),
  `claude/workers-build-trigger`, `delegate/t-4.2f`, `feat/search-population`,
  `delegate/rank-tables` (merged), `refactor/sfui-dry` (a worktree under `.sfui-worktrees`).

## Where the detail lives

| What | Where |
| --- | --- |
| Product, requirements, phases, decisions D0 to D42 | [README.md](README.md), [requirements.md](requirements.md), [roadmap.md](roadmap.md) |
| Risks and open questions | [risks-and-open-questions.md](risks-and-open-questions.md) |
| Executed and retired plans | [archive/README.md](archive/README.md) |
| Bench and gate run notes (the evidence behind the ledger) | [runs/README.md](runs/README.md) |
| How to release and what the release tool does | `AGENTS.md` ("Commands"), `packages/format/README.md` ("Publishing") |
| How the hosted side is deployed | `stacks-api/docs/operations.md` ("Production", "The site on Cloudflare") |
| What each site page shows | `stacks-api/docs/web.md` |
