---
paths:
  - "packages/format/**"
---

# Format package

This package owns the shared entry, manifest, run-record and canonical bundle contracts.
Keep runtime source portable: no `node:*`, `bun`, `bun:*` or `@effect/platform-*` imports.
Use standard Web APIs and Effect core; platform I/O belongs to consumers.

Extend the public contracts additively. Existing exports from `src/index.ts` and their behavior
are stable, because the CLI and the hosted API both depend on them; a new contract is exported
from `src/index.ts` in the same change that adds it.
