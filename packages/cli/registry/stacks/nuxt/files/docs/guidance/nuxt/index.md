# Nuxt guidance

Read these references before changing the corresponding code. They apply to every agent; Claude rules link here.

Nuxt, Nitro and Vue change directory layout, config keys, composables and test helpers between majors, and model memory often describes an older one (Nuxt 3 put pages at the root; this project keeps app code under `app/`). Before using an API from memory, read the installed declarations (`node_modules/nuxt/dist/`, `node_modules/@nuxt/test-utils/dist/*.d.mts`, `.nuxt/imports.d.ts` for what is auto-imported), then the matching page on nuxt.com for the installed major (each docs page has a raw Markdown version; `nuxt.com/llms.txt` lists them).

- [app](app.md): pages, layouts, components, data fetching, auto-imports and the error page.
- [server](server.md): server routes, validation, runtime config, logging and the server/client boundary.
- [testing](testing.md): what each Vitest project and Playwright cover, and how to run each.
- [verification](verification.md): checks before calling work done.
