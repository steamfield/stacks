# R0 baseline (2026-10-28)

Recorded by the orchestrator session executing the submission-readiness plan, from the
`quickstack` main checkout at `c9da9cd` and `stacks-api` main at `34b3e5b`. Both clean.

## Repository state

### quickstack worktrees and branches

| Worktree / branch | Last commit | Dirty | Verdict |
| --- | --- | --- | --- |
| main checkout | `c9da9cd` docs(plans): handoff records the gate flake fixes | no | |
| `.claude/worktrees/publish-format-0.2.0` (detached) | `c10b411`, 15 h ago | no | superseded: commit is on `main` |
| `.claude/worktrees/self-update` (`delegate/self-update`) | `0d20e90` chore(release): 0.3.0, 28 h ago | no | superseded: commit is on `main` |
| Codex worktree `stack-library-manual-qa` | `5dfc58a`, 16 h ago | no | superseded: commit is on `main` |
| session scratch worktree `pr1-work` (`feat/phase-2.3-code-analysis-records`) | `8a76d8c`, 2 days ago | no | ask the user: not on `main`, phase 2.3 work outside this plan |
| branch `pr-1` | `1e7c35f`, 2 days ago | n/a | ask the user: not on `main`, same phase 2.3 work |
| `.claude/worktrees/q-bench-codex`, `q-r1-guide`, `q-r13-relevance` | created by this run | | this run's units |

### stacks-api worktrees and branches

| Worktree / branch | Last commit | Dirty | Verdict |
| --- | --- | --- | --- |
| main checkout | `34b3e5b` Merge fix/retention-timeout | no | |
| Codex `ux-browse-flow` (detached) | `b74a7e9` feat(web): apply forest and lime design system | no | superseded: on `main` |
| Codex `ux-handoff-flow` (detached) | `0f3d6ea` feat(web): clarify project handoffs | no | superseded: on `main` |
| `.claude/worktrees/a13` (`delegate/a13`) | `2f2ab07`, on `main` | 6 files (smoke, package.json, deploy, help, production scripts; untracked `scripts/query.ts`) | ask the user: HANDOFF calls it superseded by 4.1e's query tools (`scripts/query.ts` exists on `main`), but the uncommitted edits weren't compared line by line |
| `.claude/worktrees/t-4.2f` (`delegate/t-4.2f`) | `0b6c6e5` 4.2f acceptance tests, unmerged | no | leave: R9 brings it onto `main` |
| `h4a`, `h4b` and the unmerged `delegate/a3`, `delegate/t-4.5e-api`, `delegate/t-4.2e-api`, `delegate/t-4.2d-api` the plan listed | gone | | already removed by their session |
| `.claude/worktrees/a-r2-seed`, `a-r4-web` | created by this run | | this run's units |

## Versions

| What | Value |
| --- | --- |
| npm `@steamfield/stacks` | 0.3.1 |
| npm `@steamfield/stacks-format` | 0.4.0 |
| `packages/cli/package.json` / `packages/format/package.json` | 0.3.1 / 0.4.0 |
| stacks-api catalog `@steamfield/stacks-format` | `^0.4.0` (`bun.lock` resolves through `catalog:`) |
| Production `/healthz` | `{"status":"ok","maintenanceFresh":true}` |
| Production index | commit `6060b55`, generated 2026-10-28T20:21:18Z |
| Production canonical | `https://example.com/` |
| Production `/deps/` | 404 |

## Active seed

No `seed/index.ts` process is running. `.dev/data/active.sqlite` exists but couldn't be opened
read-only from this session (`unable to open database file`); R2 seeds its own sample instead, so
the in-flight store isn't needed.

## Audit gaps

| Gap | State |
| --- | --- |
| Published CLI lacks search and stats | still open: npm has 0.3.1; R5 releases 0.4.0 |
| Live search uses older penalty encoding | partly closed: live hits carry `penalties` columns and `evidence.stats`; `go cli` had no penalties to inspect |
| Nonsense search returns zero-score hits | still open: live `q=!!!` returns five zero-score stacks with `noStrongMatch: true`; format 0.4.0 on `main` fixes it at R5's deploy |
| Guide, help footer and `guideCommands` teach different paths | still open: `guide.ts` prose names `search`, `guideCommands` and `helpFooter` don't (R1) |
| Seed has sparse dependency evidence, install-only failures | R2 owns |
| `/deps/` 404, canonical `example.com`, clipboard failure | still open (R4) |

## EPERM test

`bun run test:unit tests/mobile-dev-ownership.test.ts -t "mobile dev cleans owned groups after signal"`
on the dev Mac (local, not rr): 1 passed, 9 skipped, 1.25 s. It doesn't reproduce locally, so it's
the `m4-mini` host issue HANDOFF records; R5 reruns it alone if the gate trips on it.

## Tools for the demo stack

`stacks show python-react --json` lists `uv`, `bun`, `make`, `git`, `jq`. Each runs: uv 0.12.23,
bun 1.4.2, GNU Make 3.81, git 2.56.0, jq 1.8.2. Node v24.21.0, codex-cli 0.165.0.
