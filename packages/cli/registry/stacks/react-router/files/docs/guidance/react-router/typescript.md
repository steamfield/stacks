# TypeScript

Only the things that are easy to get wrong here. Effect-specific typing is in `docs/guidance/effect/api.md`.

## Compiler and config

- Check the installed compiler and generated `tsconfig` before choosing compiler APIs or options. If the installed release has no programmatic API, keep scripts on the `tsc` command and do not add tools that import the compiler.
- Check the installed compiler before using legacy options such as `baseUrl`, `moduleResolution: node`/`node10`, `downlevelIteration`, or false `esModuleInterop` and `allowSyntheticDefaultImports`; newer releases may reject them. Keep `paths` entries relative, such as `"./app/*"`.
- If the generated config enables `erasableSyntaxOnly`, avoid `enum` (use a union of literals or an `as const` object), namespaces and constructor parameter properties (declare the field and assign it).
- `types` defaults to `[]`, so `@types/*` packages aren't picked up automatically. A new global types package goes in `types` in `tsconfig.json`.
- The generated `tsconfig` sets `lib`; check it before using newer built-ins (`Object.groupBy`, `Promise.withResolvers`, Set methods, iterator helpers). TS2550 or TS2339 can mean the library setting excludes the API. Raise `lib` deliberately or avoid the API; check browser support as well as Node before raising it.
- Imports are extensionless or use `~/`. Don't add `.ts` or `.js` extensions.

## Places strict mode still gives you `any`

`JSON.parse`, `Response.json()`, and the `reason` in `promise.catch((e) => ...)` are `any`; only `try/catch` variables are `unknown`. On the server, request bodies and third-party responses are trust boundaries: decode with an Effect Schema, or type the value as `unknown` first (`request.json() as Promise<unknown>` in `http.ts`), never cast straight to the expected shape. Client code reading the app's own resource routes may cast to the shared schema type (components can't import Effect).

## Narrowing that doesn't work

- `.filter(Boolean)` does not narrow, despite inferred type predicates: `[1, undefined].filter(Boolean)` is still `(number | undefined)[]`. Write `.filter((x) => x !== undefined)`. Inference also stops if the callback has a `: boolean` annotation or more than one `return`.
- With `noUncheckedIndexedAccess`, `arr[i]`, `record[key]`, and `const [first] = arr` are `T | undefined`, and `arr.length > 0` doesn't narrow `arr[0]`. Use `for...of`, `.entries()`, or check the element itself, not `!`.
- `Array.isArray(x)` on `string | readonly string[]` narrows the true branch to `any[]` and doesn't narrow the false branch. Test the other member instead (`typeof x === "string"`).
- An `interface` isn't assignable to `Record<string, unknown>` (no implicit index signature); a `type` alias is. When a shape has to pass as a record, declare it with `type`. Keep `interface` elsewhere, as the code does.
- `(["a", "b"] as const).includes(s)` rejects `s: string`. Widen the array (`(arr as readonly string[]).includes(s)`) or write a guard; don't cast `s`.

## Promises

Nothing lints floating promises: tsc doesn't, and Biome's `noFloatingPromises` is a nursery rule that isn't enabled. Every promise's rejection must be handled (await it, return it, or end the chain with `.catch`), and `void` marks a deliberate fire-and-forget. Effect code brings promises in as described in `effect-server.md`.
