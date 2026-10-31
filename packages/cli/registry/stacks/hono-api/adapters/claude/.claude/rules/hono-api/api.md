---
paths:
  - "src/**"
---

Read [API guidance](../../../docs/guidance/hono-api/api.md) before changing the server. It is the shared guidance for every selected agent. Declare every route with `createRoute()` on a router from `createRouter()`, so validation and `/openapi.json` can't drift.
