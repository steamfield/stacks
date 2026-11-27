---
schema_version: 1
id: react-native
kind: stack
name: React Native app (bare workflow)
description: A bare React Native app for iOS and Android in TypeScript, without Expo, where the repository owns the native projects. React Navigation drives the screens and a local Turbo Module in Swift shows the native side; Jest with React Native Testing Library, Biome, Swift tests and a Maestro flow on the iOS simulator check it.
tags: [typescript, react, react-native, mobile, ios, android, scripts, bun, node]
deps:
  app: [react, react-native, "@react-navigation/native", "@react-navigation/native-stack", react-native-screens, react-native-safe-area-context, zod]
  dev: ["@react-native-community/cli", "@react-native-community/cli-platform-ios", "@react-native-community/cli-platform-android", "@react-native/babel-preset", "@react-native/metro-config", "@react-native/typescript-config", "@react-native/jest-preset", "@babel/core", "@babel/runtime", "@babel/plugin-transform-export-namespace-from", typescript, "@types/react", "@types/jest", jest, "@testing-library/react-native", test-renderer, "@biomejs/biome"]
tools: [bun, node, ruby, bundle, xcodebuild, xcrun, maestro, java, git]
decisions:
  - "Native project name: the project name in PascalCase with no separators (default). It names the Xcode workspace and scheme, and app.json's name must match it."
  - "Bundle identifier and Android package: com.<package scope>.<project name, lowercase, no separators> (default). It names the app's data on the device, so changing it after release orphans that data."
  - "Node version: current LTS (default), recorded in .node-version. Node runs Metro, Jest and the React Native CLI; Bun installs packages and runs scripts."
  - "Android implementation of the AppInfo module: none (default), so the Android build shows the unavailable state. When the person wants one, write it in Kotlin under modules/app-info/android/ and add an Android build step that runs where the Android SDK is installed."
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: pods, phase: setup, layer: install, run: bun run pods, timeout: 20m }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: lint-native, layer: lint, run: bun run lint:native }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run coverage }
  - { name: bundle, layer: build, run: bun run bundle }
  - { name: ios-build, layer: build, run: bun run ios:build, timeout: 30m }
  - { name: ios-test, layer: test, run: bun run ios:test, timeout: 30m }
  - { name: ios-e2e, layer: test, run: bun run ios:e2e, timeout: 30m }
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  start: Metro, the JavaScript bundler and dev server
  ios: Build, install and launch the app on a simulator with Metro
  android: Build, install and launch the app on an Android emulator or device
  pods: bundle install, then pod install in ios/ (autolinks modules/ and runs codegen)
  lint: Biome over the JavaScript, TypeScript and JSON, failing on warnings
  lint:native: swift-format lint on the Swift under modules/
  format: Biome and swift-format fixes
  typecheck: tsc over the app, tests and module specs
  test: Jest with React Native Testing Library
  test:watch: Jest in watch mode
  coverage: Jest with coverage, failing below the line floor in jest.config.js (verify's test step)
  bundle: Release JavaScript bundles for iOS and Android into build/js/
  bundle:ios: The iOS release bundle
  bundle:android: The Android release bundle
  ios:build: xcodebuild Release build for an available iPhone simulator, unsigned, after checking app.json's name
  ios:test: The AppInfo pod's Swift tests on an available iPhone simulator
  ios:e2e: Install the ios:build app and run the Maestro flows at the default and an accessibility text size
  check: Every check verify runs after install
  clean: Remove coverage, bundles and Xcode derived data
---

# React Native app (bare workflow)

## What stacks wrote

stacks wrote the app's JavaScript side and its native module; the native `ios/` and `android/` projects come from React Native's generator in Setup. `index.js` registers `src/app/app.tsx`, which validates settings (`src/config.ts`), builds the logger (`src/logging.ts`) and mounts the error boundary, the services context and the React Navigation native stack (`src/app/navigation.tsx`). Home opens the app info screen, which loads the `AppInfo` Turbo Module through `src/native/app-info.ts` (timeout, zod decoding, `AppError` mapping) and renders loading, error and success states. `modules/app-info/` is the module: its codegen spec, the Swift reader, the Objective-C++ glue and a podspec with strict Swift settings and a Swift Testing test spec; `react-native.config.js` autolinks it. Jest unit and screen tests with a coverage floor, the Maestro flow in `.maestro/`, Biome, swift-format, TypeScript, Babel, Metro, the Gemfile, `scripts/ios.sh`, `scripts/sim-destination.sh` and `docs/guidance/react-native/` ship too. Read the code before extending it.

Link `docs/guidance/react-native/index.md` from AGENTS.md.

## Setup

1. Generate the native projects before installing anything. Look up the current React Native release (`npm view react-native version`), read `npx @react-native-community/cli@latest init --help`, then run init non-interactively into a temporary directory outside the project, with that React Native version, the native project name and bundle identifier from the decisions, and install, pods and git skipped.
2. Install the declared dependencies with `bun add` and `bun add -d`, taking versions from the generated `package.json` where it lists the package: `react`, `react-native`, the `@react-native/*` and `@react-native-community/cli*` packages at its exact versions, and `@babel/core` and `@babel/runtime` within its ranges, because React Native's Babel preset breaks on a newer Babel major. That rules out the plain `bun add` lines under Start here for those packages. Install `@babel/plugin-transform-export-namespace-from` at the same Babel major; everything else takes its current release within peer ranges. Then copy only the generated `ios/` (including `ios/.xcode.env`) and `android/` into the project and delete the temporary directory. Never copy its `App.tsx`, `index.js`, `app.json`, `package.json`, `Gemfile`, tests, ESLint, Prettier, Babel or Metro files over the shipped ones.
3. Replace the `stacks:fill` in `app.json`'s `name` with the native project name; `ios:build` fails until they match. In `ios/Podfile`, inside the app target and right after `config = use_native_modules!`, add `pod "AppInfo", :path => "../modules/app-info", :testspecs => ["Tests"]` so CocoaPods builds the module's test bundle.
4. Run `bun run pods`. Bundler resolves CocoaPods from the shipped Gemfile; if it or CocoaPods rejects the installed Ruby, carry over the matching exclusion from the template's Gemfile and record it under Build workarounds. React Native's notice that calling `pod install` directly is deprecated is informational.
5. Run `bun run lint`, `bun run lint:native`, `bun run typecheck`, `bun run coverage`, `bun run bundle`, `bun run ios:build`, `bun run ios:test` and `bun run ios:e2e`. `ios:e2e` needs a JDK and the Maestro CLI (Maestro's install guide has the commands); when either is missing, it names what's missing, and the install goes under Pending user actions. Where an installed release rejects shipped code or config (a renamed API, a moved option), update it from that release's docs or types, keeping every check, lint rule and assertion. Then `bun run format`.
6. Add these cases to `.claude/hooks/smoke.sh` so `hooks-smoke` covers the stack's hooks: the first three beside the other guards, the `wires` line after the existing `wires` lines (the function is defined just above them):

   ```sh
   denies "a project file edit" '{"tool_input":{"file_path":"ios/App.xcodeproj/project.pbxproj","content":"x"}}' $h/protect-native-project.sh
   allows "an Info.plist edit" '{"tool_input":{"file_path":"ios/App/Info.plist","content":"x"}}' $h/protect-native-project.sh
   allows "a TypeScript file in the Swift linter" '{"tool_input":{"file_path":"src/config.ts"}}' $h/lint-swift.sh
   wires .claude/settings.json hooks/protect-native-project.sh
   ```

7. Record Node in `.node-version`, Ruby in `.ruby-version`, Bun in `packageManager`, and React Native, Xcode, the iOS deployment target, Swift, Ruby, CocoaPods, the JDK and Maestro in the README's Toolchain section. Commit `Gemfile.lock`, `ios/Podfile.lock` and the native projects; `ios/Pods/` and `vendor/bundle/` stay ignored.
8. Fill the README's `stacks:fill` markers and AGENTS.md (commands, a single-file test example, the native-code rules, the guidance link), then run `stacks verify` until green.

## Conventions

The shipped code keeps these; new code does too. `docs/guidance/react-native/` has the reasons.

- Only `src/native/` imports a native spec. It wraps each call in a timeout, decodes the answer with zod and throws `AppError`; screens see typed state, never a raw native promise.
- Native code lives in a local module under `modules/<name>/`, listed in `react-native.config.js`, with its own podspec. Logic goes in Swift; the Objective-C++ file only conforms to the codegen protocol and forwards. The Xcode project file, the workspace, `ios/Pods/` and `Podfile.lock` change only through Xcode or `pod install`; the Claude hook denies hand edits.
- A spec file is named `Native<Name>.ts`, exports `Spec` and uses `TurboModuleRegistry.get`, so a platform without an implementation gets the unavailable state instead of a crash.
- Failures are `AppError` with a `kind`. `userMessage` and `isRetryable` in `src/errors.ts` are the one table; a new kind adds a row and a test.
- Settings live in `src/config.ts`: each has a default, a zod rule and a test row. Values arrive as the root component's initial properties, and unknown keys are rejected.
- Only `src/logging.ts` touches `console` (Biome's `noConsole` enforces it). Log events with flat fields, never user data.
- Routes are typed in `src/app/routes.ts`; a new screen adds its route there and a `Stack.Screen` in `navigation.tsx`, which registers the root stack as React Navigation's `RootNavigator` so `useNavigation()` is typed.
- Interactive elements have an accessibility role and a visible or labelled name, and text keeps the system text size (no `allowFontScaling={false}`, no fixed text heights). The Maestro flow runs at an accessibility text size to catch regressions.
- No secret ships in the JavaScript bundle, `app.json` or `Info.plist`: anyone with the app can read them. A key the app needs stays on a server the app calls. The app reads no env file; `.gitignore` ignores `.env` files.

## Testing

Jest runs `src/**/*.test.ts(x)` and `tests/**/*.test.tsx` on React Native's preset. Screen tests render the real `App` with React Native Testing Library, await `render`, press with `userEvent`, find elements by role and text, and replace only the native spec with `jest.mock`; a new screen gets a test for each state it renders. `src/native/` tests pass a fake source and cover success, unavailable, native rejection, decode failure and timeout. Verify runs Jest through `coverage`, which fails below the 80% line floor in `jest.config.js`; the person may change the floor there. The floor covers JavaScript only: the Swift side is one small class whose behavior `ios:test` checks case by case, so an Xcode coverage floor isn't worth a second report until the native code grows.

The native side has three checks. `ios:build` builds Release for the simulator with signing off, so the JavaScript bundle is inside the app. `ios:test` runs `modules/app-info/ios/Tests/` (Swift Testing) through the pod's test spec, which compiles with complete strict concurrency checking and Swift warnings as errors. `ios:e2e` installs the `ios:build` product and runs the Maestro flows in `.maestro/` twice, at the default text size and at `accessibility-extra-large`, resetting the size even when a flow fails. All three use the iPhone simulator `scripts/sim-destination.sh` picks; set `IOS_SIMULATOR_ID` to a UDID to use your own. A new Swift type gets `@Test` cases; a new screen people rely on gets a flow step. Jest can't see native code and the Swift tests can't see JavaScript, so a spec change needs both; only the Maestro flow crosses the boundary.

## Commands

`package.json` wires every declared command. Mirror them in AGENTS.md with a scoped example such as `bun run test src/native/app-info.test.ts`. `bun start` serves Metro for `bun run ios` and `bun run android`; neither is part of verify.

<!-- stacks:when with=ci-github -->
CI needs two jobs behind `ci-ok`. An `ubuntu-latest` job sets up Node and Bun and runs install, lint, typecheck, coverage and bundle, none of which need Xcode. A macOS job on the image whose Xcode matches the README sets up Node, Bun and Ruby (from `.ruby-version`, with Bundler caching), installs Maestro from its Homebrew tap and uses the image's JDK, then runs install, pods, lint:native, ios:build, ios:test and ios:e2e. Cache `ios/Pods` keyed on `ios/Podfile.lock`, and upload `~/.maestro/tests/` when the job fails. No Android build runs until the AppInfo module has an Android implementation.
<!-- stacks:end -->

<!-- stacks:when with=git-hooks -->
Add `lefthook install` to a `prepare` script, as the git-hooks body describes. pre-commit runs Biome with fixes on staged JavaScript, TypeScript and JSON, and `xcrun swift-format lint --strict` on staged Swift under `modules/` (the generated Swift in `ios/` keeps the generator's formatting, as with `lint:native`); pre-push runs typecheck and tests. The Xcode build stays in CI and verify.
<!-- stacks:end -->

## Gotchas

- Metro, Jest and the React Native CLI run on Node. Use `bun run test`, never `bun test`.
- Jest loads zod's CommonJS build and passes; Metro loads its ESM build, which needs the namespace export plugin in `babel.config.js`. Keep the plugin, and run `bundle` after adding any package that ships ESM.
- The native project name must be a valid identifier, so it differs from the kebab-case package name. Scripts find the workspace by globbing `ios/*.xcworkspace`; keep exactly one.
- Codegen runs during `pod install` and writes into `ios/build/generated/`. After changing a spec, run `bun run pods` again before `ios:build`, or the Objective-C++ file won't match the generated protocol. Derived data goes to `build/ios/` so `clean` never deletes codegen output.
- `pod install` rewrites the Xcode project file and the workspace. Commit those changes with the Podfile change that caused them. CocoaPods crashes with an `Encoding::CompatibilityError` without a UTF-8 locale, so `pods` sets `LC_ALL` for `pod install`; keep it when editing the script.
- `ios:build` builds Release, so the app carries its JavaScript and runs without Metro; that is what `ios:e2e` installs. Debug-only native code (`#if DEBUG` in the generated delegate) isn't compiled by verify; `bun run ios` still builds Debug and loads JavaScript from Metro. `bundle` covers the Android release JavaScript, which no native build here produces.
- macOS ships `/usr/bin/java` even without a JDK, so `which java` passes on any Mac. `ios:e2e` asks `/usr/libexec/java_home` instead and fails, naming the JDK or Maestro, when either is missing.
- Simulator builds skip signing. A device or archive build needs a team set in Xcode, which only a person with an Apple developer account can do: list it under Pending user actions.
