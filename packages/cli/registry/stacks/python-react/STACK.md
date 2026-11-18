---
schema_version: 1
id: python-react
kind: stack
name: Python API + React SPA
description: A workspace of two stacks in one repository, the FastAPI service from python-api in backend/ and the React single-page app on Vite from react-vite in frontend/, joined by an Orval client generated from the API's OpenAPI document, a Vite proxy and a root Makefile.
tags: [python, typescript, react, web, api, fullstack, monorepo, make, bun, node]
parts:
  - { name: backend, role: api, stack: python-api }
  - { name: frontend, role: web, stack: react-vite }
tools: [uv, bun, node, make, git, curl]
fragments:
  required: [openapi-client, claude-harness]
  default: [agent-ops, ci-github]
  optional: [git-hooks, postgres, rest-api, claude-harness-docs, code-docs, rr, ce-plugin]
verify:
  - { name: api-copy, layer: check, run: make check-api-copy }
  - { name: both-parts, layer: test, run: make check-pair }
  - { name: workspace-docs, layer: check, tags: [hygiene], run: make check-docs }
commands:
  install: Install both parts, then git hooks outside CI
  lint: Lint both parts
  format: Format both parts
  typecheck: Typecheck both parts
  test: Test both parts
  coverage: Test both parts with coverage
  build: Build the frontend
  e2e: The frontend's Playwright tests
  dev: Both dev servers
  openapi: Write backend/openapi.json
  check-openapi: Fail when backend/openapi.json is stale
  api-client: Copy the backend's OpenAPI document to the frontend and regenerate the client
  check-api-copy: Fail when frontend/openapi.json differs from backend/openapi.json
  check-pair: Run both parts and send each path in PATHS through the proxy
  check-docs: Fail on unfilled root docs or a root AGENTS.md missing its links
  check: Every check of both parts plus the cross-part checks
---

# Python API + React SPA

## What stacks wrote

Each part is its stack, complete alone; the link adds Orval to `frontend/`. `docs/ARCHITECTURE.md` is the contract. This section governs where a part's section differs.

## How the parts connect

The browser calls `/api/v1/...` on its own origin. Vite's proxy, on while `PORT_API` is set in the shell, strips `/api` and forwards to the API. `backend/` owns the contract: `make api-client` dumps `backend/openapi.json`, copies it to `frontend/openapi.json` and regenerates the client. The frontend reads only a failure's status and `x-request-id`.

The root `.env` reaches a part only through the root Makefile's export, and a value exported in the shell wins. A command run inside a part sees only that part's `.env`.

## Setup

1. In `backend/`, pin Python and add its declared dependencies as its section says. In `frontend/`, add its and the link's dependencies and the link's two package scripts.
2. From the root, `make install`, then `make api-client`. The frontend's typecheck and tests fail until this generates the client.
3. Move the notes list page to the generated hook, as the link's section says.
4. `make format`, then `make check`, fixing what installed releases reject without loosening a check.
5. Create `backend/AGENTS.md` and `frontend/AGENTS.md` for what each part's section puts in AGENTS.md. Fill the root `AGENTS.md` with the root commands, the change workflow and links to both part files and `docs/ARCHITECTURE.md`. Fill all three READMEs.
6. Commit both `openapi.json` files, the generated client and both lockfiles, then run `stacks verify` until green.

## Changing the API

Change the route, schema and tests in `backend/`. Run `make api-client` from the root, use the generated hook in `frontend/` with its handler, fixture and tests, and add the list path to `PATHS` in `scripts/check-pair.sh`. Commit the regenerated files with the change, then `make check`.

## Commands

Root targets run each part's command in its directory (`make -C backend lint`, `cd frontend && bun run lint`); never run Biome from the root. Run one test inside its part.

## Testing

Only `make check-pair` runs both parts: it sends each `PATHS` entry through the proxy and checks `x-request-id` crossed it.
<!-- stacks:when with=ci-github -->

## CI

Jobs: `backend` (uv's setup action, Python from `backend/.python-version`, `make -C backend install lint typecheck coverage check-openapi`), `frontend` (Bun from `frontend/package.json`, Node from `frontend/.node-version`; in `frontend/` lint, typecheck, coverage, `check:api` and e2e with Chromium) and `contract` (both toolchains, `make install check-api-copy check-pair`).
<!-- stacks:end -->
<!-- stacks:when with=git-hooks -->

## Git hooks

`lefthook.yml` stays at the root with one job per part using `root:`; Biome runs from `frontend/` with `--no-errors-on-unmatched`. The root `make install` runs `lefthook install`.
<!-- stacks:end -->
<!-- stacks:when with=postgres -->

`postgres` is placed in `backend/`; run its targets with `make -C backend`.
<!-- stacks:end -->
