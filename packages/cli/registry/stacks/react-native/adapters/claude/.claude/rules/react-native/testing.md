---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "tests/**"
  - "modules/*/ios/Tests/**"
  - ".maestro/**"
  - "jest.config.js"
---

- Run Jest through `bun run test` (Node), never `bun test`.
- Screen tests render the real `App` and find elements by role and visible text. Replace only the native spec with `jest.mock`, through a variable named `mock...`; never mock app modules.
- `await render(...)`, press with `userEvent` (`await user.press(...)`), and wait for async results with `findBy*`, not timers.
- Each state a screen renders gets a test. Each Swift type gets Swift Testing cases (`@Test`) in `modules/<name>/ios/Tests/`, run by `bun run ios:test`.
- Maestro flows in `.maestro/` find elements by visible text and run at two text sizes through `bun run ios:e2e`, after `bun run ios:build`.
- Never loosen an assertion, lower the coverage floor in `jest.config.js` or delete a test to get green.

Details: [testing guidance](../../../docs/guidance/react-native/testing.md).
