# Library test layers

Start with [public-api.test.ts](public-api.test.ts) for the contract callers see: the
named exports and, once present, their TypeScript signatures. Unit tests live beside
modules in `../src/` and cover behavior and intentional failures.

[boundaries.test.ts](boundaries.test.ts) runs Biome against temporary fixtures to prove
the rules in `../biome-plugins/boundaries.grit` reject prohibited code and allow valid
code. Vitest runs these tests and the public-API and source unit tests on Node.

`consumer/` is a separate project, excluded from Vitest. `../scripts/consumer.ts` installs
the packed tarball there in a temporary directory, typechecks `index.ts`, and runs it
and `index.mjs` on Node to check the package users install.
