# Shared HTTP contract

Start with [api.ts](api.ts), which collects resource declarations such as
[groups/health.ts](groups/health.ts). [schemas/health.ts](schemas/health.ts) defines
request and response shapes, re-exported through [schemas/index.ts](schemas/index.ts).
[errors.ts](errors.ts) owns tagged failures, status mappings and safe envelope codecs;
[errors.test.ts](errors.test.ts) checks that contract.

The package depends only on Effect. The API implements it and the site derives its
typed client from it, so neither application imports the other's source.
Consumers use [../index.ts](../index.ts), the public entry for declarations,
schemas and errors.
