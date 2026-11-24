---
name: threejs-game
description: Build, extend or review this three.js and Rapier 3D game. Use when writing or changing the renderer setup, scene graph, meshes, materials, lighting, shadows, glTF or KTX2 assets, instancing, the camera rig, the character controller or Rapier physics, or when a three.js API from memory might be out of date. Covers how three.js fits the logic and engine split and the shell's test mode, API traps from older releases, performance rules for phones, and a review checklist.
---

# three.js and Rapier in this game

three.js has no semver: APIs move in most releases, and most tutorials and most of your memory describe older ones. Before using an API, check the installed release (`node_modules/three/package.json`, `node_modules/@dimforge/rapier3d-compat/package.json`) and confirm the name in `node_modules/three/src`, the `@types/three` declarations or Rapier's `.d.ts` files, or fetch current docs through Context7. The engine version is pinned exactly in `package.json`; an upgrade is its own change, made after reading the three.js migration guide for each release in between.

Use `WebGLRenderer` only. No `three/webgpu`, no `three/tsl`, no node materials.

For the change, check and capture loop, use the `verify-game` skill. For feel, juice, accessibility and mobile, use `game-feel`. Depth is in the references:

- [references/performance.md](references/performance.md): draw calls, instancing, reuse and disposal, textures, shadows, budgets, measuring.
- [references/assets-pipeline.md](references/assets-pipeline.md): glTF, gltf-transform, meshopt, KTX2, Vite imports.
- [references/physics-and-controls.md](references/physics-and-controls.md): Rapier, the character controller, the camera rig, interpolation.
- [references/look.md](references/look.md): color management, tone mapping, lighting that looks good cheaply.

## 1. How three.js fits this game

`src/engine/game.ts` (`startThree`) is the reference:

- One `FixedStep` drives everything that matters. `Runtime` runs the tick: input, then `stepWorld` from `src/logic/`, then `afterTick`, which steps Rapier and syncs the view. Logic and Rapier advance together, one tick at a time.
- The game's own rAF loop runs only outside test mode (`let running = !ctx.params.testMode`). In test mode the shell calls `advance(ticks)`, which runs the ticks and then renders once.
- `render()` never changes logic. It syncs meshes from logic and physics state, moves the camera and draws.
- The canvas follows `ctx.container`. A `ResizeObserver` calls `renderer.setSize` and updates the camera aspect. The pixel ratio comes from `renderPixelRatio()` in `src/kit/shell.ts`, capped at 2.
- Failures are reported: `webglcontextlost` and physics load errors go to `ctx.reportError`. `renderer()` returns `webgl2` or `webgl` so smoke can assert it.
- Rapier loads after the first frame. `idle()` is false until it's ready, so `advance()` waits and ticks never run without physics.

Rules that follow from it:

- Gameplay rules, timers, spawns, pickups, health and score are in `src/logic/` with Vitest tests. three.js objects never hold the truth about gameplay.
- Nothing reads `performance.now()` or `timer.getDelta()` to move gameplay. Visual-only animation (an orb bobbing) may use wall time; anything that affects collision or state goes through ticks.
- Purely cosmetic randomness in `engine/` uses its own `createRng`, so `bun run see` frames repeat.
- Input comes from `src/engine/input.ts` inside the tick and enters logic as plain data (`TickInput`).
- Camera yaw that changes what "forward" means is gameplay input. If the player can turn the camera, logic owns the yaw and the engine renders from it. See the physics-and-controls reference.

## 2. API traps from older releases

Confirm each against the installed release; these renames are already in place.

| From memory or an old tutorial | Now |
| --- | --- |
| `renderer.outputEncoding = sRGBEncoding`, `texture.encoding` | `renderer.outputColorSpace` (default `SRGBColorSpace`), `texture.colorSpace` |
| `physicallyCorrectLights`, `useLegacyLights` | Gone. Lighting is physical; old intensity values come out roughly π times too dim |
| `THREE.Clock` | `THREE.Timer`: `timer.update(timestamp)` each frame, then `getDelta()` |
| `PCFSoftShadowMap` | Deprecated; WebGL falls back to `PCFShadowMap` |
| `RGBELoader` | `HDRLoader` |
| `BufferGeometryUtils.mergeBufferGeometries` | `mergeGeometries` |
| `three/examples/js/...`, global `THREE` add-ons | `import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"` |
| `Geometry`, `BoxBufferGeometry` | `BufferGeometry`, `BoxGeometry` |
| `KTX2Loader.detectSupportAsync` | `detectSupport(renderer)` |
| `FileLoader.load()` return value | Returns nothing; use the callback or `loadAsync` |
| `object.dispose()` frees GPU memory | `Object3D.dispose()` only fires a `dispose` event. Dispose geometries, materials and textures yourself |
| ACES output matching older screenshots | The ACES Filmic fit was corrected, so ACES scenes look slightly different from older captures |

## 3. Renderer setup

```ts
const renderer = new THREE.WebGLRenderer({ antialias: renderPixelRatio() < 2 });
renderer.setPixelRatio(renderPixelRatio());
renderer.toneMapping = THREE.AgXToneMapping; // or ACESFilmic or Neutral, see references/look.md
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// outputColorSpace is already SRGBColorSpace; don't change it.
```

- MSAA at a device pixel ratio of 2 costs a lot of fill rate on phones and adds little. The game keeps `antialias: true`; a fill-bound game should drop it at DPR 2.
- Don't use `setAnimationLoop` and a manual rAF loop together. The game uses rAF so `pause`, `resume` and test mode stay explicit.
- `renderer.info.render.calls` and `.triangles` are the numbers to budget. Expose them in `debugSummary` while working on performance.

## 4. Scene graph rules

- Share geometry and materials: one geometry and one material for every crate, as `world-view.ts` does.
- Repeated objects are instanced: more than a handful of the same mesh means `InstancedMesh`, or `BatchedMesh` for different geometries with one material. Hide an instance by scaling it to zero or by swapping it with the last one and reducing `count`.
- Static level geometry is merged per material with `mergeGeometries`, or exported merged from the asset pipeline.
- No allocation in the frame or tick loop. Keep scratch `Vector3`, `Quaternion` and `Matrix4` at module or class scope, as `CameraRig` does.
- `scene.remove(mesh)` frees nothing. Call `geometry.dispose()`, `material.dispose()` and each texture's `dispose()` unless they're shared and still in use.
- Logic state flows to meshes one way. `WorldView.sync()` copies positions from logic and physics; meshes never write back.
- HUD is DOM, not WebGL text. Append HUD and menus to `ctx.container`, as the game does with its loading label, update them only when values change, and keep them clear of the touch controls in the bottom corners.

## 5. Rapier in one paragraph

Load it lazily (`await import("@dimforge/rapier3d-compat")`, then `RAPIER.init()`), as `src/engine/physics.ts` does. Set `world.timestep = TICK_DT` and call `world.step()` exactly once per tick, never with frame time. Fixed bodies for the level, dynamic bodies for props, kinematic position-based bodies (or the `KinematicCharacterController`) for the player and moving platforms. Rapier objects are WASM handles: free the world on teardown. The compat build is deterministic on one machine but not across platforms, so scenarios assert physics positions with tolerances. Details and the controller pattern are in the physics-and-controls reference.

## 6. Assets in one paragraph

Models are binary glTF (`.glb`) run through `@gltf-transform/cli` with meshopt geometry compression and KTX2 textures, imported with `?url` so Vite hashes them, and loaded with `GLTFLoader` plus `MeshoptDecoder` and `KTX2Loader`. Load errors go to `ctx.reportError`, and `idle()` stays false until loads resolve. Details are in the assets-pipeline reference.

## 7. Performance targets for phones

Starting points, measured with `renderer.info` rather than headless frame rate:

- Draw calls under about 100 on mobile; a few hundred thousand triangles at most.
- One shadow-casting directional light with a 1024 map fitted tightly around the player, or blob shadows on mobile.
- KTX2 textures, at most 1024 px for most surfaces and 2048 px only for hero assets.
- Pixel ratio capped at 2 (the shell does this). Consider a lower internal ratio when frame time is high.
- Rapier's compat build inlines its WASM as base64 and is the largest download in the bundle, which is why it loads after first paint.

## 8. Pitfalls seen in practice

- Camera smoothing per rendered frame: `camera.position.lerp(target, 0.15)` per render runs faster on 120 Hz screens and lags in test mode, where `advance(120)` renders once. Smooth per tick with `1 - Math.exp(-lambda * TICK_DT)`, as `CameraRig.tick` does.
- `InstancedMesh` culled wrongly after moving instances: its bounding sphere is computed once. Call `computeBoundingSphere()` after moving instances far, or set `frustumCulled = false` on small sets.
- Skinned meshes vanish at screen edges because their bounding sphere comes from the first pose. Recompute it after posing, enlarge it, or turn off culling for that mesh.
- Color maps look washed out or too dark: a hand-loaded color texture is missing `texture.colorSpace = THREE.SRGBColorSpace`. `GLTFLoader` sets it itself.
- Transparent sorting artifacts from foliage and particles: prefer `alphaTest` cutouts, and set `depthWrite: false` on additive particles.
- Shadow acne or peter-panning: tune `shadow.bias` and `shadow.normalBias` together and keep the shadow camera tight.
- Stepping Rapier from the render loop or with a variable dt makes runs diverge. Only the fixed step steps it.

## 9. Checklist before handing back

- [ ] Gameplay lives in `src/logic/` with Vitest coverage; `engine/` only renders, forwards input and runs physics inside the tick.
- [ ] The rAF loop doesn't run in test mode; `advance()` renders once after its ticks; `idle()` covers physics and asset loads.
- [ ] No outdated APIs from section 2; `bun run typecheck` passes against the installed `@types/three`.
- [ ] Geometry and materials are shared, repeated meshes are instanced, removed objects are disposed.
- [ ] No per-frame allocations in `render()`, the tick or the camera rig.
- [ ] Assets are compressed glTF and KTX2, imported with `?url`, with load errors routed to `ctx.reportError`.
- [ ] Draw calls and triangles checked in `debugSummary` or `renderer.info` for a busy view.
- [ ] Camera motion is frame-rate independent and repeats in `bun run see`.
- [ ] The tests covering your files, `bun run typecheck` and `bun run lint` pass, `bun run see` (desktop and `--mobile`) looks right, and `bun run e2e` passes before handing back.
