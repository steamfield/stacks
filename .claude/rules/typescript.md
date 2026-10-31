---
paths:
  - "packages/cli/src/**/*.ts"
  - "packages/cli/tests/**/*.ts"
  - "packages/cli/scripts/**/*.ts"
  - "packages/mcp/src/**/*.ts"
  - "packages/mcp/tests/**/*.ts"
  - "packages/mcp/e2e/**/*.ts"
  - "tests/**/*.ts"
  - "scripts/**/*.ts"
  - ".claude/hooks/**/*.ts"
---

# TypeScript

Don't cast untrusted JSON to the type you want; decode it through a schema. That includes hooks: `_lib.ts` parses Claude Code's tool payloads, which are untrusted input like any other.

Every deliberate background promise needs an owner that handles its rejection and its lifecycle (when it stops, what waits for it). Otherwise await or return it.

## Types come from schemas and services

A shape that a Schema or a service already defines is derived, never retyped: `typeof X.Type`, then `Pick`, `Omit` and indexed access (`NewResult["warnings"][number]`, `Finding["severity"]`). A local copy of `Processes`' `Finished` drifted silently until it was replaced by the import. Where a literal union exists (`Severity`, `AgentId`, `Phase`, `Kind`), a parameter takes it, not `string`, so a typo fails the build. Schema-decoded data is already readonly; exported constant data is `as const` or annotated `ReadonlyArray<T>`, and parameters that only read arrays take `ReadonlyArray<T>`.

## Assertions

`exactOptionalPropertyTypes` is off, but `Schema.optionalKey` still rejects a key that is present with `undefined` when it encodes. Build optional fields with a conditional spread, `...(x === undefined ? {} : { x })`, never `{ x: maybe }`.

No `!`. `as` is allowed in three places only: `JSON.parse(text) as unknown` before a decode; widening a const tuple for membership inside a type predicate (`(VALUES as ReadonlyArray<string>).includes(name)`); and a regex capture group the pattern always matches. Everywhere else:

- Keep literal types with an annotation (`const none: GitProbe = ...`) or `satisfies T`, never `{ kind: "fresh" } as GitState`, which also accepts a missing field.
- Narrow `unknown` with `typeof`, `instanceof` and `in` (`"code" in error && typeof error.code === "string"`), not `as NodeJS.ErrnoException`.
- With `noUncheckedIndexedAccess`, check `=== undefined` and handle it, or use a `??` fallback only when the fallback is a correct value.
- `filter((x) => x !== undefined)` already narrows (inferred type predicates, TS 5.5); don't add a hand-written predicate or a cast after it.
- A lookup table keyed by outside text reads own keys only (`Object.hasOwn`), or decodes the text with `Schema.Literals` first: `levels["constructor"]` returns `Object`, and an `as keyof typeof levels` cast hid that.

## Exhaustiveness

`noImplicitReturns` makes a `switch` that returns a value from every case exhaustive, so don't add a `default` to one over a closed union; it turns a new member into a silent fallthrough. A `switch` whose cases don't return a value ends with `default: value satisfies never;`. A switch over an open `string` (a decoded `Schema.String`, an unknown warning code) keeps a real `default`.

## Resources

Effect scopes own lifetimes (`Effect.acquireRelease`, `Scope`, finalizers). Don't use `using` or `await using`; the `ES2023` lib has no `Disposable` types and the two models don't compose.

## Compiler and config

The repo runs TypeScript 7 (`tsc` is the native compiler). 7.0 ships no compiler API, so don't add a tool that needs one (typescript-eslint's type-aware rules, ts-node) without asking. Since 6.0, `types` defaults to `[]`: a new package's `tsconfig.json` lists the ambient types it uses, as `packages/cli` does with `["bun", "node"]`. Read the installed compiler options (`tsconfig.base.json` and the package's `tsconfig.json`) before generating or editing a tsconfig, and change `target` or `lib` only after checking every runtime that loads the file.
