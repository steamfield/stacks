---
description: Add a feature slice end to end (schema, Effect program, resource route, page or UI, tests)
argument-hint: "<what the feature does>"
---

Add a feature: $ARGUMENTS

The extract feature is the smallest complete slice, so use it as the template: `app/schemas/extract.ts`, `app/.server/extract.ts`, `app/routes/api.extract.ts`, `app/routes/extract.tsx`, `app/components/extract-form.tsx`, `tests/extract.test.ts`, and the `api.extract` case in `tests/chat-routes.test.ts`. Read the rules for the paths you touch (`routes.md`, `effect-server.md`, `ui.md`, `testing.md`) and the Effect guidance (`docs/guidance/effect/index.md`, when the effect fragment is selected) before writing Effect code.

If the request is ambiguous (what goes in, what comes out, what counts as failure), state your assumptions in one short list before writing code, and ask if a wrong guess would be expensive to undo.

1. **Schema** in `app/schemas/<domain>.ts`, re-exported from `index.ts`: the request body and the response, each a `Schema.Struct` with a same-named type. Decoding is where validation lives (trim, lengths, brands), with a `message` on anything a user can trip.
2. **Program** in `app/.server/<domain>.ts`: `<name>Program(request)` spends a rate-limit token (`yield* enforceRateLimit(request)`, required for anything that calls a paid model), reads and decodes the body (`readJsonBody` → `decodeInput(Schema)`), and hands the decoded input to a function that does the work and gets services with `yield*`. That split keeps the core testable without a Request (see `extractProgram` / `extractContact`). Expected failures are tagged errors. Reuse the ones in `errors.ts` where they fit. A new error gets a status in `statusFor` and a user-safe message. State that needs to persist or be shared is a service (`/add-service`), not a module-level variable.
3. **Route**: a resource route `app/routes/api.<name>.ts` (path params go in the file name and in `routes.ts`, e.g. `api.chats.$chatId.export.ts` for `api/chats/:chatId/export`) whose action or loader is one line, `return runRoute(request, <name>Program(request))`, and which exports nothing else (another export touching `~/.server` fails only the build). Add it to `app/routes.ts`, then run `bun run typecheck` so `./+types/api.<name>` exists. A page that needs data on load uses a loader with `runData`.
4. **UI** (if the feature has one): a page route plus a component under `app/components/`, built from the shadcn components in `app/components/ui/`. It `fetch`es the resource route and shows loading, error (the response's `{ message, retryable }`, read with `errorFrom` from `~/lib/chat`; a Retry button, if any, only when `retryable`), and success states. Components import types from `~/schemas`, never from `app/.server/`.
5. **Tests**:
   - the program with `it.effect` and `Effect.provide(makeTestLayer(...))`, covering success and each tagged error
   - the route with a real `Request` on `useTestRuntime`, covering 200 and every error status it returns: for an action that takes a body, 400 for a bad body, 415 for a non-JSON body, and 429 once the rate limit is spent; for a GET route, 400 for a bad param and 404 for a missing thing (see `tests/chat-export.test.ts`)
   - one component test (happy-dom) if there is UI
   - a stub for any third-party HTTP call, so no test touches the network
6. `/check`, then run the app (`bun run dev:bg`, see `verification.md`) and exercise the feature once for real. If it adds something a user clicks, consider one step in `e2e/chat.spec.ts`.

Keep the slice thin. Don't add abstractions, config, or options the request didn't ask for; say what you left out instead.
