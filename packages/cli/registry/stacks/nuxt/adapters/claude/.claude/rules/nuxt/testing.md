---
paths:
  - "**/*.test.ts"
  - "e2e/**"
  - "tests/**"
  - "vitest.config.ts"
  - "playwright.config.ts"
---

Read [testing guidance](../../../docs/guidance/nuxt/testing.md). It is the shared guidance for every selected agent. `app/` tests run in the Nuxt environment with `mountSuspended`; `shared/` and `server/` tests run in plain Node and import by relative path; Playwright runs against the built server. Use `bun run test`, never `bun test`.
