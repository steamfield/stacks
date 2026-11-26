---
schema_version: 1
id: react-native
kind: stack
name: React Native app (bare workflow)
description: A bare React Native app for iOS and Android in TypeScript, without Expo, where the repository owns the native projects. React Navigation drives the screens and a local Turbo Module in Swift shows the native side; Jest with React Native Testing Library, Biome and a simulator build check it.
tags: [typescript, react, react-native, mobile, ios, android, scripts, bun, node]
deps:
  app: [react, react-native, "@react-navigation/native", "@react-navigation/native-stack", react-native-screens, react-native-safe-area-context, zod]
  dev: ["@react-native-community/cli", "@react-native-community/cli-platform-ios", "@react-native-community/cli-platform-android", "@react-native/babel-preset", "@react-native/metro-config", "@react-native/typescript-config", "@react-native/jest-preset", "@babel/core", "@babel/runtime", "@babel/plugin-transform-export-namespace-from", typescript, "@types/react", "@types/jest", jest, "@testing-library/react-native", test-renderer, "@biomejs/biome"]
tools: [bun, node, ruby, bundle, xcodebuild, xcrun, git]
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
  - { name: test, layer: test, run: bun run test }
  - { name: bundle, layer: build, run: bun run bundle }
  - { name: ios-build, layer: build, run: bun run ios:build, timeout: 30m }
  - { name: ios-test, layer: test, run: bun run ios:test, timeout: 30m }
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  start: Metro, the JavaScript bundler and dev server
  ios: Build, install and launch the app on a simulator with Metro
  android: Build, install and launch the app on an Android emulator or device
  pods: bundle install, then pod install in ios/ (autolinks modules/ and runs codegen)
  lint: Biome over the JavaScript, TypeScript and JSON
  lint:native: swift-format lint on the Swift under modules/
  format: Biome and swift-format fixes
  typecheck: tsc over the app, tests and module specs
  test: Jest with React Native Testing Library
  test:watch: Jest in watch mode
  coverage: Jest with coverage
  bundle: Release JavaScript bundles for iOS and Android into build/js/
  bundle:ios: The iOS release bundle
  bundle:android: The Android release bundle
  ios:build: xcodebuild Debug build for the iOS simulator, unsigned, after checking app.json's name
  ios:test: The AppInfo pod's XCTest bundle on an available iPhone simulator
  check: Every check verify runs after install
  audit: Check the JavaScript dependencies in bun.lock for known vulnerabilities (bun audit; needs the network)
  clean: Remove coverage, bundles and Xcode derived data
---

# React Native app (bare workflow)

## What stacks wrote

stacks wrote the app's JavaScript side and its native module; the native `ios/` and `android/` projects come from React Native's generator in Setup. `index.js` registers `src/app/app.tsx`, which validates settings (`src/config.ts`), builds the logger (`src/logging.ts`) and mounts the error boundary, the services context and the React Navigation native stack (`src/app/navigation.tsx`). Home opens the app info screen, which loads the `AppInfo` Turbo Module through `src/native/app-info.ts` (timeout, zod decoding, `AppError` mapping) and renders loading, error and success states. `modules/app-info/` is the module: its codegen spec, the Swift reader, the Objective-C++ glue and a podspec with an XCTest test spec; `react-native.config.js` autolinks it. Jest unit and screen tests, Biome, TypeScript, Babel, Metro, the Gemfile, `scripts/ios.sh`, `scripts/sim-destination.sh` and `docs/guidance/react-native/` ship too. Read the code before extending it.

Link `docs/guidance/react-native/index.md` from AGENTS.md.

## Setup

1. Generate the native projects before installing anything. Look up the current React Native release (`npm view react-native version`), read `npx @react-native-community/cli@latest init --help` (the generator React Native's own docs name, published by the react-native-community organization on npm), then run init non-interactively into a temporary directory outside the project, with that React Native version, the native project name and bundle identifier from the decisions, and install, pods and git skipped.
2. Install the declared dependencies with `bun add` and `bun add -d`, taking versions from the generated `package.json` where it lists the package: `react`, `react-native`, the `@react-native/*` and `@react-native-community/cli*` packages at its exact versions, and `@babel/core` and `@babel/runtime` within its ranges, because React Native's Babel preset breaks on a newer Babel major. That rules out the plain `bun add` lines under Start here for those packages. Install `@babel/plugin-transform-export-namespace-from` at the same Babel major; everything else takes its current release within peer ranges. Then copy only the generated `ios/` (including `ios/.xcode.env`) and `android/` into the project and delete the temporary directory (if a command guard refuses, leave it; it sits outside the project). Never copy its `App.tsx`, `index.js`, `app.json`, `package.json`, `Gemfile`, tests, ESLint, Prettier, Babel or Metro files over the shipped ones.
3. Replace the `stacks:fill` in `app.json`'s `name` with the native project name; `ios:build` fails until they match. In `ios/Podfile`, inside the app target and right after `config = use_native_modules!`, add `pod "AppInfo", :path => "../modules/app-info", :testspecs => ["Tests"]` so CocoaPods builds the module's XCTest bundle.
4. Run `bun run pods` with a Homebrew or version-manager Ruby first on PATH; the script refuses macOS's `/usr/bin/ruby`, whose old Bundler stamps a `Gemfile.lock` no newer Ruby can load. Bundler resolves CocoaPods from the shipped Gemfile; if it or CocoaPods rejects the installed Ruby, carry over the matching exclusion from the template's Gemfile and record it under Build workarounds. React Native's notice that calling `pod install` directly is deprecated is informational.
5. Run `bun run lint`, `bun run lint:native`, `bun run typecheck`, `bun run test`, `bun run bundle`, `bun run ios:build` and `bun run ios:test`. Where an installed release rejects shipped code or config (a renamed API, a moved option), update it from that release's docs or types, keeping every check, lint rule and assertion. Then `bun run format`.
6. If `.claude/hooks/smoke.sh` exists, add these cases beside the other guards, so `hooks-smoke` covers the stack's hooks. The three hooks come with the Claude Code adapter; when Claude Code isn't a target agent they're absent, the cases skip, and you don't write them yourself.

   ```sh
   if [ -f $h/protect-native-project.sh ]; then
     denies "a Podfile.lock edit" '{"tool_input":{"file_path":"ios/Podfile.lock","content":"x"}}' $h/protect-native-project.sh
     allows "a project file edit" '{"tool_input":{"file_path":"ios/App.xcodeproj/project.pbxproj","content":"x"}}' $h/protect-native-project.sh
     allows "an Info.plist edit" '{"tool_input":{"file_path":"ios/App/Info.plist","content":"x"}}' $h/protect-native-project.sh
     wires .claude/settings.json hooks/protect-native-project.sh
   fi
   if [ -f $h/guard-react-native.sh ]; then
     denies "Metro in the foreground" '{"tool_input":{"command":"bun run start"}}' $h/guard-react-native.sh
     allows "the Jest run" '{"tool_input":{"command":"bun run test"}}' $h/guard-react-native.sh
     wires .claude/settings.json hooks/guard-react-native.sh
   fi
   if [ -f $h/lint-swift.sh ]; then
     allows "a TypeScript file in the Swift linter" '{"tool_input":{"file_path":"src/config.ts"}}' $h/lint-swift.sh
   fi
   ```

7. Record Node in `.node-version`, Bun in `packageManager`, and React Native, Xcode, the iOS deployment target, Swift, Ruby and CocoaPods in the README's Toolchain section. Commit `Gemfile.lock`, `ios/Podfile.lock` and the native projects; `ios/Pods/` and `vendor/bundle/` stay ignored.
8. Fill the README's `stacks:fill` markers and AGENTS.md (commands, a single-file test example, the native-code rules, the guidance link), then run `stacks verify` until green.

## Conventions

The shipped code keeps these; new code does too. `docs/guidance/react-native/` has the reasons.

- Only `src/native/` imports a native spec. It wraps each call in a timeout, decodes the answer with zod and throws `AppError`; screens see typed state, never a raw native promise.
- Native code lives in a local module under `modules/<name>/`, listed in `react-native.config.js`, with its own podspec. Logic goes in Swift; the Objective-C++ file only conforms to the codegen protocol and forwards. `ios/Pods/`, `Podfile.lock` and the workspace change only through `bun run pods`; the Claude hook denies hand edits to them. Keep edits to the Xcode project file to settings a module can't carry.
- Metro (`bun run start`) and Jest's watch mode never exit, so an agent runs Metro only in the background and tests through `bun run test`; `guard-react-native.sh` denies them in the foreground.
- A spec file is named `Native<Name>.ts`, exports `Spec` and uses `TurboModuleRegistry.get`, so a platform without an implementation gets the unavailable state instead of a crash.
- Failures are `AppError` with a `kind`. `userMessage` and `isRetryable` in `src/errors.ts` are the one table; a new kind adds a row and a test.
- Settings live in `src/config.ts`: each has a default, a zod rule and a test row. Values arrive as the root component's initial properties, and unknown keys are rejected.
- Only `src/logging.ts` touches `console` (Biome's `noConsole` enforces it). Log events with flat fields, never user data.
- Routes are typed in `src/app/routes.ts`; a new screen adds its route there and a `Stack.Screen` in `navigation.tsx`.

## Testing

Jest runs `src/**/*.test.ts(x)` and `tests/**/*.test.tsx` on React Native's preset. Screen tests render the real `App` with React Native Testing Library, await `render` and `fireEvent`, find elements by role and text, and replace only the native spec with `jest.mock`; a new screen gets a test for each state it renders. `src/native/` tests pass a fake source and cover success, unavailable, native rejection, decode failure and timeout.

The native side has two checks. `ios:build` compiles the app, pods and module for the simulator with signing off. `ios:test` runs `modules/app-info/ios/Tests/` through the pod's test spec on an iPhone simulator that `scripts/sim-destination.sh` picks at run time; set `SIMULATOR_UDID` to a UDID to use your own. A new Swift type gets XCTest cases there. Jest can't see native code and XCTest can't see JavaScript, so a spec change needs both. `bundle` proves the release JavaScript builds, which Jest alone doesn't (see Gotchas).

## Commands

`package.json` wires every declared command. Mirror them in AGENTS.md with a scoped example such as `bun run test src/native/app-info.test.ts`. `bun start` serves Metro for `bun run ios` and `bun run android`; neither is part of verify. `bun run audit` needs the network, so `check` leaves it out.

<!-- stacks:when with=ci-github -->
CI needs two jobs behind `ci-ok`. An `ubuntu-latest` job sets up Node and Bun and runs install, lint, typecheck, coverage and bundle, none of which need Xcode, then audit as its own step. A `macos-latest` job (or the runner image with the Xcode version the README records) sets up Node, Bun and Ruby with Bundler caching, then runs install, pods, lint:native, ios:build and ios:test. Cache `ios/Pods` keyed on `ios/Podfile.lock`. No Android build runs until the AppInfo module has an Android implementation.
<!-- stacks:end -->

<!-- stacks:when with=git-hooks -->
Add `lefthook install` to a `prepare` script, as the git-hooks body describes. pre-commit runs Biome with fixes on staged JavaScript, TypeScript and JSON, and `xcrun swift-format lint --strict` on staged Swift under `modules/` (the generated Swift in `ios/` keeps the generator's formatting, as with `lint:native`); pre-push runs typecheck and tests. The Xcode build stays in CI and verify.
<!-- stacks:end -->

## Gotchas

- Metro, Jest and the React Native CLI run on Node. Use `bun run test`, never `bun test`.
- Jest loads zod's CommonJS build and passes; Metro loads its ESM build, which needs the namespace export plugin in `babel.config.js`. Keep the plugin, and run `bundle` after adding any package that ships ESM.
- The native project name must be a valid identifier, so it differs from the kebab-case package name. Scripts find the workspace by globbing `ios/*.xcworkspace`; keep exactly one.
- Codegen runs during `pod install` and writes into `ios/build/generated/`. After changing a spec, run `bun run pods` again before `ios:build`, or the Objective-C++ file won't match the generated protocol. Derived data goes to `build/ios/` so `clean` never deletes codegen output.
- `pod install` rewrites the Xcode project file and the workspace. Commit those changes with the Podfile change that caused them. CocoaPods warns unless `LANG` is a UTF-8 locale.
- `ios:build` builds Debug, which loads JavaScript from Metro at run time; `bundle` is what proves the release JavaScript builds.
- Simulator builds skip signing. A device or archive build needs a team set in Xcode, which only a person with an Apple developer account can do: list it under Pending user actions.
