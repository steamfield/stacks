---
schema_version: 1
id: openapi-client
kind: fragment
category: link
name: OpenAPI client for React on Vite
description: A typed TanStack Query client that Orval generates from the API's OpenAPI document into the React app, sent through the app's own API client, with a drift check against a fresh generation and a check that a page uses it.
tags: [openapi, orval, react-query, codegen]
applies_to: [react-vite]
deps:
  dev: [orval]
verify:
  - { name: client-drift, layer: check, run: bun run check:api }
  - name: generated-hook-used
    layer: check
    run: "grep -rqE --exclude='*.test.*' 'from .+/api/generated/' src/features src/app || { echo 'No page imports src/api/generated: move a page to a generated hook'; exit 1; }"
commands:
  check:api: Fail when src/api/generated/ differs from what bun run generate:api writes
---

# OpenAPI client

Orval generates typed TanStack Query hooks into the client part from the API part's OpenAPI document. Generated calls go through the client part's `request` function, so they share the hand-written calls' base URL, request id, logging and `ApiError`. They skip zod decoding, trusting the document's types; that is accepted.

Stacks wrote, in the client part: `orval.config.ts` (reads `./openapi.json`, writes `src/api/generated/`), the mutator `src/api/orval-fetch.ts` with its test, and the drift check `scripts/check-api-client.ts`.

## What to add

1. Add the declared dependency with `bun add -d`, and two scripts to the client part's `package.json`: `"generate:api": "orval"` and `"check:api": "bun scripts/check-api-client.ts"`.
2. Get the document to `openapi.json` in the client part's directory. In a workspace, run the root command the workspace provides to copy it from the API part. In a standalone project the client part is the project itself and the developer places the document there; ask for it if it is missing.
3. Run `bun run generate:api`. If the installed Orval rejects an option in `orval.config.ts`, update it from that release's docs, keeping the mutator, the body-only return and `header: false`.
4. Move the notes list page (`src/features/notes/notes-page.tsx`) from `notesQuery` to the generated `useListNotes`, passing `{ request: { api } }` with the client from `useServices()`. The API's operation ids are `listNotes`, `getNote` and `createNote`, so the hook names are stable. Delete `notesQuery` and `NoteList` from `src/api/notes.ts` once unused, update `src/features/notes/README.md`, and keep `src/app/routes.test.tsx` passing unchanged.
5. Commit `openapi.json` and `src/api/generated/`.

## Rules

- `src/api/generated/` is read-only. After an API change, copy the document again, regenerate, and commit the output with the change that caused it.
- A hook is named after its operation id, so a renamed operation renames its hook and typecheck names every stale caller.

## Verify

`client-drift` runs `generate:api` in a temporary copy and compares the result with `src/api/generated/`. A failure means the document or `orval.config.ts` changed since the last generation, or someone edited the output: regenerate, never patch it. `generated-hook-used` fails until a page or feature imports the generated client.

## AGENTS.md

Add an **API client** section: where `openapi.json` comes from, `bun run generate:api` after every API change, never editing `src/api/generated/`, and `{ request: { api } }` on every generated hook.
