# Testing

## Layers

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit (Jest) | `bun run test src/...` | Settings, errors, logging and the native wrapper, with a fake source |
| Screen (Jest + React Native Testing Library) | `bun run test tests/...` | The real `App`, navigation and screens, with only the native spec replaced |
| Release bundle | `bun run bundle` | Metro can build the iOS and Android release JavaScript |
| Simulator build | `bun run ios:build` | The Xcode project, pods, codegen and Swift compile, unsigned |
| XCTest | `bun run ios:test` | The Swift logic, on an iPhone simulator |

Jest has no native runtime and XCTest has no JavaScript, so a spec change needs a Jest test of the wrapper and an XCTest case of the Swift side.

## Jest

Run Jest through `bun run test` so it runs on Node. React Native Testing Library's `render` and `fireEvent` are async: await them. Find elements by role and visible text (`getByRole("button", { name: "Try again" })`), and wait for async results with `findBy*`.

`jest.mock` factories may only use variables named `mock...`. The screen tests keep a `mockGetAppInfo` function and set its answer per test; a deferred promise holds the loading state on screen until the test resolves it.

`tests/setup.ts` applies `react-native-safe-area-context`'s own Jest mock. A new native library with a Jest mock adds it there; one without gets a minimal mock of its exports in the same file.

## XCTest

`modules/app-info/ios/Tests/` runs through the pod's test spec. The Podfile line with `:testspecs => ["Tests"]` makes CocoaPods generate the `AppInfo-Unit-Tests` scheme, and `scripts/ios.sh test` runs it on the simulator `scripts/sim-destination.sh` picks: `SIMULATOR_UDID` if set, else a booted iPhone, else an iPhone on the newest iOS runtime. No script names a device model or OS version.

Build Swift types so tests can construct them with plain values, as `AppInfoReader(info:systemVersion:)` does, and keep calls to `Bundle.main` or `UIDevice` in one static factory.
