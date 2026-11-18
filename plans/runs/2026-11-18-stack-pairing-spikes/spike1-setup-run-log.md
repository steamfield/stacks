# setup-run log (honest, untidied)

## Check rounds
- Round 1 `make check`: FAILED at check-api-client ("src/api/generated is stale") because I had not yet committed the generated client (brief step 3 says commit; I ran check before committing). My ordering error, not a brief error.
- Round 2 (after commit): exit 0. Round 3 (after docs): exit 0. Total 3 runs, 1 failed, 2 green.

## Brief gaps / unclear points
Workspace section
- Step 1 "do their steps 1 and 2 ... frontend": frontend step 2 `bun run typecheck` and `bun run test` FAIL before `make api-client` (notes-page.tsx imports src/api/generated/api, which does not exist yet; one vitest file fails). Brief orders api-client after (step 3). Guess: ran link steps + api-client first, then re-ran. Brief should say the frontend's typecheck/test are expected to fail until step 3, or reorder.
- Step 1/2 ordering: frontend step 1 "add every declared dependency" but frontend/package.json declares NONE (no dependencies in the file). Same for backend pyproject (only tool config). "every declared dependency" has no list anywhere. I inferred from imports in source/tests/configs (python: fastapi, uvicorn[standard], pydantic, pydantic-settings, structlog; dev pytest, pytest-asyncio, pytest-xdist, pytest-randomly (inferred from "random ordering" in docs, no import), pytest-cov, asgi-lifespan, httpx, ruff, mypy; js: see package.json incl. happy-dom, @vitest/coverage-v8, jest-dom, @types/react*). Guesses could be wrong (e.g. randomly) with no way to know. (Backend section step 1 and frontend section step 1 both.)
- Step 5 "Record the root commands ... in the root AGENTS.md": there is no root AGENTS.md (nor CLAUDE.md, nor root .claude). Only frontend/AGENTS.md and frontend/CLAUDE.md exist. I created root AGENTS.md and a root CLAUDE.md (`@AGENTS.md`). Backend section says "Record Python and uv versions in AGENTS.md" / "Mirror commands in AGENTS.md" - backend has no AGENTS.md; I put these in the root AGENTS.md (guess). Brief should say which AGENTS.md.
- Step 5 / frontend AGENTS.md has ~13 stacks:fill markers + .claude/README.md fill row; the brief only mentions README, CONTRACT and "AGENTS.md". Root `.github/workflows/ci.yml` has a stacks:fill + `<pin>` placeholders (pin actions by SHA) the brief never mentions. I resolved SHAs with `gh api` (network). Another agent without gh would be stuck.
- Step 6 / "stacks verify until green" read as make check, as instructed. Note `make check` excludes frontend e2e and backend coverage floor (brief says "lint, typecheck, tests ..."), though part steps ask for them; I ran them separately once.
- Where does .env come from: root Makefile `-include .env`; brief doesn't say copy .env.example to .env. Made it (gitignored). Not needed for check since defaults match.
Backend part section
- Step 1 "Pin the chosen Python": no guidance on 3.14 vs 3.15; I picked 3.14 (3.15 not stable). Step 4 `make openapi` is redundant with workspace step 3; unclear whether to commit separately. Header note says root has own README/.env.example: true for .env.example and README, fine.
- Step 5 "selected fragments' agent guidance": no fragments named, nothing to fill. Ignored.
Frontend part section
- Step 3 "Record the Node LTS in .node-version": which dir? CI reads frontend/.node-version; guessed frontend/. "Bun in packageManager" fine. Said README gets Vite/React/Router/TS versions: done in frontend/README.md.
- Step 4 "AGENTS.md (commands...)" is frontend/AGENTS.md; says "Run these from the repo root" which is wrong in a workspace; I changed to `frontend/`.
- `@types/node` "match to chosen Node major": I first installed @types/node 26, then `bun add -d @types/node@24` (small undo).
- "If a default port is busy set PORT_WEB/PORT_E2E in verify's environment": ports were free; free-port not needed.
Link section
- Step 1 says add orval "in the client part"; I added it with the other frontend dev deps in one command (before step 2), fine.
- Brief says "bun run generate:api" ... orval.config.ts matches; no option changes needed. orval 8.48 worked with shipped config unchanged.
Stale shipped content (not brief): frontend/src/api/README.md refers to items.ts (it's notes.ts); frontend/AGENTS.md/CLAUDE.md say "items". Left untouched, not logged as edits. Nested part .claude dirs mean a session at the root loads no hooks/rules; brief doesn't mention.

## Wrong actions / undo
1. Tried a python heredoc to edit pyproject.toml via Bash: blocked by an environment hook ("Shell in-place edits bypass..."). Redid with Edit tool. (1 blocked action, nothing to undo.)
2. Installed @types/node 26 then replaced with 24 (1 undo).
3. Ran `make check` before committing generated client -> failed (1).
Count of wrong actions: 3.

## Wrong-directory commands: 0.
## Wrong-copy edits: 0 knowingly. Hazards noticed: three .env.example (root, backend, frontend, all different), READMEs x3, only frontend has AGENTS.md/CLAUDE.md/.claude with hooks. I edited frontend/AGENTS.md and frontend/.claude/README.md (frontend's own files, intended) and created root AGENTS.md/CLAUDE.md. Judgement call whether creating root AGENTS.md vs using frontend/AGENTS.md was right.

## Other failed commands
- `cp -R` printed "socket not copied" for .git/fsmonitor--daemon.ipc (harmless; git worked).
- First `uv python list` warned about mise shims python3.15 (harmless).
- Wrote /tmp/x once with make check output (stray file outside scratchpad, my slip).

## Result
make check exit 0 at HEAD 3643f64; both servers killed, ports 8000/4173/4180 free. Commits: 1ac3d7d (deps, versions, generated client), 3643f64 (docs, CI pins). Remaining stacks:fill grep hits are only .stacks/BRIEF.md and frontend session-start hook text.
