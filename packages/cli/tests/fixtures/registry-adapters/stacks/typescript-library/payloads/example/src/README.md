# Library source

Start with [index.ts](index.ts), the package's named public exports, then read
[slugify.ts](slugify.ts) for the example feature. It combines [options.ts](options.ts)
for defaults and runtime validation with [internal/words.ts](internal/words.ts) for
private text processing. [errors.ts](errors.ts) defines the failures callers can handle.

This code stays platform neutral: no runtime imports, process access or console output.
Unit tests sit beside their modules; `../tests/public-api.test.ts` pins the exports and
signatures. When replacing the example, keep the public entry and error conventions,
and update the tests and package README with the new API.
