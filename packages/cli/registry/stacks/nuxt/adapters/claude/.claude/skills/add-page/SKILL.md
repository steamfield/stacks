---
name: add-page
description: Add a page to this Nuxt app together with the server route it reads or writes, its zod schema and tests. Use when asked for a new page, screen, view, form or API route backed by server data.
---

# Add a page with its server route

Follow the notes slice; `shared/schemas/note.ts`, `server/api/notes.*.ts`, `server/utils/notes.ts`, `app/pages/index.vue` and `app/components/AddNoteForm.vue` are the model.

1. **Schema.** Input the server accepts goes in `shared/schemas/<thing>.ts` as a zod object, with a `fieldErrors` helper if a form posts it. Add its tests beside it (accepted, trimmed, each rejection message).
2. **Server util.** State or I/O goes in `server/utils/<thing>.ts` as async functions (auto-imported into routes), with a test-only reset if it holds state. Test it in `server/utils/<thing>.test.ts`, importing by relative path.
3. **Route.** `server/api/<thing>.get.ts` (or `.post.ts`, `[id].get.ts`): validate with `readValidatedBody` or `getValidatedQuery` and the shared schema, throw `createError({ statusCode, statusMessage, data })` for expected failures, return `{ <thing> }`. Log only through `log()` with its fixed fields.
4. **Failing browser test.** In `e2e/` (extend `notes.spec.ts` or add a spec), assert what a person sees on the page and what the API answers for valid and invalid input. Run `bun run e2e` and watch it fail.
5. **Page.** `app/pages/<path>.vue` with one root element: `await useFetch("/api/<thing>", { key: "<thing>" })`, a branch for `error`, and `refresh()` after a write. A form is its own component in `app/components/` that posts with `$fetch` and shows `data.fields` from a 400. Don't import from `server/`; don't add imports Nuxt auto-imports.
6. **Component test**, for a form or anything with state: `app/components/<Name>.test.ts` with `mountSuspended` and `registerEndpoint` for the route.
7. Link the page from the layout or another page with `<NuxtLink>`.
8. `bun run check`, then `stacks verify`.
