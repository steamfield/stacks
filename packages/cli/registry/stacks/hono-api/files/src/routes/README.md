# HTTP routes

Start with [notes.ts](notes.ts) for the versioned list, get and create endpoints.
Each declaration combines request and response schemas from `../schemas/notes.ts`
with a handler using the injected `NotesStore`. Persistence lives in
[../services/notes.ts](../services/notes.ts).

[health.ts](health.ts) declares the unversioned health probe.
[../app.ts](../app.ts) mounts both routers and publishes their OpenAPI document.
Every router comes from [../router.ts](../router.ts), whose validation hook
turns rejected input into the shared error envelope.

`../../tests/http-contract.test.ts` checks these endpoints through the real app.

