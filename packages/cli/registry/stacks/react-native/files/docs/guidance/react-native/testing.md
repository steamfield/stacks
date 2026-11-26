# Testing

## Layers

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit (Jest) | `bun run test src/...` | Settings, errors, logging and the native wrapper, with a fake source |
| Screen (Jest + React Native Testing Library) | `bun run test tests/...` | The real `App`, navigation and screens, with only the native spec replaced |
| Coverage | `bun run coverage` | Every Jest test, failing below the line floor in `jest.config.js` |
| Release bundle | `bun run bundle` | Metro can build the iOS and Android release JavaScript |
| Simulator build | `bun run ios:build` | A Release build of the Xcode project, pods, codegen, Swift and the bundled JavaScript, unsigned |
| Swift tests | `bun run ios:test` | The Swift logic, with Swift Testing on an iPhone simulator |
| End to end (Maestro) | `bun run ios:e2e` | The built app launches, navigates and gets the native answer, at the default and an accessibility text size |

Jest has no native runtime and the Swift tests have no JavaScript, so a spec change needs a Jest test of the wrapper and a Swift test of the native side. The Maestro flow is the only check that crosses the boundary.

## Jest

Run Jest through `bun run test` so it runs on Node. Drive the screen with `userEvent` (`const user = userEvent.setup()`, then `await user.press(...)`), which fires the whole press sequence; use `fireEvent` only for an event `userEvent` lacks. `render` is async too: await it. Find elements by role and visible text (`getByRole("button", { name: "Try again" })`), and wait for async results with `findBy*`.

`jest.mock` factories may only use variables named `mock...`. The screen tests keep a `mockGetAppInfo` function and set its answer per test; a deferred promise holds the loading state on screen until the test resolves it.

`tests/setup.ts` applies `react-native-safe-area-context`'s own Jest mock. A new native library with a Jest mock adds it there; one without gets a minimal mock of its exports in the same file.

The coverage floor (80% of lines under `src/`) lives in `jest.config.js` and is the project's to change. It covers JavaScript only: the Swift side is one small class whose cases `ios:test` runs, and an Xcode coverage floor would add a second report for little gain. Revisit that when the native code grows.

## Swift tests

`modules/app-info/ios/Tests/` uses Swift Testing (`@Test`, `#expect`, `#require`) and runs through the pod's test spec. The Podfile line with `:testspecs => ["Tests"]` makes CocoaPods generate the `AppInfo-Unit-Tests` scheme, and `scripts/ios.sh test` runs it on the simulator `scripts/sim-destination.sh` picks: `IOS_SIMULATOR_ID` if set, else a booted iPhone, else an iPhone on the newest iOS runtime. No script names a device model or OS version.

Build Swift types so tests can construct them with plain values, as `AppInfoReader(info:systemVersion:)` does, and keep calls to `Bundle.main` or `UIDevice` in one static factory. The pod compiles with complete strict concurrency checking and Swift warnings as errors.

## Maestro

`.maestro/` holds the flows. `scripts/ios.sh e2e` installs the Release app `ios:build` produced, passes its bundle identifier as `APP_ID`, and runs every flow twice: at the default text size, then at `accessibility-extra-large` (`xcrun simctl ui <device> content_size`). It puts the text size back even when a flow fails. Flows find elements by the text a screen reader announces, so a label pushed off screen at the large size, or a button without a readable name, fails the run.

A new screen gets a step in a flow when it is on a path people rely on. Maestro needs a JDK and the `maestro` CLI; the script checks for both and names what's missing.
