---
schema_version: 1
id: hono-react
kind: stack
name: Hono API + React SPA workspace
description: A Hono JSON API in backend/ and a React single-page app on Vite in frontend/, joined by a TanStack Query client generated from the API's OpenAPI document, with root make targets and a check that sends requests through the Vite proxy to the running API.
tags: [typescript, react, hono, api, web, spa, fullstack, monorepo, make, bun, node]
parts:
  - { name: backend, role: api, stack: hono-api }
  - { name: frontend, role: web, stack: react-vite }
tools: [bun, node, make, git, bash, curl]
merge: [.claude/settings.json]
fragments:
  required: [openapi-client, claude-harness]
  default: [git-hooks, ci-github]
  optional: [claude-harness-docs, rest-api, code-docs, rr, ce-plugin, posthog]
verify:
  - { name: openapi-copy, layer: check, run: make check-openapi-copy }
  - { name: both-parts, layer: test, timeout: 5m, run: make smoke }
  - name: contract-doc
    layer: docs
    tags: [hygiene]
    run: "f=docs/CONTRACT.md; grep -q 'backend/' $f && grep -q 'frontend/' $f && ! grep -n 'stacks:fill' $f"
  - name: agents-md-workspace
    layer: docs
    tags: [hygiene]
    run: "grep -q docs/CONTRACT.md AGENTS.md && grep -q 'cd backend' AGENTS.md && grep -q 'cd frontend' AGENTS.md"
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Install both parts and the git hooks
  api-client: Regenerate the OpenAPI document, its copy and the client
  check-openapi-copy: Fail if frontend/openapi.json differs from backend's
  smoke: Request each list route through the running frontend's proxy
  check: Run both parts' checks, the contract checks and the smoke
---

# Hono API + React SPA workspace

## What stacks wrote

At the root: a Makefile that runs part scripts inside each part, `scripts/smoke.sh`, `docs/CONTRACT.md`, and the only `AGENTS.md` and `CLAUDE.md`.

## How the parts connect

The frontend requests `/api/v1/...` on its own origin; Vite's dev and preview proxy strips `/api` and forwards to `PORT_API`. `backend/` owns the contract: `backend/openapi.json` is copied to `frontend/openapi.json`, and Orval generates `frontend/src/api/generated/` from the copy. Notes is the example (`listNotes`, `getNote`, `createNote`, rows under `items`). A failure exposes only its status and `x-request-id` to the frontend.

The Makefile exports `PORT_API`, `PORT_WEB` and `PORT_E2E` from the shell, else the root `.env`, else defaults. Other settings stay in each part's `.env`.

## Setup

1. In each part, add its declared dependencies (`orval` in `frontend/`) and record Node in `.node-version` and Bun in `packageManager`. Add the link's two scripts to `frontend/package.json`.
2. `make api-client`, which first produces the generated client.
3. Move the notes list page to `useListNotes` (link section); the frontend's typecheck and tests then need the client.
4. `make check`, updating shipped code an installed release rejects.
5. Fill the three READMEs and `docs/CONTRACT.md`. In the root `AGENTS.md`, put what a part section asks of `AGENTS.md` under that part's heading, a single-test command per part (`cd backend && bun run test src/config.test.ts`), the change workflow, and links to `docs/CONTRACT.md` and each part's `docs/guidance/` index.
6. Commit, then `stacks verify --all` until green.

## Changing the API

`docs/CONTRACT.md` has the steps: the route and contract tests in `backend/`, `make api-client`, the hook and its tests in `frontend/`, the list route in `scripts/smoke.sh`, `make check`, then commit the generated files with the change.

## Commands

`make help` lists root targets; `make backend-<script>` runs a part script inside `backend/`, likewise `frontend-`. Never run Biome from the root.

## Testing

Each part's tests run alone; `make smoke` is the one check with both running.

<!-- stacks:when with=ci-github -->
CI: a job per part in its `working-directory`, with Bun and Node versions read from that part. Each runs lint, typecheck, coverage and build; `backend/` adds `check:openapi`, `frontend/` Chromium and e2e. A contract job runs `make install check-api-client smoke`.
<!-- stacks:end -->

<!-- stacks:when with=git-hooks -->
Hooks: one pre-commit job per part in the root `lefthook.yml` with `root: backend/` or `root: frontend/`, running Biome there; pre-push runs `make test`. `make install` runs `lefthook install`.
<!-- stacks:end -->

<!-- stacks:when with=rest-api -->
The `rest-api` step reads `backend/AGENTS.md`: write only the API conventions section there, linked from the root `AGENTS.md`.
<!-- stacks:end -->
