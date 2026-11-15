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
| CLI on npm | `@steamfield/stacks` 0.9.0, `@steamfield/stacks-format` 0.7.0, `@steamfield/stacks-mcp` 0.1.2 | `npm view <package> version` |
| This repo's `main` | `908fcb16`, ten commits past the `v0.9.0` tag, none released: help-text fixes, a crash on a removed working directory, structural cleanup, the `SearchLastRun` format rename, `agent-ops` wording | `git log v0.9.0..origin/main` |
| `decks` stack | One unpushed commit on `feat/decks-stack` in the main checkout; allowlist row, dependency card and golden judgments missing; `@steamfield/decks` is not on npm | [decks-release-2026-11-15.md](decks-release-2026-11-15.md) |
| Hosted API and index | `stacks-api` `main` at `6e82a31`; production deployed 2026-11-15 with an index built from `v0.9.0` (`dd8449c5`, 66 entries, `minCli` 0.9.0) | `curl https://stacks.steamfield.io/v1/index.json`, `bun run prod:health` in `stacks-api` |
| Public site | Cloudflare Worker `stacks-web`, rebuilt on every push to `stacks-api` `main`; live with the table and trending redesign (below) | `stacks-api/docs/operations.md`, "The site on Cloudflare" |
| CLI reads the hosted index | No. Released CLIs ship `officialUrl: undefined` and an empty `INDEX_PUBLIC_KEYS`, so entry content reaches CLI users only through npm releases | `feature-request-remote-first-registry-2026-11-14.md` |

## Next steps

| # | Step | Owner | Notes |
| --- | --- | --- | --- |
| 1 | Finish `decks`, merge it, prepare the release | An agent, in this repo | The whole sequence is [decks-release-2026-11-15.md](decks-release-2026-11-15.md); it stops before the publish. Start a session in this checkout so its hooks apply |
| 2 | Publish `@steamfield/decks` | Maintainers | Outside this repo (`~/Projects/decks`). Until then `decks` cannot install and cannot be benched |
| 3 | `bun run release` (or `release:dry-run` first) | **Maintainers only** (`AGENTS.md`) | Publishes format, then the CLI, then MCP, from `origin/main`, and tags `v<cli version>` |
| 4 | Redeploy the index from the new tag | A maintainer or an agent in `stacks-api` | `bun run prod:deploy -- --ref v<new version> --dry-run`, then without `--dry-run`; then retry the Worker's latest build. Deploy the API before pushing site changes that read new data (see Findings) |
| 5 | Bench `decks`, commit the ledger record | Maintainers (tokens) | `bun run bench decks --keep`, after step 2 |
| 6 | Confirm `AGENTS.md` "Pending user actions" | Maintainers | It still lists a telemetry launch sequence that ends in `bun run release`. The CLI has since been released several times (0.9.0), so most of it is probably done; remove what is, and say what is not |
| 7 | Decide the open drafts below | Maintainers | None is scheduled |

### Open plans (not executed)

| Plan | Status | What is needed |
| --- | --- | --- |
| [zero-edit-proof-gaps-2026-11-14.md](zero-edit-proof-gaps-2026-11-14.md) | DRAFT | Choose option 1, 2 or 3; three of four canaries cannot pass `bun run prove`, so shared-fragment changes still need agent runs for them |
| `feature-request-remote-first-registry-2026-11-14.md` | PROPOSED | Starts by shipping the production index key in `packages/format/src/index-keys.ts` and setting `officialUrl` in `bin.ts` |
| `feature-request-react-component-library-2026-11-02.md` | PROPOSED | A stack or fragment for tree-shakeable React libraries; raised from `@steamfield/ui` |
| [fragment-admission-rfc-2026-11-01.md](fragment-admission-rfc-2026-11-01.md) | REVIEWED, not scheduled | Fragment compatibility is N by M; the RFC proposes how fragments are admitted |
| [edge-hosting-rfc-2026-11-01.md](edge-hosting-rfc-2026-11-01.md) | REVIEWED; D41 decided | The site is on Workers; the API stays on the container (cost). Search on the edge waits for the scale trigger in "Search" |
| [registry-expansion.md](registry-expansion.md) | APPROVED; Batch 1 EXECUTED | Batches 2 and later (`better-auth`, the `posthog` revision, Sentry, Stripe) are not recorded as started. The 27-stack expansion (executed 2026-11-01) landed some of their stacks another way (`nuxt`, `django`), so reconcile the plan with what is in `registry/` before starting; each new entry also needs its `plain` block and dependency card |
| [stack-audit-2026-10-29.md](stack-audit-2026-10-29.md) | EXECUTED except task 8 | Task 8, the dev-logs fragment extraction, is blocked on typecheck and the word budget: it needs a different design or should be dropped |
| [phases/phase-4.5d-semantic-retrieval.md](phases/phase-4.5d-semantic-retrieval.md) | DRAFT | Gated on 4.5c's evaluation |
| [phases/phase-5.0-ci-release-and-checks.md](phases/phase-5.0-ci-release-and-checks.md), [5.1](phases/phase-5.1-scheduled-canary.md), [5.2](phases/phase-5.2-ci-index-build-and-deploy.md) | DRAFT | Release workflow with provenance, scheduled canary, CI-built index deploys. `stacks-api` has a `deploy-index.yml` workflow that stays off until `INDEX_DEPLOY_ENABLED` is `true` |
| [phases/phase-3.2a-git-sources-and-untrusted-origin.md](phases/phase-3.2a-git-sources-and-untrusted-origin.md), [3.2b](phases/phase-3.2b-source-updates-and-trust-report.md) | DEFERRED | Start only when someone outside the maintainers asks for third-party sources |
| [submission-readiness/README.md](submission-readiness/README.md) | DRAFT 2026-10-28 | Hackathon-era tracker (R5, R6, R9, R10, R11, R13). Check its dates against the real deadline; if that has passed, archive it |

The two `feature-request-*` files are untracked in the maintainer's main checkout (`plans/`), not on
`origin/main`, so they are named here without links. Commit them with the next docs change.

### Statuses that look stale and need a maintainer to confirm

- [phases/phase-0.0-decisions-and-npm-name.md](phases/phase-0.0-decisions-and-npm-name.md) is IN PROGRESS
  from 2026-10-26, but the name is `@steamfield/stacks` and it is published.
- [phases/phase-4.2c-directory-browsing.md](phases/phase-4.2c-directory-browsing.md) and
  [4.2f](phases/phase-4.2f-stats-pages-and-charts.md) are IN PROGRESS from 2026-10-27/28. The
  directory, stats pages, trending and dependency pages are built and live in `stacks-api`.
  Whether anything in those plans is still open is for whoever owns the site to say.

## Findings from the 2026-11-14/15 session

Work in `stacks-api` (the site and deploys), with a note on each so the next session does not
rediscover it.

- **Deploy order.** A push to `stacks-api` `main` rebuilds the site on Cloudflare. The first build of
  the redesign failed (`Workers Builds: stacks-web`, conclusion `failure`, no output through the
  API) because it ran before the API and index it reads had been redeployed. The same build, run
  locally with `WORKERS_CI=1` and the production index key, passed once production was deployed; an
  empty commit then re-ran it successfully. The build log was not read in the dashboard, so the
  cause is inferred. Deploy the API first (`prod:deploy`), then push, or retry the build after.
- **`prod:deploy` cannot rebuild an old index.** Its `--previous` check needs the production key that
  stacks 0.9.0 added; at `ed53c72` it fails with "signature verification failed". The first deploy
  after that point has to move the index to `v0.9.0` or later.
- **The index change is not user-visible in the CLI yet.** See "CLI reads the hosted index" above.
- **Pre-push in `stacks-api` runs the whole browser suite** (about five minutes); `bun run check`
  is the same gate and passed on the commit that was pushed: 225 test files, 1,993 tests, 207
  browser tests passed and 1 skipped.
- **Dev servers collide.** `bun run dev:bg` stopped with "Port 4321 is already in use" when another
  checkout's servers were running. Pass `PORT_API=<free> PORT_WEB=<free>` (the machine has
  `free-port`).
- **Agent guards.** Claude Code sessions in these repositories are denied `bun run dev` (a
  foreground server), `git reset --hard`, history rewrites and recursive deletes outside the project.
  Ask rather than rephrase; use `git checkout <ref> -- <path>` for a single file.
- **The site redesign** (`stacks-api`, merged to `main` 2026-11-15): one shared sortable `DataTable`
  (TanStack Table v9) for every table outside the landing page, `/browse` and docs; `/trending/`
  leads with what is trending, ranks dependencies by reporting projects and drops the single-package
  chart and the not-trending chips; `/deps/` is a table of ecosystems, an ecosystem page is a table
  and a dependency page leads with the stacks that include it; the stack page draws a package's
  majors as a stacked bar. The maintainer rated the pages about 5 of 10 and wants more: known gaps are
  tables that scroll sideways on a 390px screen instead of stacking (trending, dependencies), the
  search page's tables not sorting (they sit in an island slot), and the stack and fragment page
  layouts, which are otherwise as the maintainer's rebuild left them. `stacks-api/docs/web.md`
  ("Tables", "Trending", "Dependencies") describes what exists.

## Branches and worktrees nobody owns

Seen on 2026-11-15, not touched by this session. Each is the owner's to merge or delete.

- This repo: `feat/decks-stack` (step 1), `delegate/biome-next` (a worktree under
  `.claude/worktrees/biome-next`), `feat/phase-2.3-code-analysis-records`, `pr-1`, and a Codex
  worktree `stack-library-manual-qa`. The worktree `.claude/worktrees/agent-dx`
  (`chore/rebench-0.9.0`) is already merged into `main` and can go.
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
