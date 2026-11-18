# Spike 1, second build: hono-api + react-vite

W = scratchpad/spikes/s1/hono-ws. `shipped/` (git, 3 commits, no installs, no lockfiles, no generated output), `builder-check/` (taken to green), `raw/hono-api` (untouched scaffold), `workspace-body.md`, `workspace-body.diff`, `BRIEF-v0.md` (assembled like the python one), `builder-check.make-check.log`.

## Summary

1. `frontend/` is byte-identical to the python workspace's except one file: `src/features/notes/notes-page.tsx`, 2 lines (`useNotesListNotes` -> `useListNotes`).
2. That one difference is the predicted one: FastAPI names operations `<tag>_<function>` (`notes_list_notes`), hono-api declares `operationId: "listNotes"`. Without the edit the frontend fails typecheck.
3. The link's own files (`orval.config.ts`, `src/api/orval-fetch.ts`, the `generate:api`/`check:api` scripts, the two biome excludes) are unchanged and work as-is, including the `/v1` strip.
4. hono-api already met every proven API rule (`/v1`, `notes`, `/healthz`, `PORT_API`). It needed 1 new file (`scripts/openapi.ts`) and 2 package scripts, plus STACK.md (step `openapi-drift`, two commands, one setup line). 3 shipped files changed in all; 2 more docs go stale.
5. The two OpenAPI documents generate clients with no shared names: hooks, schema names (`Page` vs `NotePage`, `ErrorEnvelope`+`PublicError` vs `Error`), path param (`noteId` vs `id`) and error envelope shape all differ. The frontend works with both only because it ignores the error body and the response types.
6. Two nested `biome.json` files never reach across parts when run per part (what Makefile, lefthook and CI do). A root `biome check .` fails outright ("Found a nested root configuration"). Adding `"root": false` to both part configs plus a root `biome.json` makes it work with no cross-part plugin reach; tested both ways.
7. Both parts ship 38 paths at the same relative location: 21 identical (claude-harness hooks, `rules/engineering.md`, `CLAUDE.md`, engineering guidance, `.editorconfig`), 17 different, including `.claude/settings.json` and `AGENTS.md`.
8. Root runner: same Makefile shape. 12 of 59 lines change (`$(MAKE) -C backend X` -> `cd backend && bun run X`, default port). Workspace body: 12 of 52 lines changed, about 8 required by the backend swap.
9. Root `make check` is green in builder-check: both parts' lint/typecheck/tests, `check:openapi`, the copy check, `check:api`, and smoke (GET `/api/notes` via `vite preview` reached Hono's `/v1/notes`). POST and the error envelope also work through the proxy.
10. Biggest contradiction: "the link is unchanged from one workspace to the next" holds for the link's files but not for the page that proves it, unless the API role contract fixes operation ids.

## 1. Is frontend/ byte-identical?

`diff -r python-ws/shipped/frontend hono-ws/shipped/frontend` shows one file:

```
src/features/notes/notes-page.tsx
7c7   import { useNotesListNotes } -> import { useListNotes }
13c13 useNotesListNotes(undefined, ...) -> useListNotes(undefined, ...)
```

Evidence: with the python page unchanged, `bun run typecheck` in builder-check failed with `TS2724: ... has no exported member named 'useNotesListNotes'. Did you mean 'useListNotes'?` (commit 2ce3e5a in shipped is the fix).

Nothing else had to change:
- `src/api/notes.ts` (the hand-written detail query) uses `/notes/:id` with a loose zod `Note`. That works against Hono's uuid ids.
- MSW handlers and fixtures (ids `"1"`, `"2"`, list without `nextCursor`) are untyped against the generated types, so they don't break. They would be invalid against Hono's schema (uuid ids, `nextCursor` required) if anything validated them.
- `ApiError` reads only the status and the `x-request-id` header, never the body, so the two different envelopes don't matter. Hono sends `x-request-id` (checked through the proxy).

Identical but wrong for this backend: `frontend/vite.config.ts` falls back to `PORT_API ?? "8000"`, which is python-api's default (hono-api's is 3000). It works only because the root Makefile and smoke script export `PORT_API`. `cd frontend && bun run dev` without the root env proxies to the wrong port. Whatever default react-vite ships matches one API stack and no other. Either the role contract fixes a default `PORT_API`, or react-vite drops the fallback and fails loudly when it's unset.

## 2. Is the link unchanged?

Yes for every file the link ships or edits besides the page: `orval.config.ts`, `src/api/orval-fetch.ts`, the `generate:api`/`check:api` scripts, the `biome.json` excludes, and `client.ts`'s `request` method. The `/v1` strip in `orval-fetch.ts` is right for Hono too (paths are `/v1/notes`). Orval generated the Hono document cleanly. It emits `export interface Error` (Hono's schema name), which shadows the global `Error` inside `api.ts`. That typechecks today, but it's a latent collision a FastAPI document doesn't trigger.

The page is not unchanged. In the python ledger the link owns `notes-page.tsx` (it rewrote it to use the generated hook), so the link's content differs per API stack by exactly the hook name. So:
- "The link is unchanged from one workspace to the next" holds for the link's tooling, not for its proof file. Options: (a) the API role contract adds a declared/proven rule fixing the example resource's operation ids (`listNotes`, `getNote`, `createNote`). hono-api already has these; python-api would set `operation_id=` or a `generate_unique_id_function`, a python-api change. (b) the link's `orval.config.ts` sets `override.operationName` to derive names from method and path, ignoring the API's ids. That makes the page identical but contradicts the link body's "operation names come from the API part's operation ids" (not tested). (c) the page belongs to the workspace stack, not the link. Then each workspace ships its own page, and the link stops proving integration by itself.
- Static generated-hook-used check: a check that names the hook (`grep useNotesListNotes`) is per backend. A check that greps for an import of the generated module outside `src/api/generated/` (for example `grep -rlE "from ['\"][./]*api/generated/api['\"]" src | grep -v src/api/generated`), plus typecheck and the page's test, is the same in both workspaces. Typecheck is what catches a stale hook name, as the failure above shows. The step can be static; the page can't be, without (a) or (b).

## 3. What hono-api needed to be an `api` part

Already met: routes under `/v1` (`/v1/notes`, `/v1/notes/{id}`), the `notes` resource (list with `limit`/`cursor`/`nextCursor`, get, create with 201 and `Location`), `/healthz` outside `/v1`, `PORT_API` in env and config, a serve step on `${PORT_API}/healthz`.

Changed (files/ paths in the registry):
1. `scripts/openapi.ts` (new, 35 lines). It builds the app with a silent logger, asks its own `/openapi.json` route in process (`app.request`), and writes the file. `--check` compares parsed JSON and exits 1 with "openapi.json is stale: run bun run openapi". There is one source of truth (app.ts's `doc31` call), and no server or port. Covered by `tsconfig.tools.json` (typecheck passes) and by lint (`console` is allowed outside `src/`).
2. `package.json.tmpl`: `"openapi": "node scripts/openapi.ts openapi.json && biome format --write openapi.json"` and `"check:openapi": "node scripts/openapi.ts --check openapi.json"`. The `biome format` is needed because `biome check .` lints `**/*.json`, and `JSON.stringify` output fails Biome's formatter. That keeps `biome.json` unchanged.
3. `scripts/README.md` (docs, 6 lines).
4. STACK.md (not edited; proposed):
   - verify `{ name: openapi-drift, layer: check, run: bun run check:openapi }`
   - commands `openapi`, `check:openapi`
   - a Setup line: "`bun run openapi`, then commit `openapi.json` with future route changes"
   - CI paragraph: add `check:openapi`

Stale, not changed (a real change would update them): `.claude/skills/add-resource/SKILL.md` step 7 and `docs/guidance/hono-api/verification.md` ("fetch `/openapi.json` from a running build") should say `bun run openapi` / `check:openapi`.

`openapi.json` is generated at setup, not shipped, as with python-api. Its bytes depend on the installed `@hono/zod-openapi`, so shipping it in `files/` would be a version literal by another name. Verified drift both ways: a renamed `operationId` fails `check:openapi`, and after `make api-client` the frontend typecheck fails naming `useListAllNotes`.

## 4. The two OpenAPI documents

| | FastAPI (python-api) | Hono (hono-api) |
|---|---|---|
| info | `FastAPI` / `0.1.0` | `API` / `1` |
| list | `GET /v1/notes`, `notes_list_notes`, tag `notes` | `GET /v1/notes`, `listNotes`, no tags |
| get | `GET /v1/notes/{noteId}`, `notes_get` | `GET /v1/notes/{id}` (uuid), `getNote` |
| create | `POST /v1/notes`, `notes_create`, 201 | `POST /v1/notes`, `createNote`, 201 with `Location` header declared |
| health | `health_get` | `health` |
| hooks | `useNotesListNotes`, `useNotesGet`, `useNotesCreate`, `useHealthGet` | `useListNotes`, `useGetNote`, `useCreateNote`, `useHealth` |
| page schema | `Page`: `items` required, `nextCursor` optional `string\|null` | `NotePage`: `items` and `nextCursor` both required, `nextCursor` uuid or null |
| list params | `limit` 1..100 default 20; `cursor` string default `""` | `limit` 1..100 default 20; `cursor` optional uuid |
| Note | id string, createdAt date-time | id uuid, createdAt date-time, examples |
| errors | `ErrorEnvelope{error: PublicError{tag, message, retryable}}` on every status 400..503 and `default` | `Error{error:{code enum, message, requestId, issues?}}` only on the statuses each route declares; none on `/healthz` |
| error type in hooks | `ErrorType<ErrorEnvelope>` | `ErrorType<Error>` (`ErrorType<unknown>` for health) |

Compatible in what this frontend uses: the paths under `/v1`, the `notes` fields (`id`, `title`, `body`, `createdAt`), and `items` on the list. Incompatible in every generated name and in the error envelope. "What crosses the boundary: the error envelope" is not one shape across API stacks. A client part that read the envelope (to show `message`, or `issues` on a form) would be per backend. The role contract fixes neither the envelope nor the pagination field optionality.

Smaller runtime finding: Hono's `Location: /v1/notes/<id>` names the API's own path. Through the `/api` proxy, a client following it would request `/v1/...` on the frontend origin, which isn't proxied.

## 5. Two Biome configs

- Per part (how Makefile, lefthook and CI run it): each `biome check .` runs in its part and reads only that part's `biome.json`, plugin and `package.json` (`noUndeclaredDependencies` resolved `backend/package.json`). Backend checked 30 files, frontend 39. No reach.
- Root run, as shipped: `biome check .` at the root fails with "Found a nested root configuration, but there's already a root configuration" for both `backend/biome.json` and `frontend/biome.json`. Biome treats the cwd as a root and refuses nested configs that don't say `"root": false`. `biome check backend frontend` from the root fails the same way (exit 1). From `backend/`, `biome check ../frontend/src` panics ("path is expected to be under the root").
- Root run, with `"root": false` added to both part configs and a root `{ "root": true }` config (throwaway probe): checks 70 files, clean. Cross-reach probe: a file in `frontend/src` with `console.log(process.env.X)` got only the frontend plugin's console message, not the backend plugin's `process` or `pino` messages. A backend file with `console.log` got only the backend message. Nested configs apply per directory, plugins stay in their part. Both plugins match `$filename <: r".*/src/.*"`, so they'd hit the other part if one config ever covered both directories.
- A part config with `"root": false` still works standalone (no parent config): linted cleanly in an isolated copy. So `"root": false` in both stacks' `biome.json.tmpl` is backward compatible. It's a change to both part stacks, and it's needed only if anyone runs Biome at the root. The formatter's on-write hook and lefthook run per file's nearest config, so nobody does today.

No conflict between the two nested roots as such: the failure is root-vs-nested, not backend-vs-frontend.

## 6. Paths both parts ship at the same relative location

38 paths. Hoisting the identical ones to the root would be lossless for content; the different ones would need a merge or an owner.

Identical (21): `.claude/.gitignore`, `.claude/README.md`, `.claude/hooks/{_destructive-patterns.sh,_lib.sh,_lib.ts,block-destructive.sh,detect-secrets.sh,format-changed.sh,lint-on-write.sh,session-start.sh,smoke.sh,typecheck-on-write.ts}`, `.claude/rules/engineering.md`, `.editorconfig`, `CLAUDE.md`, `docs/guidance/engineering/{architecture,code-style,errors,index,testing}.md`.

Different (17):
- `.claude/settings.json`: hono adds 4 `curl localhost` allows and a PreToolUse Bash guard (`guard-hono-api-commands.sh`); react-vite adds `bun run e2e`. Hook key order differs. This is the `merge:` file both declare. Mounted in separate directories, no merge happens.
- `AGENTS.md`: different title and commands tables.
- Other different files: `.env.example`, `.gitignore`, `README.md`, `biome.json`, `biome-plugins/boundaries.grit`, `package.json`, `tsconfig.json`, `scripts/README.md`, `scripts/prepare.ts` (react-vite's also installs Playwright), `src/README.md`, `src/config.ts`, `src/config.test.ts`, `src/logging.ts`, `src/logging.test.ts`, `tests/README.md`, `tests/boundaries.test.ts`.

What hoisting would do, from reading the hooks (Spike 4 territory, not run):
- `typecheck-on-write.ts` runs `$CLAUDE_PROJECT_DIR/node_modules/.bin/tsc`. At a root with no `node_modules` it silently does nothing.
- `lint-on-write.sh` and `format-changed.sh` find the nearest config and `node_modules` upward from the edited file, so they'd keep working per part.
- Rules are scoped `paths: ["src/**"]` and wouldn't match `backend/src/**`.
- `guard-hono-api-commands.sh` (backend only) denies `bun run dev` anywhere, but not the root `make dev`, which also blocks.

## 7. Root runner and body diff

The same Makefile shape works for two bun parts. Diff to the python Makefile: 12 of 59 lines. Every `$(MAKE) -C backend X` becomes `cd backend && bun run X` (`bun install` for install, `check:openapi` for `check-openapi`), plus the comment and `PORT_API ?= 3000`. The cross-part targets are otherwise identical. No root `package.json` was used: it would invite a root `bun install` and lockfile, and nothing needed it.

Other root files against python's:

| File | Lines changed |
|---|---|
| `scripts/smoke.sh` | 3/40 (build then `bun run start` in place of `make start`; port) |
| `.env.example` | 6/14 |
| `lefthook.yml` | 6/21 (a `backend-biome` job in place of ruff) |
| `ci.yml` | 8/69 (setup-bun/setup-node in place of setup-uv; `check:openapi`) |
| `docs/CONTRACT.md` | 4/22 |
| `README.md` | 4/29 |
| `.gitignore` | 0 |

Workspace body: 12 of 52 lines changed (636 -> 639 words), in `workspace-body.diff`. About 8 are required by the swap:
- title
- stack name / "Makefile or"
- the openapi command names (twice)
- the backend test file
- the operation-id sentence
- the three command bullets

The other 4 are optional or cosmetic:
- `X-Request-ID` -> `X-Request-Id` casing
- setup step 1 says "dependency and check steps" because hono's Setup numbers differ from "steps 1 and 2"
- setup step 3 names `backend/openapi.json`, which python's body omitted too
- the git-hooks sentence

The swap touches the body in four places: runner commands, contract commands, backend file names, and how operation ids are named. A template value per API part (its openapi command, drift command, contract test file, op-id rule) would cover them. The rest of the body is backend-agnostic.

## 8. Root-assuming files in hono-api beyond python-api's

python-api needed zero changes. For hono-api, none blocked mounting either. These assume the part is the root:
- `biome.json`: no `"root": false`, so a root Biome run fails (section 5). New relative to python-api, which has no Biome.
- `biome-plugins/boundaries.grit`: path regex `.*/src/.*` is not anchored to the part. Harmless only because each config stays in its part.
- `package.json` `dev`/`start`: `node --env-file-if-exists=.env` reads `backend/.env`, not the root `.env`. The root `.env` reaches the backend only through the Makefile's exports (process env wins over the env file). A bare `bun run start` in `backend/` ignores the root `.env`.
- `scripts/prepare.ts`: installs lefthook only if `backend/lefthook.yml` exists. In the workspace that's a silent no-op, and the root `make install` has to do it (same as react-vite's).
- `.claude/hooks/*` and `settings.json`: use `${CLAUDE_PROJECT_DIR}`; a session started at the root doesn't load them (Spike 4).
- STACK.md's CI paragraph: "Bun from `packageManager`, Node from `.node-version`". At the root these become `backend/package.json` and `backend/.node-version` paths.
- `PORT_API` default 3000 against react-vite's proxy fallback 8000 (section 1). That's a cross-part default mismatch, not a root assumption.

## 9. RFC claim versus observed

- **Links: "the link is unchanged from one workspace to the next".** Its tooling is unchanged. Its proof page imports a hook whose name is the API's operation id, so it changes per API stack (2 lines) unless the API role contract fixes operation ids or the link renames operations.
- **Role contract, what crosses the boundary: "the example resource, the error envelope, any header both sides rely on".** Only the resource paths and the `Note` fields match across the two API stacks. Envelopes, schema names, path param names and pagination optionality differ. The role contract as written leaves all of these free.
- **Role contract: "hono-api meets the port and health rules; neither proof pair meets the rest".** hono-api already meets `/v1` and `notes` too. Only the OpenAPI file and drift step were missing.
- **Links: hono-api "gains the committed file and the step".** The step and a generator, yes. The file can't ship in `files/` (generator-version-dependent bytes); setup generates and commits it, like python-api's.
- **Spike 3 lists "both ship a biome.json" as a hard case.** Mounted under different directories, they never collide or reach across. They only fail a root Biome run, fixable with `"root": false`.
- **"Two similar Makefiles are the accepted cost."** Confirmed and small: 12/59 lines, mechanical.
- **Both declaring `merge: [.claude/settings.json]`.** In a mounted layout nothing merges: the two `settings.json` sit at `backend/.claude/` and `frontend/.claude/`. The merge question exists only if adapters are hoisted, and then the files differ (guard hook, permissions).
- **Not contradicted:** `vite preview` uses the dev proxy (smoke passed through preview); placement of the link entirely inside the client part; a root command copying the document is the only cross-directory step.

## 10. What I could not do or verify

- No agent runs (setup or feature) from the assembled brief; this build was done by hand.
- CI not run. Action refs are `<pin>`. The workflows reference `backend/.node-version` and `frontend/.node-version`, which setup creates (builder-check wrote both). The python builder-check never created `frontend/.node-version`, so its CI would fail there.
- Frontend dependencies in builder-check reuse the python builder-check's `package.json`/`bun.lock` (same react-vite setup output). Backend dependencies were added at current releases (hono 4.13.19, @hono/zod-openapi 1.6.3, zod 4.6.7, Biome 2.6.8, Vitest 5.1.1).
- Orval's `override.operationName` (option b in section 2) not tried.
- `check:api` still compares against git, so it fails on uncommitted regenerated output, as in the first build. Unchanged by design (the link is copied as-is).
- Hoisting `.claude/` to the root was reasoned from the hook source, not run.
- A root Biome run for the python workspace (one nested config) was not tested.
- The STACK.md changes for hono-api are proposed text, not a registry edit.

## builder-check evidence

- backend: lint (30 files), typecheck (app + tools tsconfig incl. `scripts/openapi.ts`), 53 tests, coverage 100/91.8/100/100, build, `check:openapi`.
- frontend: lint, typecheck, 46 tests, e2e 4 passed.
- root `make check` exit 0 (`builder-check.make-check.log`): smoke log shows Hono's request record `route: /v1/notes, status 200` for the request sent to `:PORT_WEB/api/notes`.
- Manual proxy probe: POST `/api/notes` gave 201 with `location` and `x-request-id`; a bad id gave 400 with Hono's envelope.
- lefthook pre-commit: `backend-biome` formatted a staged backend file in `backend/`; `frontend-biome` skipped.
- Every server was stopped; `on-port` showed nothing on the ports used.
