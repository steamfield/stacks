# Feature log (baseline docs)

## Docs read, in order
1. cp -R of project (warning: `.git/fsmonitor--daemon.ipc is a socket (not copied)`; harmless, not a doc issue).
2. AGENTS.md, README.md, Makefile, .stacks/BRIEF.md (one command), docs/ARCHITECTURE.md, docs/DEVELOPMENT.md, .claude/rules/{backend,frontend,python-react-testing}.md
3. Then source: backend/app/{routers,api/notes,api/health,schemas,services/notes,main}.py, tests, frontend routes/home/lib/tests/orval config.

## Doc gaps / guesses
- AGENTS.md says "example resource" nowhere by name; I inferred notes is it. README says "notes service". Task says "existing example resource" -> had to read code to find it.
- BRIEF.md "Layout": "Add routers under backend/app/api/ ... business logic in app/services/ and wire models in app/schemas.py". Clear. But `JsonRoute` (415 media-type check) lives inside api/notes.py; no doc says to reuse it or where shared route classes go. Guess: import it from app.api.notes.
- `.claude/rules/frontend.md`: "route analytics through the analytics module" - no analytics module exists in frontend/app. Doc references something absent. Ignored.
- Frontend rules: "Put feature components in components/<feature>/" but the existing home route has no feature components (inline in route). Guess: put projects UI in components/projects/ and route in routes/projects.tsx.
- Nothing documents how to add a frontend route (routes.ts) beyond reading the file.
- BRIEF says "Extend the HTTP tests with each new failure"; no doc says whether new resource tests go in test_http.py or a new file. Guess: new file backend/tests/test_projects_http.py + services test next to code.
- AGENTS.md: "`stacks verify --all` is the definition of done." Task prompt gave the command to run.
- backend/.venv, frontend/node_modules: copied with project (not checked yet).

## Work done
- Backend: services/projects.py (MemoryProjects), api/projects.py, schemas (ProjectInput/Project/ProjectList), routers.py, main.py lifespan state (project_store). List returns {items} unpaginated (guess: task said "list and create", no pagination spec).
- Named schemas Project* because `Page`/`Note` already exist in the OpenAPI components; no doc warns that schema names are global to OpenAPI/orval (I noticed by reading schemas.py).
- Tests: services/test_projects.py, tests/test_projects_http.py (new files; test_http.py not extended: guess).
- `make generate-api` run; generated files NOT hand-edited.
- Frontend: components/projects/projects-panel.tsx, routes/projects.tsx, routes.ts entry, routes/projects.test.tsx (vitest+MSW), tests/e2e/projects.spec.ts (extra; I added it because BRIEF says "Playwright must call the real backend").
- Did not add a link to /projects from home (guess: not requested).

## Wrong actions / failures
1. FAILED verify round 1 (e2e): health.spec "API health" heading not found, page stuck on "Loading application…". Cause: my new Playwright spec file made two spec files run in parallel workers against a cold Vite dep-optimizer cache (reproduced by `rm -rf frontend/node_modules/.vite`; passes warm, passes with --workers=1). Docs silent: DEVELOPMENT.md says "Playwright starts its own API on 18000 and web server on 15173" and nothing about parallel workers/shared server state or adding a second e2e spec. Fix: `workers: 1` in frontend/playwright.config.ts (not a generated file; I edited it deliberately).
2. Round 2 verify: failed identically (warm run passed standalone but verify's run failed; the cold cache was still the cause since verify's build/typecheck steps clear caches) - same root cause, not a new problem.
3. Wrong action: ran `git stash` to test baseline e2e; it stashed my tracked edits, then I `git stash pop`ped them back. No loss. Self-inflicted, not doc-caused.
4. Ran `make e2e` standalone several times; no stray servers left (on-port clear on 18000/15173/18500/18600).
5. Edit/Write on files I'd only `cat`ed worked without a Read here (CLAUDE.md warns otherwise; not applicable to this repo).

## Counts
- Wrong-directory commands/edits: 0. Edited-wrong-copy: 0. Hand-edited generated files: no.
- `stacks verify` appears in AGENTS.md but not how to run it from a checkout without the stacks binary (I used the task-provided command).
- Doc contradictions: .claude/rules/frontend.md "route analytics through the analytics module" (none exists; and e2e/vitest reference posthog keys: leftovers from a removed fragment, vitest.config.ts env VITE_PUBLIC_POSTHOG_KEY, health.spec.ts routes **/*posthog*).
- Full-check rounds: 3 invocations of `verify --all` (2 red from e2e flake/race, 1 green). Plus 1 earlier run I started with free-port values.
- Final: `verify: green (full run; 11 passed, 0 failed, 0 skipped; 18.8s)`. Committed 239ab75 in the copy, not pushed.
