---
paths:
  - "apps/api/test/**"
  - "apps/mobile/test/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Test harnesses

Read `docs/testing.md` before writing or fixing a test. The rules that break things when ignored:

- API tests start with `const t = setupApiTest('<label>')` and need `bun run db:up`. Read `t.*` inside tests, never at module scope.
- Mobile tests use `renderScreen` and stub only `fetch` (`mockJsonResponse`, extended with a dispatch helper when needed) plus the module stubs in the table in `docs/testing.md`.
- Await every `render`, `rerender`, `unmount`, and `fireEvent`.
- Mobile tests run under jest on Node; never `bun test` them.
