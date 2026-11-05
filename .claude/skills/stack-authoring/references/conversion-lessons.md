# Lessons from converting the bundled stacks

Read this when you convert an existing stack to a proving slice, or when a framework server, a lagging tool, generated code, an adapter, a `.tmpl` file or a fragment branch complicates the slice.

- Use the framework's own server and static-file mechanism (`react-router-serve`, Effect's `HttpStaticServer`) over a hand-written one; record its trade-offs as a Gotcha rather than replacing it.
- When one declared tool lags another's newest release (typescript-eslint or `@astrojs/check` behind a TypeScript major), Setup installs the newest release inside the lagging tool's peer range, and a Gotcha says when to drop that. This is version resolution, not a new dependency, and no version number goes anywhere.
- Code generated at setup (an OpenAPI document, a typed client, framework type files) stays generated; ship the generator config and the code that imports its output.
- Setup records toolchain versions before running the checks, since linters read them (Ruff's Python target, go.mod's directive selecting the mux behavior).
- `adapters/` carries rules and docs too (hidden directories such as `.claude/rules/`); update them with the body, and drop a `.tmpl` suffix from any adapter or doc file that uses no template variable.
- A `.tmpl` file is tokenized for `{{`, so source that needs a literal `{{` (Go templates, JSX style objects) either stays out of `.tmpl` or spells it another way.
- Keep the proving payload's names when a fragment's branch already refers to them (the `items` service `drizzle-postgres` replaces), and update that branch with the shipped names.
