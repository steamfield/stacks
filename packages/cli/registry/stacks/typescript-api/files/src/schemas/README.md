# Boundary schemas

[health.ts](health.ts) defines the health response and the proving endpoint's path,
query and body shapes using Effect Schema. Start there, then follow the named exports
through [index.ts](index.ts) to [../api/health.ts](../api/health.ts).

Keep each domain's boundary shapes together and re-export them through the index.
These schemas depend only on Effect; services can use their types without importing
HTTP handlers or runtime code. The HTTP contract suite checks decoding through real
requests.
