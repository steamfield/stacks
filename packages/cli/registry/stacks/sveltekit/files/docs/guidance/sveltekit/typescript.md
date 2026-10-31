# TypeScript

Only the things that are easy to get wrong here.

## Compiler and config

- `tsconfig.json` extends the config SvelteKit generates on `svelte-kit sync`. Keep the `extends` and add strictness flags (`noUncheckedIndexedAccess`) and include entries; don't set `paths` or `rootDirs` yourself, since the kit owns them and warns when they're overridden.
- `bun run typecheck` syncs first, then runs `svelte-check`, which checks `.svelte` files as well as `.ts`. Plain `tsc` skips `.svelte` files, so its silence proves nothing about components.
- Route modules import their types from `./$types`, which sync generates per route. A missing `$types` module means sync hasn't run since the route changed.
- Resolve the newest TypeScript inside SvelteKit, svelte-check and typescript-eslint's peer ranges. These tools need the compiler's JavaScript API.
- Imports use the shipped package's `#lib/*` mapping or a relative path.

## Places strict mode still gives you `any`

`JSON.parse`, `Response.json()`, `request.json()` and the `reason` in `promise.catch((e) => ...)` are `any`. Request bodies, `FormData` values and URL search params are trust boundaries: type them as `unknown` and parse with zod. `formData.get()` returns `FormDataEntryValue | null`, which can be a `File`; the schema handles that, not a cast.

## Narrowing that doesn't work

- `.filter(Boolean)` doesn't always narrow; write `.filter((x) => x !== undefined)`.
- With `noUncheckedIndexedAccess`, `arr[i]` and `record[key]` are `T | undefined`, and `arr.length > 0` doesn't narrow `arr[0]`. Use `for...of` or check the element itself, not `!`.
- `(["a", "b"] as const).includes(s)` rejects `s: string`. Widen the array or write a guard; don't cast `s`.

## Promises

The recommended ESLint configs don't enable floating-promise checks. Every promise's rejection must be handled (await it, return it, or end the chain with `.catch`), and `void` marks a deliberate fire-and-forget.
