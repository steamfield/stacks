---
paths:
  - "app/**"
  - "shared/**"
  - "nuxt.config.ts"
---

Read [app guidance](../../../docs/guidance/nuxt/app.md). It is the shared guidance for every selected agent. App code lives under `app/` (the Nuxt 4 layout, not the root), relies on auto-imports instead of explicit imports for Vue and Nuxt composables, reads data with `useFetch` and a key, and never imports from `server/`. Read `.nuxt/imports.d.ts` before assuming a composable exists.
