---
paths:
  - "src/**/*.tsx"
  - "src/app/**"
  - "src/features/**"
---

- Screens read state from a hook and render every state it has (loading, error through `ErrorState`, success). They never call a native module or `fetch` directly.
- Failures become `AppError` through `toAppError`; the text comes from `userMessage`, and "Try again" appears only when `isRetryable` says so.
- A new screen adds its route to `src/app/routes.ts` and a `Stack.Screen` in `src/app/navigation.tsx`, and types its props with `RootScreenProps<"Name">`.
- Settings come from `useServices().config`; logging from `useServices().logger`. Only `src/logging.ts` touches `console`.
- Buttons are `Pressable` with `accessibilityRole="button"` and visible text, so tests and screen readers find them by name.

Details: [app guidance](../../../docs/guidance/react-native/app.md).
