# File ledger: shipped/ versus the raw scaffolds

Baseline: commit `ef2a12c` in `shipped/` (raw python-api under `backend/`, raw react-vite under `frontend/`, both `.stacks/` removed). Everything below is `git diff --find-renames ef2a12c HEAD`.

Owners: **WS** workspace stack, **LINK** `openapi-client`, **RV** a change react-vite itself would need (standalone too), **PA** a change python-api itself would need.

## Added at the root (all WS)

| File | Notes |
| --- | --- |
| `Makefile` | Delegates to `make -C backend` and `cd frontend && bun run`; owns `api-client`, `check-api-client`, `smoke`, `check`; includes root `.env` and exports `PORT_API`/`PORT_WEB`; root `make install` runs `lefthook install` |
| `README.md` | Root README with a `stacks:fill` marker (a fourth `readme-filled` target) |
| `.env.example` | `PORT_API`, `PORT_WEB`, `PORT_E2E`, backend settings |
| `.gitignore` | `.env` only; parts keep their own |
| `lefthook.yml` | `root:`-scoped pre-commit jobs per part, pre-push `make test` |
| `.github/workflows/ci.yml` | backend, frontend, contract (drift + smoke), `ci-ok`; action refs left as `@<pin>` with a fill line (no version literals) |
| `docs/CONTRACT.md` | Request path, contract owner, change workflow; has a fill marker |
| `scripts/smoke.sh` | Both-parts check: API + `vite preview`, one GET `/api/notes` through the proxy |
| `.stacks/BRIEF.md` | Frozen `BRIEF-v0.md` |

## frontend/ (react-vite)

| File | Owner | Change |
| --- | --- | --- |
| `vite.config.ts` | RV | Dev proxy `/api` -> `http://127.0.0.1:${PORT_API}/v1` (role contract). `vite preview` inherits it |
| `src/api/items.ts` -> `src/api/notes.ts` | RV | Shared example resource: `Note` schema, detail query. (LINK then removed the list query its page no longer uses) |
| `src/features/items/*` -> `src/features/notes/*` | RV | `note-page.tsx` renamed and retargeted; README moved, content left stale |
| `src/features/notes/notes-page.tsx` | RV, then LINK | RV renames it; LINK rewrites it to use `useNotesListNotes` (a second writer of a part file: file_owner conflict in a real compose) |
| `src/app/routes.tsx` | RV | Imports and `notes/:id` path |
| `src/app/routes.test.tsx` | RV | Renamed strings, plus the "calls the shared example resource, notes" test |
| `tests/fixtures/items.ts` -> `notes.ts` | RV | Note fixtures |
| `tests/msw/server.ts` | RV | `*/api/notes` handlers |
| `e2e/items.spec.ts` -> `notes.spec.ts` | RV | Routes `/api/notes` |
| `src/api/client.ts` | RV | Adds `request(path, schema, {method, body, headers, signal})`; `get` delegates. Needed by the link's mutator (the seam was GET-only) |
| `orval.config.ts` | LINK | New. Reads `./openapi.json`, writes `src/api/generated/api.ts`, mutator `src/api/orval-fetch.ts` |
| `src/api/orval-fetch.ts` | LINK | New. Adapter from Orval's `(url, RequestInit)` call to `api.request`; strips the `/v1` prefix; exports `ErrorType = ApiError` |
| `package.json` | LINK | `generate:api`, `check:api` scripts. File is `package.json.tmpl` in the registry, so not mergeable (`merge_template`) |
| `biome.json` | LINK | Excludes `src/api/generated` and `openapi.json`. Also `biome.json.tmpl`: not mergeable |

Stale but not changed (RV would need to update for the items -> notes convention): `src/README.md`, `src/api/README.md`, `src/app/README.md`, `tests/README.md`, `src/app/layout.tsx` ("Items" nav label), `src/app/route-error.tsx` ("Back to items"), `src/styles.css` (`.item-list`), `docs/guidance/react-vite/app.md`, `docs/guidance/react-vite/testing.md`, `.claude/skills/add-page/SKILL.md`, the react-vite STACK.md body ("items list"), plus `/items` paths in `errors.test.ts`, `logging.test.ts` and `boundaries.test.ts` (string literals only; nothing breaks).

## backend/ (python-api)

No changes. Mounted unchanged and green.

## Produced at setup, never shipped (verified absent from `shipped/`)

`backend/.python-version`, `backend/uv.lock`, `backend/openapi.json`, dependency entries in `backend/pyproject.toml`; `frontend/bun.lock`, `frontend/openapi.json`, `frontend/src/api/generated/api.ts`, dependency entries in `frontend/package.json`; `node_modules/`, `.venv/`.

## Counts

- python-api: 0 files to be mountable.
- react-vite, mount-only: 0 files. Role-contract conventions (valid standalone): 11 files changed or renamed in code and tests, plus about 10 doc/agent files left stale that a real change would update.
- Link touching part-owned files: 4 (`package.json`, `biome.json`, `notes-page.tsx`, `notes.ts`). New link files: 2.
