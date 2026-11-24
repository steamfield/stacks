# three.js and Rapier in this project

three.js has no semver: APIs move in most releases, and most tutorials (and an agent's memory) describe older ones. Before using a three.js or Rapier API, check the installed release (`node_modules/three/package.json`, `node_modules/@dimforge/rapier3d-compat/package.json`) and confirm the name in `node_modules/three/src`, the `@types/three` declarations or Rapier's `.d.ts` files, or fetch current docs through Context7. The engine is pinned to an exact version in `package.json`; upgrading it is its own change, after reading the three.js migration guide for every release in between.

Render with `WebGLRenderer`. Don't import `three/webgpu` or `three/tsl` or use node materials: the smoke test asserts a `webgl2` renderer and the headless Chromium in CI renders WebGL through SwiftShader.

## How the engine fits the split

`src/engine/game.ts` (`startThree`) is the reference:

- One `FixedStep` drives everything that matters. Its tick reads input, runs `stepWorld` from `src/logic/`, then steps Rapier once. Logic and physics advance together.
- The `requestAnimationFrame` loop exists only outside test mode. In test mode the shell calls `advance(ticks)`, which ticks and then renders once.
- `render()` only reads: it syncs meshes from logic and physics state, moves the camera and draws.
- The canvas follows `ctx.container` through a `ResizeObserver`. The pixel ratio comes from `renderPixelRatio()` in `src/kit/shell.ts`, capped at 2. Don't size anything from `window`.
- `webglcontextlost` and physics load failures go to `ctx.reportError`. `renderer()` returns `webgl2` or `webgl`.
- Rapier loads after the first frame (`src/engine/physics.ts`). `idle()` is false until it's ready, so ticks never run without physics.

Rules that follow:

- Gameplay (rules, timers, spawns, pickups, health, score) lives in `src/logic/` with Vitest tests. three.js objects never hold the truth about gameplay.
- Nothing reads `performance.now()` or a `THREE.Timer` delta to move gameplay. Visual-only animation may use wall time; anything that affects state goes through ticks.
- Input comes from `src/engine/input.ts` inside the tick and enters logic as plain data (`TickInput`). No engine keyboard or pointer handlers for gameplay.
- Camera yaw that changes what "forward" means is gameplay input. If the player can turn the camera, logic owns the yaw and the engine renders from it.
- Effects (shake, particles, sounds) fire from drained logic events and keep their own state; see the `game-feel` skill.
- Keep `debugSummary()` small and add the fields new scenarios need. Round physics values.

## Renderer setup

```ts
const renderer = new THREE.WebGLRenderer({ antialias: renderPixelRatio() < 2 });
renderer.setPixelRatio(renderPixelRatio());
renderer.toneMapping = THREE.AgXToneMapping; // pick one deliberately for lit scenes
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// outputColorSpace already defaults to SRGBColorSpace; leave it.
```

- MSAA at a device pixel ratio of 2 costs a lot of fill rate on phones and adds little.
- Don't combine `setAnimationLoop` with a manual rAF loop. The shipped game uses rAF so `pause`, `resume` and test mode stay explicit.
- `renderer.info.render.calls` and `.triangles` are the numbers to watch; expose them in `debugSummary` while working on performance.

## API traps from older releases

Check each against the installed release before relying on it; this list covers renames that are already in place.

| From memory or an old tutorial | Now |
| --- | --- |
| `renderer.outputEncoding`, `texture.encoding`, `sRGBEncoding` | `renderer.outputColorSpace`, `texture.colorSpace`, `SRGBColorSpace` |
| `physicallyCorrectLights`, `useLegacyLights` | Gone; lighting is physical, and old intensity values come out roughly π times too dim |
| `THREE.Clock` | `THREE.Timer`: `timer.update(timestamp)` each frame, then `getDelta()` |
| `PCFSoftShadowMap` | Deprecated; use `PCFShadowMap` |
| `RGBELoader` | `HDRLoader` |
| `BufferGeometryUtils.mergeBufferGeometries` | `mergeGeometries` |
| `three/examples/js/...`, a global `THREE` | `import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"` |
| `Geometry`, `BoxBufferGeometry` | `BufferGeometry`, `BoxGeometry` |
| `KTX2Loader.detectSupportAsync` | `detectSupport(renderer)` |
| `FileLoader.load()` returning a value | Use the callback or `loadAsync` |
| `object.dispose()` freeing GPU memory | It only fires a `dispose` event; dispose geometries, materials and textures yourself |

## Scene graph

- Share geometry and materials: one geometry and one material for every crate, as `world-view.ts` does.
- More than a handful of the same mesh is an `InstancedMesh`; different meshes sharing a material can be a `BatchedMesh`; static level geometry is merged per material.
- No allocation in the tick, `render()` or the camera rig. Keep scratch vectors at module or class scope, as `CameraRig` does.
- `scene.remove(mesh)` frees nothing. Dispose geometries, materials and textures you no longer use, unless they're shared.
- HUD and menus are DOM elements in `ctx.container`, updated only when values change, and kept clear of the touch controls in the bottom corners.

## Rapier

Load it lazily (`await import("@dimforge/rapier3d-compat")`, then `RAPIER.init()`). Set `world.timestep = TICK_DT` and call `world.step()` exactly once per tick, never with frame time. Fixed bodies for the level, dynamic bodies for props, kinematic position-based bodies (or the character controller) for the player and moving platforms. Rapier objects are WASM handles: free the world on teardown. The compat build is deterministic on one machine but not across platforms, so scenarios assert physics positions with tolerances and the world hash leaves physics out.

## Phones

Starting targets for a mid-range phone, measured with `renderer.info` rather than headless frame rate: under about 100 draw calls, a few hundred thousand triangles in view, one shadow-casting directional light with a 1024 map fitted around the player (or blob shadows), KTX2 textures at 1024 px for most surfaces. Rapier is the largest download in the bundle, which is why it loads after first paint.

## Pitfalls

- Camera smoothing per rendered frame runs faster on 120 Hz screens and lags in test mode, where `advance(120)` renders once. Smooth per tick with `1 - Math.exp(-lambda * TICK_DT)`, as `CameraRig.tick` does.
- An `InstancedMesh` whose instances moved far gets culled wrongly; call `computeBoundingSphere()` after moving them.
- Hand-loaded color textures need `texture.colorSpace = THREE.SRGBColorSpace`; `GLTFLoader` sets it for glTF.
- Prefer `alphaTest` cutouts to blended transparency; set `depthWrite: false` on additive particles.
- Stepping Rapier from the render loop, or with a variable dt, makes runs diverge.

The `threejs-game` skill has the longer references: performance, the asset pipeline, physics and controls, and color and lighting.
