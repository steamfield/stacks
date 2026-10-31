---
paths:
  - "src/**"
  - "package.json"
  - "tsdown.config.ts"
---

Read [library guidance](../../../docs/guidance/typescript-library/library.md) before changing the package. It is the shared guidance for every selected agent. Every name `src/index.ts` exports is public API: a change to it updates README.md's API section, `tests/public-api.test.ts` and `tests/consumer/` together, and a `@types/*` package a public type needs goes in `dependencies`, not `devDependencies`.
