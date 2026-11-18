# How backend/ and frontend/ connect

`backend/` is a Hono API and owns the contract. `frontend/` is a React app that calls it only through a client generated from the API's OpenAPI document. Run every command below from the project root unless it starts with `cd`.

## Resources

<!-- stacks:fill: one line per resource the API serves under /v1 (notes first), with its operation ids and the generated hooks the frontend uses -->

## Request path

1. A page calls a generated hook such as `useListNotes`. Generated calls go through `frontend/src/api/orval-fetch.ts` into `frontend/src/api/client.ts`, the one module that calls `fetch`.
2. The client prefixes the base URL, `VITE_API_URL` (default `/api`, read only by `frontend/src/config.ts`), so the browser requests `/api/v1/notes` on the frontend's own origin.
3. Vite's proxy (`frontend/vite.config.ts`, in `vite dev` and `vite preview`) strips only `/api` and forwards to `http://localhost:${PORT_API}/v1/notes`. The proxy exists only when `PORT_API` is set in the shell; the root Makefile exports it, from the shell first, then the root `.env`, then 3000.
4. A deployed frontend needs its host to forward `/api` the same way. The API's `Location` header names its own path (`/v1/notes/<id>`), which the frontend's origin doesn't serve.

## What crosses the boundary

- Paths under `/v1`, with request and response bodies as `backend/openapi.json` declares them. List responses hold their rows under `items`, with `nextCursor` for the next page.
- Operation ids, which name the generated functions and hooks: `listNotes` becomes `useListNotes`. Renaming one renames its hook, and the frontend's typecheck names every caller.
- On failure the frontend reads only the status and the `x-request-id` header (shown to the user), never the error body. The body's shape (`backend/src/errors.ts`) can change without breaking the frontend.

## Who owns what

- `backend/openapi.json`: written by `cd backend && bun run openapi` from the app's routes; `cd backend && bun run check:openapi` fails when it is stale.
- `frontend/openapi.json`: a byte copy made by `make api-client`; `make check-openapi-copy` fails when it differs.
- `frontend/src/api/generated/`: written by Orval from the copy; `cd frontend && bun run check:api` fails when it is stale. Never edit it by hand.

All three are committed, with the change that caused them.

## Changing the API

1. In `backend/`: change the schema in `src/schemas/`, the route in `src/routes/` with a stable `operationId`, and add rows to `tests/http-contract.test.ts`.
2. `make api-client` regenerates the document, its copy and the client.
3. In `frontend/`: use the generated hook from a page, passing `{ request: { api } }` with the client from `useServices()`, and add MSW handlers, fixtures and tests for it.
4. Add the new list route to `LIST_ROUTES` in `scripts/smoke.sh`, and a line to Resources above.
5. `make check`: both parts' checks, the contract checks and the smoke. Commit the generated files with the change.
