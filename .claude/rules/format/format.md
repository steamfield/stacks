---
paths:
  - "packages/format/**"
---

# Format package

This package owns the wire contracts the CLI and the hosted API share: entry format, manifest,
run record, canonical bundle, index, search, stats and dependency schemas.
Keep runtime source portable: no `node:*`, `bun`, `bun:*` or `@effect/platform-*` imports in
`src/` (`biome-plugins/no-platform-imports.grit` enforces it).
Use standard Web APIs and Effect core; platform I/O belongs to consumers.

Extend the public contracts additively. Existing exports from `src/index.ts` and their behavior
are stable, because the CLI and the hosted API both depend on them; a new contract is exported
from `src/index.ts` in the same change that adds it.
