# Notes store

Start with [notes.ts](notes.ts): `NotesStore` is the persistence interface consumed
by the notes routes, and `createMemoryNotes` is its process-local implementation.
It uses the resource types from `../schemas/notes.ts` and accepts an optional
clock and id generator.

[notes.test.ts](notes.test.ts) supplies deterministic values to check creation
and pagination independently of HTTP. [../app.ts](../app.ts) creates the default
store, while integration tests can inject another implementation.

State disappears on restart. A database-backed store can implement the same
interface without moving persistence into the routes.

