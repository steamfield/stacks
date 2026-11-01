# The site (Astro, static)

Paths below are relative to `apps/web/`. The site is static HTML built ahead of time, plus React islands for the parts that must be live or interactive. Check Astro's config, directives and env API against the installed major (`node_modules/astro/package.json`, its types and its docs for that major), not memory. It is a client of the API, never a second server: no `output: "server"`, adapter or API route here without the user agreeing to it.

## Pages and components

- `.astro` files are `layouts/BaseLayout.astro` and the routes in `pages/`. A page loads its data and renders React components; it holds no reusable markup and no logic beyond picking what to render.
- Every reusable component is a `.tsx` file in `components/`, with a colocated `.test.tsx`. A component that only renders props stays a server-rendered component (no `client:*`).
- An island is a `.tsx` in `islands/` mounted with a `client:*` directive: `client:visible` for anything below the fold, `client:load` only for what must work immediately, `client:idle` otherwise. Keep islands small and pass them plain serializable props; an island that renders most of the page means the page should be built differently.
- Canonical and OG URLs come from the route and the configured `site`, never `Astro.url.pathname` (it can carry `.html` or a trailing slash depending on build format).

## Data

- Build-time data (what a page renders into HTML) comes from files the build reads (`src/data/`, or the output of another build step) and is decoded with the contract's schemas. The build never calls a running API, so `bun run build` works on a clean machine.
- View-time data comes from an island calling the API. `lib/api.ts` is the only module that builds the client: Effect's typed client over the contract's api, on its fetch-based HTTP client, with a relative base URL so the same build works on any origin. Islands import its functions; they never `fetch` an API path by hand or rebuild a URL from strings.
- `lib/api.ts` runs Effect programs at the client edge with an `AbortSignal` from the component's effect cleanup; islands call those functions, and render three states: loading, the decoded value, and the failure. A failure shows the envelope's message for a tagged error and a generic line for anything else; it never renders a raw error object.
- `retryable` on an error decides whether the island offers a retry. Don't retry in a loop on a page someone left open.

## Configuration

- Only `PUBLIC_`-prefixed env vars reach islands, and they are baked in at build time. Read them in one module (`lib/config.ts`) and nowhere else. Nothing secret is ever `PUBLIC_`.
- Build-time switches (a section or a set of pages the build includes or leaves out) are server-context env fields declared in the Astro config's env schema and read in one module, `src/site-config.ts`. A page behind a switch that is off is a route whose static paths are empty, so it isn't built and its path gets the static 404.
- `astro.config.mjs` sets `output: "static"`, `site`, React, Tailwind through its Vite plugin, and the dev `server.proxy` that forwards the API's paths to `PORT_API`. A new API path prefix goes in that proxy list too.
- The site never imports `@<slug>/api` or anything under `apps/api/`; it depends on `@<slug>/contract` only.

## Styling and accessibility

- Tailwind utility classes; shared tokens in `styles/global.css`. No CSS-in-JS and no component library unless asked.
- Semantic HTML first: one `h1` per page, landmarks (`header`, `main`, `nav`, `footer`), real `button` and `a` elements, labels on every input, `alt` on every image. Tables of data use `table` with `th scope`.
- Charts or numbers that change at view time have a text equivalent (a caption or a table), so the page reads without JavaScript.

## Tests

- Components and islands: Testing Library through what a user sees and does (roles, labels, text), never component internals.
- An island's API calls are tested by replacing the fetch function Effect's HTTP client uses (`docs/guidance/effect/api.md` names the service) with a fake that returns bodies encoded with the contract's schemas (success, a tagged error envelope, a network failure). That is the network boundary; never mock `lib/api.ts` or the contract.
- A test whose imports reach `astro:*` modules starts with `// @vitest-environment node`.
- `bun run build` is the integration test for every route.

## Gotchas

- If `astro dev` returns at once with exit 0 under an agent, Astro backgrounded itself; `dev:web` passes `--ignore-lock` to keep it in the foreground. Stop a stray one with `bunx astro dev stop` in `apps/web`.
- `astro.config.mjs` runs before the content layer and can't import `astro:content`.
- Stale route or content types: delete `.astro/`.
