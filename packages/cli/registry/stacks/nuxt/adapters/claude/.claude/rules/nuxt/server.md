---
paths:
  - "server/**"
  - "shared/**"
  - "nuxt.config.ts"
  - ".env.example"
---

Read [server guidance](../../../docs/guidance/nuxt/server.md). It is the shared guidance for every selected agent. Every route validates its input with the shared zod schema and throws `createError` with a status for expected failures; secrets go only in private `runtimeConfig` keys, never under `public`; server code reads config through `serverConfig()` and logs only through `log()` with its fixed fields.
