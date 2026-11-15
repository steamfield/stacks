# API integration tests

Start with [http-contract.test.ts](http-contract.test.ts) for the acceptance matrix:
it checks the shared contract on real Node and web transports, including static
pages, safe errors and request logs. [helpers/](helpers/) builds those targets,
captures records and mounts test-only failure routes.

[platform.test.ts](platform.test.ts) checks the live Node entry and file logging
with real temporary directories. Configuration and logging unit tests live beside
their modules in [../src/](../src/); error codec tests belong to the
[contract package](../../../packages/contract/src/errors.test.ts).

Vitest runs these tests in the root configuration's API project.
