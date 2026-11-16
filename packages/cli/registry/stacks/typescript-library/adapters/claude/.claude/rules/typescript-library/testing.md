---
paths:
  - "src/**/*.test.ts"
  - "tests/**"
---

# Testing constraints

[Testing guidance](../../../docs/guidance/typescript-library/testing.md), the shared guidance for every selected agent, has the detail.

- Run Vitest with `bun run test` (scope with `bun run test <file>` or `-t "<name>"`). Never `bun test` or `--bun`.
- Unit tests sit beside the code as `test.each` tables: input and exact output, and input and the `{ code, field }` it raises, asserted with `expect.objectContaining({ code, field })`.
- An export that walks caller values gets a hostile-input table: `__proto__`, `constructor` and `prototype` keys (including from `JSON.parse`), inherited properties, sparse arrays, non-plain objects, deep nesting, and two calls that must not share a default.
- A new export adds its name to the sorted list and its `expectTypeOf` checks in `tests/public-api.test.ts`, and a call in `tests/consumer/`.
- Don't mock library modules, and never weaken or skip an assertion to get green.
- Read the counts: a filter that matches nothing passes with every test skipped.
