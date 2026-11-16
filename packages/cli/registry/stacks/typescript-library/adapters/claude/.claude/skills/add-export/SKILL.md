---
name: add-export
description: Add a function, class, type or option to this TypeScript library's public API end to end, with its error codes, tests, README entry and consumer check. Use when asked for a new export, a new option or a change to an exported signature.
---

# Add an export

Follow the public API and options patterns in `docs/guidance/typescript-library/library.md`, the named exports in `src/index.ts`, the export and signature checks in `tests/public-api.test.ts`, and the installed-package calls in `tests/consumer/`.

Before any code, write down: the name, its full signature with explicit types, each error code it can raise, and the release kind (patch, minor or major, from the table in the guidance). Ask before a change that is major: a removed or renamed export, a changed default, a new required parameter.

1. **Failing tests** beside the module (`src/<name>.test.ts`): a `test.each` table of inputs and exact outputs, then one of inputs and the `{ code, field }` each raises. If it walks caller values (objects, arrays, parsed JSON), add the hostile-input table from `docs/guidance/typescript-library/testing.md`: `__proto__` and `constructor` keys, inherited properties, sparse arrays, non-plain objects, nesting past the depth bound, and two calls sharing a caller-supplied default. Run them and watch them fail.
2. **Errors**: a new failure adds a code to `LibraryErrorCode` and its message to `messages` in `src/errors.ts`. Throw `new LibraryError(code, { field })`.
3. **Options**, if it takes any: an interface of optional `readonly` fields, frozen defaults and a resolve function that checks every value and rejects unknown keys with `LibraryError`. When the API first takes options, add `invalid_option` to `src/errors.ts` for these failures.
4. **Code** in `src/<name>.ts` with explicit return types; private helpers in `src/internal/`. No `node:*`, `process` or `console`. Caller values follow the guidance's "Untrusted input": own properties only, caller-chosen keys into `Object.create(null)` or a `Map`.
5. **Export** it by name from `src/index.ts` (types with `type`), and add it to the sorted list in `tests/public-api.test.ts`.
6. **Consumer**: call it in `tests/consumer/index.ts` with its types, and check a JavaScript misuse in `index.mjs` if it takes input.
7. **README**: its entry in the API section with an example, and any new rows in the options and error tables.
8. **Review**: run the `reviewer` agent on the diff when `.claude/agents/reviewer.md` exists, otherwise check the diff yourself against AGENTS.md and `.claude/rules/typescript-library/`. Fix what it finds.
9. Run `stacks verify --all`. Read the new export in `dist/index.d.ts`. Name the release kind in your summary; never bump the version or publish.

Keep it thin: no options, overloads or aliases the request didn't ask for.
