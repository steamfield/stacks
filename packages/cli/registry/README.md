# Bundled registry

The stacks and fragments that ship with the CLI: `stacks/<id>/STACK.md` and
`fragments/<id>/FRAGMENT.md`, in the entry format the package README describes. The package
README's "Bundled stacks" table lists the stacks.

Check it with `bun run dev validate` from `packages/cli/`. The bundled registry has to pass with
zero errors and zero warnings, and every reference in it must resolve inside it;
`tests/registry/bundled-registry.test.ts` enforces both. `tests/registry/registry.test.ts` runs `new` for every
stack in both presets (and each app on the stacks it fits) and checks the brief size, the D7
verify layers and that no rendered template keeps a `{{` token.

Shipped `.ts` and `.json` files are linted by the package's Biome run (`mobile-expo` keeps its own
single-quote style through an override in `packages/cli/biome.json`), and shipped `.ts` files
typecheck through `tsconfig.registry.json` in the package `typecheck` script. `.tmpl` files are
checked only after rendering, by the composition tests.
