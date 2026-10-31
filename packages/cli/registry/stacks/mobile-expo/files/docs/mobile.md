# Mobile app

Everything under `apps/mobile/src`. AGENTS.md has the commands; this file is how screens are written and how to debug one that doesn't show up.

## Data access: hooks only

Screens and components get data only through hooks in `src/lib/queries/`. Nothing else imports `src/lib/api.ts`, the `hc<AppType>` client. The hooks layer is the seam: if `hc`'s inference gets slow as routes grow, a client generated from `/openapi.json` replaces it there and screens don't change.

A hook owns its query key (from `queryKeys` in `src/lib/queries/keys.ts`, never an inline array, so invalidation stays greppable), its `staleTime`, and its error mapping. Keys start with their domain so a mutation can invalidate a whole domain. A screen owns only rendering `data`, `isPending`, and `error`. Response types come from the schemas workspace package, not hand-written interfaces.

Failed responses go through one function, `apiError(response, fallback)` in `queries/api-error.ts`, which reads the API's `{ message }` without ever failing itself (a proxy's HTML 502 or an empty body still yields an `ApiError` with the fallback). `actionableMessage(error)` returns the server's sentence only for statuses whose message is meant for a person (400, 403, 404, 409) and `null` otherwise, so a screen writes `actionableMessage(error) ?? 'That didn't go through. Try again.'`.

## Styling: NativeWind utilities

Style with utility classes. Never `StyleSheet.create`, never a styled-component wrapper. A value off the design scale is an arbitrary utility (`top-[52px]`), not a style object. Tokens live in `src/global.css`'s theme block (NativeWind's CSS-first line on Tailwind's CSS-first config); there is no Tailwind JS config. A value that isn't a token shouldn't be invented at a call site: add the token. Screens use semantic tokens, not raw palette ramps.

An inline `style` prop is allowed for exactly four reasons, each with a one-line comment saying which:

1. A Reanimated animated style.
2. A runtime value: a safe-area inset, a measured layout, a size passed as a prop.
3. A property with no utility (for example `borderCurve: 'continuous'`, kept as one shared constant).
4. A prop that only takes a style, such as `contentContainerStyle` where there's no class equivalent.

`className` only works on components NativeWind knows. NativeWind's import rewriting covers `react-native` itself (`View`, `Text`, `Pressable`, `ScrollView`); a component from any other package silently drops the prop and renders unstyled. A `SafeAreaView` that lost its `flex-1` this way collapses to zero height and looks like a blank screen. Register third-party components once, in `src/components/styled.ts`, and import them from there; never call `styled` at a call site.

## Debugging a screen

`bun run dev` records everything it prints (migrations, the api, the native build, Metro, the app's `console.*`) to `.logs/dev.log`, truncated each run. Read it with `bun run dev:logs` before asking for a screenshot.

- A blank screen is usually not a crash. Check the log for a stack trace first. Then `bun run sim:shot` and read the colours: React Navigation's default theme background (read `DefaultTheme.colors.background` from the installed package) means a navigator is mounted and the screen drew nothing; your page background token means the screen is there. Log at every branch that can `return null` (loading and auth gates in layouts) to find where it parks.
- A rendered but invisible screen is a styling failure. Drop in `<View style={{ height: 120, backgroundColor: 'red' }} />`. If it appears, the component is mounted, and `className` produced nothing: bisect the utilities. Delete it when done.
- Expo's build output drops clang's notes, so a native build failure may be missing its explanation; re-run the failing build phase directly for raw diagnostics.

Jest can't catch either: it renders the tree but computes no layout. Layout and styling regressions are caught by looking at the simulator.
