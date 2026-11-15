# App test support

Start with [render.tsx](render.tsx), which mounts the real routes in a memory
router with fresh services and a query cache. Component tests beside the app
source use it to exercise pages and navigation.

[setup.ts](setup.ts) installs DOM matchers, starts the MSW server in
`msw/server.ts`, and cleans components and handlers between tests.
The handlers use `fixtures/items.ts`, also shared with Playwright.

[boundaries.test.ts](boundaries.test.ts) probes the Biome plugin on Node.
Vitest's app project runs source tests in happy-dom; its Node project runs
the boundary probes. `../e2e/` tests the built site separately in Chromium.

