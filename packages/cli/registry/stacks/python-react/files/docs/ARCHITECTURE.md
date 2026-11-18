# How backend/ and frontend/ connect

`backend/` is a FastAPI service and `frontend/` a React single-page app on Vite. Each is a complete project with its own commands, tests and docs; this file covers only what crosses between them. `backend/docs/` and `frontend/docs/guidance/` describe each half.

## Request path

The browser calls `/api/v1/<resource>` on the frontend's own origin. The base URL `/api` comes from `frontend/src/config.ts` (`VITE_API_URL`), and frontend source never names a host. In `vite` and `vite preview`, `frontend/vite.config.ts` forwards `/api/<path>` to `http://localhost:${PORT_API}/<path>`, stripping only `/api`, so calls name `/v1/...` themselves. The proxy exists only while `PORT_API` is set in the shell, which the root Makefile does. In production the host serving the built frontend forwards `/api` the same way.

The API serves resources under `/v1` and `GET /healthz` outside it. From a failed response the frontend reads only the status and the `x-request-id` header, never the error body.

## Who owns the contract

`backend/` does. `backend/openapi.json` is generated from the FastAPI app and committed; `make -C backend check-openapi` fails when it is stale. `frontend/openapi.json` is a copy, and `frontend/src/api/generated/` is generated from the copy by Orval. Never edit any of the three by hand. Each route's `operation_id` names its generated hook (`listNotes` becomes `useListNotes`), so renaming one renames the hook.

`make check-api-client` checks the whole chain: the backend's document against the app, the copy against the backend's document, and the generated client against the copy.

## Changing the API

1. In `backend/`: change the route and its schema in `app/`, with a camelCase `operation_id` for a new route, and extend `tests/test_http.py`.
2. From the root: `make api-client`, which rewrites both `openapi.json` files and the generated client.
3. In `frontend/`: use the generated hook, passing `{ request: { api } }` from `useServices()`, and add the fixture, MSW handler and tests the frontend's testing guide asks for.
4. Add the new resource's list path to `PATHS` in `scripts/check-pair.sh`.
5. Commit the regenerated files with the change, then run `make check` from the root.

## Settings and ports

The root `.env` (copied from `.env.example`) reaches each part only through the root Makefile, which exports every name in it; a name exported in the shell wins. `backend/` reads `ENVIRONMENT`, `LOG_LEVEL` and its other settings from the environment, then from `backend/.env`. `frontend/` reads `PORT_API`, `PORT_WEB` and `PORT_E2E` from the shell, and `VITE_*` values from its own `.env` files at build time.

## Tests across the parts

Each part's tests run without the other. `make check-pair` runs `scripts/check-pair.sh`: it starts the API and Vite's dev server, requests every path in its `PATHS` list through the proxy, and checks each answer is JSON that carries `x-request-id`. It is the only test that needs both parts running.
