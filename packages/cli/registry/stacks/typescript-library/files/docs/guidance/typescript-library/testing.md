# Testing

Read [engineering testing](../engineering/testing.md) for test layers, real dependencies and assertions. This doc covers the library's Vitest and package checks.

Run Vitest with `bun run test`. It runs `src/**/*.test.ts` and `tests/**/*.test.ts` on Node. Never use `bun test` or `--bun`: those select Bun's test runner or runtime, bypassing the supported Vitest-on-Node setup and potentially changing test discovery, APIs and runtime behavior. No hook enforces this; choose the supported command yourself.

- Put pure-logic tests beside the code (`src/slugify.test.ts`, `src/options.test.ts`, `src/errors.test.ts`). Use `test.each`: each row gives an input and exact output, or an input and the error `code` and `field` it raises. Assert errors with `expect.objectContaining({ code, field })`; fixed message wording isn't the caller's error contract.
- Keep the sorted runtime export list and public error checks in `tests/public-api.test.ts`. A new export adds its name there, which forces the release decision.
- Pin public signatures and inferred types with Vitest's `expectTypeOf`, as in `tests/public-api.test.ts`. These assertions do nothing at runtime; `bun run typecheck` checks them because `tsconfig.json` includes `src/` and `tests/`. Keep `@ts-expect-error` cases for calls the API must reject.
- Keep Grit boundary probes in `tests/boundaries.test.ts`: each rule fires on a fixture file and stays quiet where the thing is allowed. A new rule adds a row to both tables.
- Exercise the installed package through `tests/consumer/` with `bun run test:consumer` (`scripts/consumer.ts`), outside Vitest. It packs the package, installs the tarball into a temporary copy of the fixture, typechecks `index.ts` with strict NodeNext resolution and runs `index.ts` and `index.mjs` with Node. A new export gets a call in `index.ts` with its types and, if JavaScript callers can misuse it, a runtime check in `index.mjs`.

For async APIs, await the operation and use `await expect(promise).rejects.toMatchObject({ code, field })` for typed rejections. For eventual results, use Vitest's `vi.waitFor` with an assertion that throws until the condition holds. Trigger the operation once outside the callback. If a test controls time, advance timers with async APIs so promises settle, and restore real timers during teardown. Restore spies with `vi.restoreAllMocks()`; don't mock library modules to isolate a test.

Coverage thresholds live in `vitest.config.ts` (`bun run coverage`); every branch of a public function is reachable from its inputs, so cover it through the public function rather than lowering a threshold.

Scope a run with `bun run test <file>` or `bun run test -t "<name>"`, and read the counts: a filter that matches nothing passes with every test skipped. See [verification](verification.md) for checks of the packed package.
