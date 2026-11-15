# API tests

Start with [http-contract.test.ts](http-contract.test.ts): it runs the acceptance
matrix against a real Node listener and the web handler. [helpers/](helpers/) supplies
the shared targets, captured logs and test-only failure routes.

[config.test.ts](config.test.ts), [errors.test.ts](errors.test.ts) and
[logging.test.ts](logging.test.ts) check the core boundaries.
[platform.test.ts](platform.test.ts) exercises the live Node server and real log
files, including rotation and recovery.

Vitest runs these tests on Node. Development-script and Biome boundary smoke tests
live separately in [../scripts/](../scripts/).
