# feature-run log
Read order: root AGENTS.md, README.md, Makefile, .stacks/BRIEF.md, docs/CONTRACT.md, frontend/AGENTS.md, CLAUDE.md (root).
Note: cp -R warned about unix socket .git/fsmonitor--daemon.ipc not copied (harmless).
Note: root AGENTS.md says "Run make check before finishing" and says make check does not run e2e/coverage; BRIEF says stacks verify (not available).
- Doc gap: frontend/src/api/README.md and src/features/notes/README.md describe items.ts/items-page.tsx/item-page.tsx; actual files are notes.ts/notes-page.tsx. Stale docs (leftover from stack). Layout.tsx header says "Items".
- Doc gap: root AGENTS.md "Changing the API" step 3 says "MSW handler and fixture"; where handlers live (frontend/tests/msw/server.ts, tests/fixtures/notes.ts) only found in frontend/AGENTS.md map, not stated.
- .env read blocked by hook (cat .env denied); used env vars/.env.example instead. Not a doc problem.
- Wrong action #1: created new backend files (services/projects.py, test_projects.py, api/projects.py) via shell `cat >` heredocs; allowed. Then a python heredoc editing schemas.py/main.py/test_http.py was BLOCKED by a hook ("Shell in-place edits bypass Edit/Write hooks"). Not in repo docs (environment hook). Redoing with Edit tool. Also re-wrote api/projects.py once to drop a Location header pointing to a nonexistent GET-by-id route.
- Check round 1 (make check): lint/typecheck/test passed both parts; FAILED at check-api-client: `bun run check:api` says "src/api/generated is stale" because it uses `git diff` vs index and my regenerated client was uncommitted. Docs (root AGENTS.md "Changing the API", frontend/AGENTS.md) do not say the regenerated files must be staged/committed before make check; only BRIEF.md setup step 3 says "Commit them" (one-time). Confusing: message says "regenerate" but it was freshly regenerated. Fix: commit first.
- Edited generated files by hand: NO (only via make api-client). Wrong-directory commands/edits: none so far. Wrong-copy edits: none.
- Doc gap/wrong: task said set PORT_WEB/PORT_API to free ports via env; root Makefile does `-include .env` with `PORT_API ?= 8000`, and .env (copied from .env.example, defines PORT_API/PORT_WEB) overrides shell env, so my exports were silently ignored; smoke ran on 8000/4173 (happened to be free). Makefile lines 4-7; AGENTS.md says only "copy .env.example to .env". frontend/AGENTS.md says PORT_E2E from shell works (it did for e2e).
- Check round 2: piped through `tail`, exit code hidden; saw smoke ok. Round 3: reran to a file, exit=0 GREEN. Smoke teardown prints "script preview exited with code 143" and "make[1]: *** [start] Error 143" even on success: alarming but harmless (smoke.sh trap).
- Extra: ran `bun run e2e` (4 passed) and `make coverage` in backend (55 passed, 98.55%) per root AGENTS.md note; e2e has no test for projects (vitest component tests only).
- Smoke/e2e do not exercise /projects; I did not manually run a browser against the real backend for the new page.
- Design choices I guessed: no pagination for projects list (docs for rest-api stack in BRIEF imply cursor limits "when adding resources" -- ambiguous); no GET-by-id; JsonRoute imported from app.api.notes (no shared module, docs silent on reuse).
- Backend/frontend docs say new routers "go in app/api/" and mount in factory: followed. Stale READMEs (items.ts) not fixed.
- Shell heredocs used to create 3 new backend files initially (allowed), python edit blocked once.
- Committed once in copy (never pushed). Final full check: `make check` exit 0 (round 3). Servers: none left running.
