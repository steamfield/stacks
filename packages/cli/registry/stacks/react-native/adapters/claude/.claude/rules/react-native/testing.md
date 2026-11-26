---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "tests/**"
  - "modules/*/ios/Tests/**"
  - "jest.config.js"
---

- Run Jest through `bun run test` (Node), never `bun test`.
- Screen tests render the real `App` and find elements by role and visible text. Replace only the native spec with `jest.mock`, through a variable named `mock...`; never mock app modules.
- `await render(...)` and `await fireEvent.press(...)`; wait for async results with `findBy*`, not timers.
- Each state a screen renders gets a test. Each Swift type gets XCTest cases in `modules/<name>/ios/Tests/`, run by `bun run ios:test`.
- Never loosen an assertion or delete a test to get green.

Details: [testing guidance](../../../docs/guidance/react-native/testing.md).
