---
paths:
  - "src/**"
  - "package.json"
  - "tsdown.config.ts"
---

# Library constraints

These hold for every change to the package. [Library guidance](../../../docs/guidance/typescript-library/library.md), the shared guidance for every selected agent, has the reasons and examples; read it before designing a new export.

- Every name `src/index.ts` exports is public API. Export by name: no `export default`, no `export *`, nothing from `src/internal/`.
- A change to the export list or a signature updates README.md's API section, `tests/public-api.test.ts` and `tests/consumer/` together, and names its release kind (patch, minor, major).
- Every export has an explicit type (`isolatedDeclarations`). An exported generic factory is a `function` with a declared return type, never an arrow constant.
- No enums, namespaces or constructor parameter properties (`erasableSyntaxOnly`).
- Throw only `LibraryError` (or a subclass) with a code from `src/errors.ts`. `field` names the argument or option at fault, never its value.
- `src/` imports no `node:*` or `bun`, reads no `process` and never logs.
- A `@types/*` package a public type needs goes in `dependencies`, not `devDependencies`. Adding any dependency is the person's decision.

## Untrusted input

Any export that walks values a caller passes in (objects, arrays, parsed JSON):

- Reads own properties only (`Object.hasOwn`), never inherited ones.
- Writes caller-chosen keys only into `Object.create(null)` objects or a `Map`; `__proto__`, `constructor` and `prototype` are data.
- Decides explicitly what holes in sparse arrays and non-plain objects (class instances, `Date`, `Map`) mean, and tests it.
- Bounds recursion depth and input size.
- Never shares a mutable default between calls: a default object or array a caller supplies is cloned per call.
