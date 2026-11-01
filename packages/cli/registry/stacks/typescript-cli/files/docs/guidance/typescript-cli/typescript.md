# TypeScript

Only the things that are easy to get wrong here. Effect-specific typing is in `docs/guidance/effect/api.md`.

## Compiler and config

- Check the installed compiler before writing config. If it's TypeScript 7 (the Go port), the binary is still `tsc` (there is no `tsgo`) and there is no programmatic API (`require("typescript")` exports only `version`), so don't add scripts or tools that need the compiler API. `bun run typecheck` is plain `tsc` (no codegen step).
- Options removed in 6.0/7.0 are hard errors there, not warnings: `baseUrl` (`paths` entries are relative, `"./src/*"`), `moduleResolution: node`/`node10`, `downlevelIteration`, and `esModuleInterop` or `allowSyntheticDefaultImports` set to false.
- With `erasableSyntaxOnly` on (TS1294): no `enum` (use a union of literals or an `as const` object), no namespaces, no constructor parameter properties (declare the field and assign it).
- `types` includes Bun's, so the `Bun` global and `bun:*` modules type-check in every file, including the ones vitest runs on Node. tsc won't tell you that `Bun.file` in `src/core/` breaks under vitest; the `guard-boundaries` hook and `biome-plugins/boundaries.grit` do. A new global types package goes in `types` in `tsconfig.json`.
- `lib` limits which built-ins type-check even when the runtimes have them (`Object.groupBy`, `Promise.withResolvers`, Set methods, iterator helpers). The error is TS2550 ("change your target library"), or TS2339 for iterator helpers like `.values().map`. Either raise `lib` on purpose or don't use the API; don't cast or polyfill around it. The code runs on Node (vitest), Bun (`bun run dev`), and the compiled Bun binary: check all three before raising it.
- Use extensionless relative imports, as the shipped files do. No path alias is configured in TypeScript or Vitest.

## Places strict mode still gives you `any`

`JSON.parse`, `Response.json()`, and the `reason` in `promise.catch((e) => ...)` are `any`; only `try/catch` variables are `unknown`. Trust boundaries here are argv and stdin, the config file, files on disk, and every third-party response: decode with an Effect Schema, or type the value as `unknown` first, never cast straight to the expected shape.

## Narrowing that doesn't work

- `.filter(Boolean)` does not narrow, despite inferred type predicates: `[1, undefined].filter(Boolean)` is still `(number | undefined)[]`. Write `.filter((x) => x !== undefined)`. Inference also stops if the callback has a `: boolean` annotation or more than one `return`.
- With `noUncheckedIndexedAccess`, `arr[i]`, `record[key]`, `const [first] = arr`, and `process.argv[2]` are `T | undefined`, and `arr.length > 0` doesn't narrow `arr[0]`. Use `for...of`, `.entries()`, or check the element itself, not `!`.
- `Array.isArray(x)` on `string | readonly string[]` narrows the true branch to `any[]` and doesn't narrow the false branch. Test the other member instead (`typeof x === "string"`).
- An `interface` isn't assignable to `Record<string, unknown>` (no implicit index signature); a `type` alias is. When a shape has to pass as a record (a log annotation object), declare it with `type`. Keep `interface` elsewhere, as the code does.
- `(["a", "b"] as const).includes(s)` rejects `s: string`. Widen the array (`(arr as readonly string[]).includes(s)`) or write a guard; don't cast `s`.

## Promises

The shipped Biome config enables floating- and misused-promise checks. Every promise's rejection must be handled (await it, return it, or end the chain with `.catch`). A deliberate background task needs an owner that observes its failure and lifetime; `void` alone doesn't handle rejection. In a CLI a late rejection can arrive after the runtime has gone. Effect code brings promises in as described in `effect-services.md`.
