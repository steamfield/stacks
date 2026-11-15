# Static site and islands

Start with [pages/index.astro](pages/index.astro), which uses
[layouts/BaseLayout.astro](layouts/BaseLayout.astro) and hydrates
[islands/ApiStatus.tsx](islands/ApiStatus.tsx). Pages build without a running API;
the React island calls [lib/api.ts](lib/api.ts) in the browser for live health,
safe failure messages and retry behavior.

The client imports the shared contract's public entry, never API implementation
code. [islands/ApiStatus.test.tsx](islands/ApiStatus.test.tsx) exercises the rendered
island through real contract decoding with fetch responses supplied by the test.
[pages/404.astro](pages/404.astro) provides the built site's missing-page view.
