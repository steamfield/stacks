# JavaScript API

What the npm package exports, and the rules for changing it. Every export is declared in `src/lib.rs`; `make build` generates `pkg/<name>.js` and `pkg/<name>.d.ts` from it.

## Exports

| Export | Kind | What it is |
| --- | --- | --- |
| `slugify(input, options?)` | function | A slug string |
| `slugInfo(input, options?)` | function | A `SlugInfo` object: the slug, the words kept, and whether it was truncated |
| `Slugger` | class | Unique slugs across calls: `new Slugger(options?)`, `slug(input)`, `size`, `reset()`, `free()`, `[Symbol.dispose]` |
| `SlugOptions` | type | `separator?: "-" \| "_" \| "."`, `maxLength?: number` |
| `SlugInfo` | type | `slug`, `words`, `truncated` |
| `SlugError`, `SlugErrorCode` | types | The thrown error and its codes |

## Errors

Every export throws an `Error` named `SlugError` with `code` and, for some `invalid_option` errors, `field`.

| Code | Thrown by | When |
| --- | --- | --- |
| `empty_input` | `slugify`, `slugInfo`, `Slugger.slug` | The input is empty or only whitespace |
| `empty_result` | `slugify`, `slugInfo`, `Slugger.slug` | The input has no letters or digits |
| `invalid_option` | every function taking options, `new Slugger` | An unknown key, a wrong type, or a value out of range |

## Output format

`make build` runs `wasm-pack build --target bundler`: ES modules that import the `.wasm` file, which bundlers and current Node load. A different target (`web`, which needs an explicit `init()`, or `nodejs`, CommonJS for Node only) changes how every user loads the package and is a breaking change.

## Semver

Before 1.0 the minor version is the breaking one (0.1 to 0.2).

Breaking:

- removing or renaming an export, method, getter, option or field of a returned object
- changing an argument's type, or making an optional argument required
- renaming or removing an error code, or throwing a different code for the same input
- accepting less than before (an input or option that now throws)
- changing the build target

Not breaking: adding an export, a method, an optional argument or option, a field to a returned object, or an error code for a new failure.

## Checking a change

`make test-js` packs the package, unpacks it into `consumer/node_modules/` and typechecks and runs `consumer/test/` against the generated `.d.ts`. Read the diff of `pkg/<name>.d.ts` after `make build`: it is the API users compile against.
