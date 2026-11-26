---
paths:
  - "modules/**"
  - "ios/**"
  - "react-native.config.js"
  - "src/native/**"
---

- Native code goes in a local module under `modules/<name>/` with its own podspec, listed in `react-native.config.js`. Never hand-edit `*.pbxproj`, `*.xcworkspace`, `ios/Pods/` or `Podfile.lock`; a hook denies it. Ask the user for a change only Xcode can make.
- Logic lives in Swift. The Objective-C++ file conforms to the codegen protocol and forwards; its header stays free of C++.
- A spec is `Native<Name>.ts`, exports `Spec` and uses `TurboModuleRegistry.get`. After changing one, run `bun run pods` before `bun run ios:build`.
- Only `src/native/` imports a spec; it adds the timeout, zod decoding and `AppError` mapping.
- Run `bun run lint:native`, `bun run ios:build` and `bun run ios:test` after native changes.

Reasons and the steps for a second module: [native modules](../../../docs/guidance/react-native/native-modules.md).
