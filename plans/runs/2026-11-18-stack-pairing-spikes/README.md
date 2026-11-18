# Stack pairing spikes, 2026-11-18

Phase 0 of [the workspace stacks RFC](../../stack-pairing-rfc-2026-11-18.md). Four spikes, run by agents in scratch directories and one throwaway worktree. Nothing merged. The RFC was revised from these results the same day.

Outcome: mounting is workable and the design continues. No spike hit its stop condition. The results change the link, the proxy rule, the adapter rule, the placement rule for a fragment named by two parts, and the size of Phases 1 and 3.

What these runs do not show: no workspace was taken to green through `stacks verify` (the hand-built ones have no manifest, and the composer spike did not run to green); each agent comparison is one run with one model; the composer spike's worktree was cut at 6b9c28f2, 74 commits behind `main` and before the CLI structure refactor, so its patch names old file paths and does not apply to `main`.

Files here: `spike1-brief-python.md` (the frozen composed brief the agents worked from), `spike1-file-ledger.md` (every hand-written file with its owner), the two run logs and the baseline's, `spike1-hono-report.md`, `spike3-composer.patch`, and `spike4-adapters.md` (full report with documentation sources). The Spike 2 and Spike 3 reports came back as text only and are summarized below.

## Spike 1: a hand-built workspace

Built twice by hand: `python-api` + `react-vite`, then `hono-api` + the same frontend. Both reached green on a root `make check` (each part's lint, typecheck and tests, both drift checks, and one request through the client's proxy to the running API).

Mounting. Neither part needed a change to be mounted. The cost is the role contract, and it falls on `react-vite`: 1 file for the dev proxy, 9 for the rename from `items` to `notes`, 1 for a generic `request` method on its API client, and about 10 documents left stale by the rename. `python-api` needed nothing. `hono-api` already served `/v1`, `notes`, `/healthz` and `PORT_API`; it needed a 35-line script that dumps its OpenAPI document in process with a `--check` mode, and two package scripts.

The backend swap. With `hono-api` in place of `python-api`, `frontend/` differed in one file by two lines: the page's generated hook is `useNotesListNotes` from FastAPI's operation id and `useListNotes` from Hono's. The link's own files were identical. Root files changed little: 12 of 59 Makefile lines, about 8 of 52 workspace-body lines.

The link. `react-vite`'s API client was not a usable mutator: it is an instance in React context offering `get(path, schema)` only. It took the `request` method in `react-vite` plus an adapter the link ships (`src/api/orval-fetch.ts`), and generated calls lose zod runtime validation. The link also had to change files `react-vite` owns: two `package.json` scripts, two `biome.json` excludes, and a page. The first two files are templates, which `plan-files.ts` refuses to merge, and the page is a second writer. Zod schemas and MSW mocks were dropped from the link: nothing used the first, and the second needs a faker dependency and duplicates `react-vite`'s fixtures.

The proxy. The RFC's rule (`/api` rewrites to `/v1`) conflicts with a generated client whose paths already start with `/v1`; the build worked around it by stripping `/v1` in the adapter. `/healthz` sits outside `/v1` and returned 404 through the proxy. `vite preview` does use `server.proxy` (Vite 8.3.8 sets `proxy: preview?.proxy ?? server.proxy`).

`openapi.json` cannot ship in `files/`: its bytes depend on the installed framework release. Setup generates and commits it in both API stacks.

The two OpenAPI documents agree on paths and the four note fields. Operation ids, schema names (`Page` and `NotePage`), the path parameter (`noteId` and `id`), whether `nextCursor` is required, and the error envelope all differ. The frontend works with both because it reads only the status and the `x-request-id` header.

Root assumptions found in part files: each part installs lefthook only if `lefthook.yml` is beside it; `python-api` reads `backend/.env` and never the root one; `react-vite`'s proxy falls back to port 8000 while `hono-api` defaults to 3000; each part renders the same `project_name`; a root `biome check .` fails on nested root configs (fixed by `"root": false` in each part, which still lints standalone); the frontend's `tsconfig.json` includes `.claude/hooks/**`; no root `AGENTS.md` exists while each part has its own.

Agent runs, sonnet, fresh agent each:

| Run | Result | Check rounds | Wrong-directory commands or edits | Wrong-copy edits | Gaps logged |
| --- | --- | --- | --- | --- | --- |
| Setup, composed brief | green | 3 (1 failed) | 0 | 0 | 13 |
| Feature, composed workspace | green | 3 | 0 | 0 | 6 |
| Setup, today's `python-react` | green | 1 | 0 | 0 | not counted |
| Feature, today's `python-react` | green | 3 | 0 | 0 | 7 |

The fixed part line held: no command ran in the wrong directory and no wrong copy of a file was edited. A mounted body variant is not needed on this evidence.

Brief gaps by layer, composed side. Workspace body: frontend typecheck and tests fail until the client is generated and Setup did not say so; it told the agent to fill a root `AGENTS.md` that did not ship; it referred to a part's steps by number, which skipped the step that records versions; CI pins and the `.env` source were not mentioned. Link body: wrong about the mutator, silent on the adapter's calling convention and on the `/v1` strip. Part bodies: `react-vite`'s still described items; `python-api`'s `with=git-hooks` block is misleading when mounted. Fixed line: silent on `AGENTS.md`, `CLAUDE.md` and `.claude/`. Two logged gaps were artifacts of assembling the brief by hand (no dependency list, unresolved `stacks:when` markers).

Defects in the hand-written files that a real stack must not repeat: the client drift check compared against git, so it failed straight after a correct regeneration until the output was committed; the root Makefile's `-include .env` silently overrode ports exported in the shell; a passing smoke printed exit 143 from its teardown; the both-parts check never touched a resource added later.

Found in today's `python-react`, unrelated to this design: adding a second Playwright spec makes the health e2e fail under `verify` because parallel workers race Vite's cold dependency optimizer (`workers: 1` fixed it); a lean scaffold leaves posthog references in `vitest.config.ts` and the e2e spec; `.claude/rules/frontend.md` cites an analytics module that is absent; `react-router typegen` adds `isbot` to `package.json` unannounced.

## Spike 2: the brief budget

Limits: `BUDGET.composed` is 6,000 words and `composedWithApp` 9,000, chosen by `composedLimit`. Counting is `brief/words.ts::countWords`; the spike's script reused that rule and its per-section sums matched the CLI's `briefWords` for all eight measured briefs.

Measured, default preset, from `validate --brief --json`: `python-api` 3,443, `hono-api` 3,984, `react-vite` 4,019, `python-react` 4,462. Stack bodies are 736 to 1,007 words. `agent-ops` is 447, `ci-github` about 330, the definition of done about 1,000 to 1,170.

Estimated workspace totals with a 700-word workspace body and a 300-word link: 6,086 for the python pair and 5,938 for the hono pair, before about 150 uncounted words.

Spike 3 then measured real composed briefs: 5,353 (python pair) and 5,176 (hono pair) with default fragments, 4,517 and 4,354 lean. Those used placeholder workspace and link bodies of roughly 100 words each, so real bodies put the total near the limit, as estimated.

Decision by the maintainer: keep the limit at 6,000 and make the bodies more concise. A separate workspace limit is the fallback.

## Spike 3: two stacks in the composer

Two workspace stacks (`python-api` + `react-vite`, `hono-api` + `react-vite`), each with a minimal `openapi-client`, composed through the real composer into `backend/`, `frontend/` and a root, lean and default. The patch is 21 tracked files (+315/−37) and 9 new paths, about 180 lines of it composer core.

Held: fingerprints and `briefWords` identical for all 43 existing stacks with `StackMeta.parts` as `optionalKey`; single-stack briefs byte-identical; `checkTamper` raised `VerifyChanged` on an edited mounted `cwd` and did not see an edit to `Manifest.parts`; `add postgres` wrote 16 files and 5 prefixed steps under `backend/` from the `python-api` overlay only; a one-line change in `react-vite` staled it and both workspaces and left `python-api` current.

Single-stack assumptions: 26 overall, 16 in the composer path, against the RFC's guess of ten. The list is in the RFC's Phase 3. The spike spread the part prefix across five consumers and one was forgotten (`validate`'s command check). Its recommendation: mount inside `compose/`, directly after selection, as one step that rewrites each mounted entry's meta (step names and `cwd`, command keys, dependency roles, `merge` paths), so only `planFiles` and the condition context know about parts.

Not in the RFC: `merge:` lists are entry-relative and have to be mounted too, or `planOutput` raises `file_owner`. With paths mounted the hono pair produced no collision at all.

Placement depended on the other part: `claude-harness` landed in `frontend/` in the python pair (it names only `react-vite` there) and at the root in the hono pair.

Condition context: a part body's `with=git-hooks` and `with=ci-github` blocks resolve as absent, and the root `ci-github` body sees only the workspace's tags, so its `tag=python` and `tag=bun` blocks drop. No layer of the brief then says how to set up uv or Bun in CI.

Silent today: a workspace that does not restate a part's required fragment loses it without a warning; an unknown role, a missing `api` part and two parts of one role all compose with exit 0; a part that has parts dies as a defect; a duplicate part name is a `file_owner` conflict naming only one stack.

Payloads: `--payload none` is refused on a workspace because only the workspace's own `payloads/` is read.

Index: `IndexEntry` gained an optional record of part pins. Without a fallback, a missing pinned part bundle composes the index workspace with a drifted bundled part and no warning; the prototype falls back to the whole bundled workspace. A signed build also has to publish pinned parts that lack a proof of their own.

The same stack mounted twice does not work: `entryRef` is the same for both parts, the pin record is keyed by stack id, both serve on one port, and the placement rule sends the link to the root.

Links need a marker: "a required fragment on a client part" also matched `claude-harness`.

Side effect seen: `verify --only <step>` ran the setup steps as well.

## Spike 4: agent adapters

Neither option in the RFC works as written. Full report with sources: `spike4-adapters.md`. Claims there are marked executed, from documentation, or read from code; live loading of rules, skills and instruction files in a real session of any harness was not tested.

Adapters all at the root with part-prefixed paths needs hand edits to 25 rule globs, rule and skill links and a Cursor rule, cannot part-qualify allow lists (`settings.json` is a merge file and a merge file cannot be a template), and needs a per-entry template value. Adapters all in the parts leaves a root session with no settings or hooks, and in a part session the Codex hook fails open because it resolves the git root.

What works: a fixed per-harness list of files a harness reads only at the session root is written at the project root, and everything else stays in the part. Hooks hoisted to the root worked for files in either part (lint, format, destructive-command and secret guards, session start, and the Codex, Cursor and OpenCode equivalents), each using the part's own tool config. Merging both parts' `.claude/settings.json` with the composer's `deepMerge` gave each hook once. Claude Code resolves a nested rule's globs against its own `.claude` directory, per its documentation, so rules and skills can stay in the part with no rewriting.

Costs to stack authors: a hook finds its tools by walking up from the edited file (`typecheck-on-write.ts` is silent at the root today; a three-line find-up fixed it, and six other stack hooks hard-wire the root the same way); stack hook file names carry the stack id (three same-named hooks with different content exist across stacks); a stack's guard has to be safe for the whole workspace.

`hono-api` and `react-vite` ship 37 adapter or guidance paths at the same location; 35 are byte-identical and only `settings.json` and `AGENTS.md` differ. A fragment named by more than one part is written once at the root.

Open: a fragment placed on one part whose Codex or OpenCode skill, or Cursor rule, is hoisted has a broken guidance link. In these pairs that is `rest-api` only.
