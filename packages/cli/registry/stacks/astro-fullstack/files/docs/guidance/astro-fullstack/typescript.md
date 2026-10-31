# TypeScript

Only the things that are easy to get wrong here. Effect-specific typing is in the `effect` skill.

## Compiler and config

- Check the installed TypeScript major before trusting an example. Options a newer major removed are hard errors, not warnings (`baseUrl`, `moduleResolution: node`/`node10`, `downlevelIteration`, `esModuleInterop: false`).
- Node runs the source as written, through type stripping. So `erasableSyntaxOnly` is on (TS1294): no `enum` (use a union of literals or an `as const` object), no namespaces, no constructor parameter properties (declare the field and assign it). Contract and API relative imports carry their `.ts` extension; no path aliases. Both apps import only the contract's public `packages/contract/index.ts`, using relative paths so Node loads source without a package transpilation step. Never import another workspace's private `src/` files. `apps/web/` follows Astro's strict preset. Tooling and hooks run under Bun with bundler resolution, so their imports stay extensionless.
- `types` lists the global types packages explicitly; a new one goes in the workspace's `tsconfig.json`, not a triple-slash reference.
- When a built-in fails to type-check with TS2550 ("change your target library"), either raise `lib` on purpose to what the `.node-version` Node supports or don't use the API; don't cast or polyfill around it.

## Places strict mode still gives you `any`

`JSON.parse`, `Response.json()`, and the `reason` in `promise.catch((e) => ...)` are `any`; only `try/catch` variables are `unknown`. Request input and third-party responses are trust boundaries: decode with an Effect Schema, or type the value as `unknown` first, never cast straight to the expected shape.

## Narrowing that doesn't work

- `.filter(Boolean)` does not narrow: `[1, undefined].filter(Boolean)` is still `(number | undefined)[]`. Write `.filter((x) => x !== undefined)`.
- With `noUncheckedIndexedAccess`, `arr[i]`, `record[key]` and `const [first] = arr` are `T | undefined`, and `arr.length > 0` doesn't narrow `arr[0]`. Use `for...of`, `.entries()`, or check the element itself, not `!`.
- `Array.isArray(x)` on `string | readonly string[]` narrows the true branch to `any[]`. Test the other member instead (`typeof x === "string"`).
- An `interface` isn't assignable to `Record<string, unknown>`; a `type` alias is.
- `(["a", "b"] as const).includes(s)` rejects `s: string`. Widen the array or write a guard; don't cast `s`.

## Promises

Enable the installed linter's floating-promise rule. Every promise's rejection is handled (await it, return it, or end the chain with `.catch`), and `void` marks a deliberate fire-and-forget. Effect code brings promises in through `Effect.tryPromise`, as `effect-api.md` describes.
