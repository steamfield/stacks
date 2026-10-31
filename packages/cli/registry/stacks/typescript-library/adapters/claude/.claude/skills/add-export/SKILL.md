---
name: add-export
description: Add a function, class, type or option to this TypeScript library's public API end to end, with its error codes, tests, README entry and consumer check. Use when asked for a new export, a new option or a change to an exported signature.
---

# Add an export

Follow `slugify`: `src/slugify.ts`, `src/options.ts`, `src/errors.ts`, `src/index.ts`, `tests/public-api.test.ts` and `tests/consumer/` are the model. Read `docs/guidance/typescript-library/library.md` first.

Before any code, write down: the name, its full signature with explicit types, each error code it can raise, and the release kind (patch, minor or major, from the table in the guidance). Ask before a change that is major: a removed or renamed export, a changed default, a new required parameter.

1. **Failing tests** beside the module (`src/<name>.test.ts`): a `test.each` table of inputs and exact outputs, then one of inputs and the `{ code, field }` each raises. Run them and watch them fail.
2. **Errors**: a new failure adds a code to `LibraryErrorCode` and its message to `messages` in `src/errors.ts`. Throw `new LibraryError(code, { field })`.
3. **Options**, if it takes any: an interface of optional `readonly` fields, frozen defaults and a runtime check of every field, as `resolveOptions` does.
4. **Code** in `src/<name>.ts` with explicit return types; private helpers in `src/internal/`. No `node:*`, `process` or `console`.
5. **Export** it by name from `src/index.ts` (types with `type`), and add it to the sorted list in `tests/public-api.test.ts`.
6. **Consumer**: call it in `tests/consumer/index.ts` with its types, and check a JavaScript misuse in `index.mjs` if it takes input.
7. **README**: its entry in the API section with an example, and any new rows in the options and error tables.
8. `bun run check`, then `stacks verify`. Read the new export in `dist/index.d.ts`. Name the release kind in your summary; never bump the version or publish.

Keep it thin: no options, overloads or aliases the request didn't ask for.
