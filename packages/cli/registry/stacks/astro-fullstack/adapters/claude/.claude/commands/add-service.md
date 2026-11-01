---
description: Add an Effect service (a Context service class with static layers) to the API and wire it into AppLayer
argument-hint: "<service name and responsibility>"
---

Add a service: $ARGUMENTS

Follow `docs/guidance/astro-fullstack/effect-api.md`, and read an existing service in `apps/api/src/services/` first.

1. **Interface.** A `Context` service class (the installed release's form; `docs/guidance/effect/api.md` names it) in `apps/api/src/services/<Name>.ts` with a namespaced key and a small interface of Effect-returning methods whose requirements are `never`. Failures a client can see are tagged errors in `packages/contract/src/errors.ts`, each with its `apiErrorTable` row; failures only the API sees stay in the API.
2. **Layers.** A `static readonly layer` built from an effectful `make`, yielding its dependencies and Config once in `make`. If it keeps state, add `static readonly layerMemory` with fresh state per build. New env vars go in `apps/api/src/config.ts`, `.env.example` and README.
3. **Wire it** into `AppLayer` and the test app helper in `apps/api/tests/helpers/`. A missing service shows up as a type error where the app layer is built.
4. **Tests** through the endpoints that use it, on its real `layer` where that's in-memory or on a local stub server where it calls a third party. `TestClock` for anything time-based.
5. `bun run check`.

Keep the interface free of its backing store, so a different store later is a new layer, not a new interface.
