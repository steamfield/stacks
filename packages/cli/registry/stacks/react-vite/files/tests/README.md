# App test support

Start with [render.tsx](render.tsx), which mounts the real routes in a memory
router with fresh services and a query cache. Component tests beside the app
source use it to exercise pages and navigation.

[setup.ts](setup.ts) installs DOM matchers, starts the MSW server in
`msw/server.ts`, and cleans components and handlers between tests.
The handlers use `fixtures/notes.ts`, also shared with Playwright.

[boundaries.test.ts](boundaries.test.ts) probes the Biome plugin on Node.
[proxy.test.ts](proxy.test.ts) starts Vite's dev server from `vite.config.ts`
with `PORT_API` aimed at a throwaway HTTP server and checks what the proxy
forwards. Vitest's app project runs source tests in happy-dom; its Node
project runs these two. `../e2e/` tests the built site separately in Chromium.

