# Testing

Vitest runs every test on Node: `src/**/*.test.ts` and `tests/**/*.test.ts`. Never `bun test`.

- **Unit tests** beside the code (`src/slugify.test.ts`, `src/options.test.ts`, `src/errors.test.ts`). Table-driven with `test.each`: each row an input and the exact output, or an input and the error `code` and `field` it raises. Assert errors with `expect.objectContaining({ code, field })`, not the message text.
- **Public API** in `tests/public-api.test.ts`: the sorted list of runtime exports, and the error type through the public entry. A new export adds its name there, which forces the release decision.
- **Boundary probes** in `tests/boundaries.test.ts`: each Grit rule fires on a fixture file and stays quiet where the thing is allowed. A new rule adds a row to both tables.
- **Consumer** in `tests/consumer/`, run by `bun run test:consumer` (`scripts/consumer.ts`), not Vitest. It packs the package, installs the tarball into a temporary copy of the fixture, typechecks `index.ts` with strict NodeNext resolution and runs `index.ts` and `index.mjs` with Node. A new export gets a call in `index.ts` (with its types) and, if JavaScript callers can misuse it, a runtime check in `index.mjs`.

Coverage thresholds live in `vitest.config.ts` (`bun run coverage`); every branch of a public function is reachable from its inputs, so cover it through the public function rather than lowering a threshold.

Scope a run with `bun run test <file>` or `bun run test -t "<name>"`, and read the counts: a filter that matches nothing passes with every test skipped.
