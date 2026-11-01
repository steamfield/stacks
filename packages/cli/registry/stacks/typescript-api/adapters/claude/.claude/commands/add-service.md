---
description: Add an Effect service (a Context service class with static layers) and wire it into AppLayer
argument-hint: "<service name and responsibility>"
---

Add a service: $ARGUMENTS

Follow `docs/guidance/typescript-api/effect-api.md`, and read an existing service in `src/services/` first.

1. **Interface.** A `Context` service class (the installed release's form; `docs/guidance/effect/api.md` names it) in `src/services/<Name>.ts` with a namespaced key and a small interface of Effect-returning methods whose requirements are `never`. Failures it can produce are tagged errors in `errors.ts`, each with its `apiErrorTable` row.
2. **Layers.** A `static readonly layer` built from an effectful `make`, yielding its dependencies and Config once in `make`. If it keeps state, add `static readonly layerMemory` with fresh state per build. New env vars go in `config.ts`, `.env.example` and README.
3. **Wire it** into `AppLayer` and the test app helper in `tests/helpers/`. A missing service shows up as a type error where the app layer is built.
4. **Tests** through the endpoints that use it, on its real `layer` where that's in-memory or on a local stub server where it calls a third party. `TestClock` for anything time-based.
5. `bun run check`.

Keep the interface free of its backing store, so a different store later is a new layer, not a new interface.
