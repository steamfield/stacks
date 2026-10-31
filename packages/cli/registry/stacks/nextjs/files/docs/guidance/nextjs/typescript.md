# TypeScript

Only the things that are easy to get wrong here.

## Compiler and config

- Keep the shipped `tsconfig.json` shape: its Next plugin entry and its include list, which covers Next's generated route types. Preserve strictness flags (`noUncheckedIndexedAccess`).
- `tsconfig.tools.json` checks scripts and harness hooks separately, without Next's ambient `ProcessEnv` augmentation that requires `NODE_ENV`. Both programs run in `typecheck`; neither skips the hook tests. Claude's `typecheck-tools-on-write.ts` supplies tools-program diagnostics alongside the shared app checker. Keep framework imports out of the tools program.
- `bun run typecheck` generates route types before `tsc`. Typed links and route props fail tsc until generation has run, so run the script rather than bare `tsc`.
- Check the installed compiler before using legacy options such as `baseUrl` or `moduleResolution: node`; newer releases reject them. Keep `paths` relative (`"@/*": ["./src/*"]`).
- If the installed TypeScript has no JavaScript compiler API, editor and build type checks go through the `tsc` CLI; read the TypeScript page in the installed Next config docs before changing how `next build` checks types.
- Imports use `@/` or a relative path, without `.ts` or `.js` extensions.

## Places strict mode still gives you `any`

`JSON.parse`, `Response.json()`, `request.json()` and the `reason` in `promise.catch((e) => ...)` are `any`. Request bodies, `FormData` values and search params are trust boundaries: type them as `unknown` and parse with zod. `formData.get()` returns `FormDataEntryValue | null`, which can be a `File`; the schema handles that, not a cast.

## Narrowing that doesn't work

- `.filter(Boolean)` doesn't always narrow; write `.filter((x) => x !== undefined)`.
- With `noUncheckedIndexedAccess`, `arr[i]` and `record[key]` are `T | undefined`, and `arr.length > 0` doesn't narrow `arr[0]`. Use `for...of` or check the element itself, not `!`.
- `(["a", "b"] as const).includes(s)` rejects `s: string`. Widen the array or write a guard; don't cast `s`.

## Promises

ESLint's Next config doesn't enable floating-promise checks. Every promise's rejection must be handled (await it, return it, or end the chain with `.catch`), and `void` marks a deliberate fire-and-forget. In Next, page `params` and `searchParams` may be promises depending on the release; check the installed page props types before reading them.
