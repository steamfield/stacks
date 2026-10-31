# Frontend

React and Vite inside Tauri webviews. No server, no SSR, no HTTP to Rust.

## Structure

```
src/app/                 React, alias ~/
  routes/<route>/        one entry route per window, matched by window label
    _components/ _hooks/ _lib/   local to that route
  components/ui/         shadcn primitives only
  hooks/ lib/ stores/    shared
src/core/                framework-free TypeScript, alias @core/
```

- Components never import `@tauri-apps/*`, the generated `commands`/`events`, or `@core/transport/*` (the native adapter). Get the transport from its provider and call its methods. Generated types are fine. The window label comes from the transport too.
- Command data goes through TanStack Query with centralized query keys; never build a key inline.
- Channel data feeds a zustand store created per provider (no module-level singleton). Select narrow slices; a selector that returns a fresh object or array needs `useShallow`, or every subscriber re-renders on every frame.
- Rust decides when a channel stops. Hidden webviews throttle timers, so don't rely on `setInterval` or `visibilitychange` for liveness.
- Stable keys from data identity, never the array index, for lists that update live.
- Values that update live shouldn't reflow the layout on each update. Animate `transform` and `opacity` only, and respect `prefers-reduced-motion`.
- Semantic color tokens, not literal colors. Files are kebab-case with named exports.
- `Providers` owns React subscriptions and retry timers; the native adapter shares one Rust stream for the window. The shell cancels it on page replacement, window destruction or a replacement subscription; a successful channel send cannot prove that JavaScript still has its callback. A dropped channel shows a visible reconnecting state and resubscribes. Add an unsubscribe command for other early-stop behavior.

## Testing

- Unit and component tests sit next to the source; shared helpers (`renderWithProviders`, which wires the mock transport and returns it) live in `tests/`.
- The transport is the only mock boundary. Don't `vi.mock` Tauri packages or internal modules. Push frames into the mock explicitly and advance fake timers, so a test reads "frame 1, frame 2" instead of racing a real interval.
- Cover the error and missing-data paths with fixtures, not just complete frames.
- Selector discipline is a contract: a render-count test pushes a frame that changes one slice and asserts a sibling didn't re-render. Prove it by widening the selector and watching it fail.
- Never hold an element reference across an `await`; re-query inside `waitFor`.
- Playwright runs against the Vite dev server on the mock transport, on its own free port. It can't drive the packaged webview, so changes to native behavior also need a manual `make dev` check; say when you didn't do one.
- Scope while iterating (`bun run test -- <path> -t "<name>"`), then run `make test`, then `make check` once before calling the work done.
