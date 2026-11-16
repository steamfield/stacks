# Public API, errors and packaging

Read [architecture](../engineering/architecture.md) for module boundaries, [code style](../engineering/code-style.md) for file headers and folder READMEs, and [error handling](../engineering/errors.md) for propagation and recovery. The rules below describe this library's TypeScript contracts and packaging.

## The public API

- `src/index.ts` is the only entry point. `package.json`'s `exports` maps `.` to its build (`dist/index.js` and `dist/index.d.ts`) and `./package.json` to itself; nothing else is importable.
- Export by name. No `export default`, no `export *`: the list in `src/index.ts` is the API, and `tests/public-api.test.ts` pins it.
- `src/internal/` holds helpers no caller may import. `src/index.ts` never re-exports from it; a public module may import it.
- Every exported function, class member and constant has an explicit type. `isolatedDeclarations` makes tsc fail without one, and tsdown's declaration build needs it.
- Public types are `interface` or `type` with `readonly` fields. An option a caller may leave out is optional (`?:`); `exactOptionalPropertyTypes` stops `undefined` standing in for "absent".
- A change to the export list or a signature updates README.md's API section, `tests/public-api.test.ts` and `tests/consumer/` in the same change.

## Inference-heavy APIs

Schema builders and parsers, whose types come from their arguments, still need an explicit type on every export:

- Write an exported factory as a `function` with a declared return type: `export function string(): Schema<string>`, or `export function object<S extends Shape>(shape: S): Schema<{ [K in keyof S]: Infer<S[K]> }>`. An arrow constant such as `export const string = () => new Schema<string>(...)` or `export const literal = <const V extends string>(value: V) => new Schema<V>(...)` fails tsc with TS9013, "Expression type can't be inferred with --isolatedDeclarations". The fix is the return type; never turn `isolatedDeclarations` off.
- Derive a value's type with an exported conditional type: `export type Infer<S> = S extends Schema<infer T> ? T : never;`.
- Under `exactOptionalPropertyTypes`, an optional key (`name?: string`) rejects an explicit `undefined`. If an `.optional()`-style key should also accept `undefined` as a value, type it `name?: string | undefined`.
- Pin inferred types with `expectTypeOf` tests (testing.md).

## Versioning

Semantic versioning, decided per change:

| Change | Release |
| --- | --- |
| A bug fix, a doc fix, a stricter check that only rejects what was already documented as invalid | patch |
| A new export, a new optional option, a new error code | minor |
| A removed or renamed export, option or error code, a changed default, a new required parameter, a dropped runtime | major |

While the version is `0.x`, a breaking change bumps the minor. Write what changed and its release kind in the pull request; the maintainer cuts releases.

## Errors

- Throw only `LibraryError` with a code from `LibraryErrorCode` (`src/errors.ts`), or a subclass of it. Each code has one fixed message in `messages`. A new failure adds a code there, a row in README.md's error table and a test.
- `field` names the argument or option at fault, never the value: values may be large or private.
- When a failure carries detail the caller needs (validation issues with paths, a parse error's position), extend `LibraryError` with a typed, `readonly` payload. The subclass keeps a code, its fixed message and the `LibraryError` name, so `isLibraryError` still matches it. Export the subclass from `src/index.ts` and document its payload in the README. Keep raw input values out of the payload, as with `field`:

  ```ts
  export class ParseError extends LibraryError {
    readonly pos: number;

    constructor(pos: number, options: LibraryErrorOptions = {}) {
      super("invalid_input", options);
      this.pos = pos;
    }
  }
  ```
- Translate a lower-level failure into `LibraryError` with `cause` in `LibraryErrorOptions`, so callers still get a code and the original failure. A caught value is `unknown`: narrow it with `isLibraryError` before reading `code` or `field`; never cast it to hide a different failure.
- `isLibraryError` checks name and code, so it works across two installed copies of the package; `instanceof` doesn't.
- A function that can fail on caller input gets a `safe*` form returning `Result<T>` only when callers need it; it returns `LibraryError` and lets anything else (a bug) throw. Callers narrow the discriminated union before reading its value or error; never convert every caught exception into a Result failure.

## Options and defaults

Use an interface of optional `readonly` fields, frozen defaults and a resolve function that fills omitted fields and checks every value at runtime for JavaScript callers. It rejects unknown keys with a typed `LibraryError` naming the key in `field`. When the API first takes options, the options module adds the `invalid_option` code and message to `src/errors.ts` for these failures.

The library's own defaults are frozen and shared. A default the caller supplies is different: a `default({})` or `default([])` on a schema, or an initial value passed to a builder, is cloned for each call that uses it, so one call's mutation never shows up in the next.

## Untrusted input

Treat every value a caller passes in as hostile when an export walks it: an object, an array, a parsed JSON document. A parser, validator, merger or serializer is the usual case.

- Read own properties only. Use `Object.hasOwn(value, key)` and `Object.keys`, never `key in value` or a bare `value[key]` lookup on a key the caller chose, which finds `toString` and anything on a polluted prototype.
- Write caller-chosen keys only into an object made with `Object.create(null)` or into a `Map`. `__proto__`, `constructor` and `prototype` are ordinary data keys: `JSON.parse('{"__proto__": 1}')` produces an own property named `__proto__`, and assigning it to a plain `{}` changes that object's prototype instead of storing the key.
- Decide what holes in sparse arrays mean (`[1, , 3]`: an error, `undefined`, or skipped) and what non-plain objects mean (class instances, `Date`, `Map`, objects with a null prototype), write it in the README and test it. `Array.prototype.forEach` and `map` skip holes; a `for` loop doesn't.
- Bound recursion depth and input size, and fail with a `LibraryError` past the bound rather than overflowing the stack.
- Error payloads name the path (`["items", 3, "name"]`), never the value, as with `field`.

testing.md has the hostile-input test table every such export gets.

## Runtime and side effects

- `src/` is platform neutral: no `node:*` or `bun` imports, no `process`, no `console`, no globals beyond the language's own. The Grit plugin fails lint on a break. A feature that truly needs Node takes it as a parameter, or the package becomes Node-only (tsdown's `platform: "node"` and a README note): a major decision, so ask first.
- `sideEffects: false` in `package.json` promises bundlers that importing a module does nothing but define exports. Keep module top levels free of registration, patching or I/O.

## Dependencies

The package ships no runtime dependencies. A new one is a decision for the maintainer: it lands in every user's install. When one is agreed:

- It goes in `dependencies` if `dist/` imports it at runtime, `peerDependencies` if the caller must supply the same instance (a framework), and `devDependencies` only if nothing in `dist/` imports it.
- A `@types/*` package that a public type refers to goes in `dependencies`; in `devDependencies` the published declarations break for every TypeScript user. `test:consumer` catches it.
- tsdown leaves `dependencies` and `peerDependencies` external and bundles anything else `src/` imports. Check `dist/` after adding one.

## Packaging

- ESM only, one entry, declarations bundled by tsdown into `dist/`. `files: ["dist"]` keeps the tarball to the build, `package.json`, README and license.
- `bun run lint:package` runs publint (the `package.json` fields against the packed files) and Are the Types Wrong with the ESM-only profile (every resolution mode a TypeScript user might have). Both pack the package. publint packs without lifecycle scripts, so `lint:package` builds first; attw's pack runs `prepack`.
- Never edit `dist/`; it is rebuilt on every pack.
- `"private": true` stays until the maintainer decides to publish. Publishing, `npm version`, tags and dist-tags are the maintainer's steps.
