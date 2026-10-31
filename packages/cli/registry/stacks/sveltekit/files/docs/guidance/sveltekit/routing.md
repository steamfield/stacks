# Routes, load functions and actions

Before using a kit API, read its declaration in `node_modules/@sveltejs/kit/types/index.d.ts`; the doc comments link the svelte.dev page for the installed release.

## Where code goes

- `src/routes/` holds routes only: `+page.svelte`, `+layout.svelte`, `+error.svelte`, `+page.server.ts` (server `load` and form actions) and `+server.ts` endpoints. Keep them thin: read from a service and return data, or validate and call a service.
- `src/lib/server/` holds everything that touches state, the environment or the outside world. SvelteKit refuses to bundle a module under a `server` directory, or named `*.server.ts`, into browser code, and names the import chain when it does.
- `src/lib/` (outside `server/`) holds code both sides may import: zod schemas, pure formatting, types. Nothing there imports from `server/`.
- `src/lib/components/` holds components. They get data as props from a route and never import server modules.

## Load functions

- Load data in `+page.server.ts` when it needs server modules or secrets. A universal `+page.ts` load runs in the browser too, so it can't import them.
- Return plain serializable data. The kit's serializer handles more types than JSON; check its docs before returning a class instance.
- Read environment variables only in server modules, through the private environment module the installed kit documents. Public variables need the public prefix the docs name, so never put a secret under it.

## Form actions

- An action is a public POST endpoint anyone can call with any payload. Parse its `FormData` with the shared zod schema on the server every time.
- Expected failures (validation, a missing record) return `fail(status, data)` with the field errors and the submitted values. Don't throw for them: a thrown error renders `+error.svelte`, and production hides an unexpected error's message.
- The form is `method="POST"` and works without JavaScript; `use:enhance` upgrades it. After a successful enhanced submit the kit reruns the page's load functions, so the list updates without a manual reload. Write a custom enhance callback only to add pending state, and call the default update from it.
- The page reads the action's returned data through the prop the installed kit documents for form results, and passes it to the form component.
- Successful writes redirect with 303 so a reload of a plain form response does not repeat the POST. Enhancement follows that redirect through client navigation.

## Endpoints

- `+server.ts` exports one function per HTTP method. Return the kit's `json` helper (or `Response.json`) with an explicit status. Decode request bodies as `unknown` and parse them with zod before use.
- An endpoint that reports live state (health, counts) must render per request. Never set prerendering on it or on a layout above it.
- `/api/health` reads the items service and touches nothing outside the process.
- `hooks.server.ts` maps API failures to `{error:{code,message,requestId}}`, adds no-store and request-ID headers, and logs request metadata without query strings or submitted values. `server/errors.ts` owns the safe public messages. The database fragment's `/api/ready` 503 keeps its `{"status":"unavailable"}` readiness body and gets the same headers.

## Server state

Module state in a server module is shared by every request and every user. The in-memory items store is fine for the slice. Anything per user goes in `locals`, cookies or a store keyed by user.

## Errors

- `+error.svelte` shows the status and a fixed safe message, with a link home. It reads the page's status and error from the kit's page state module.
- Use the kit's `error` helper for a missing record so the page renders with a 404. Unexpected errors go through the server error hook, which logs them; the page only sees a generic message.
