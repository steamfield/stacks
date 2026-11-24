# three.js performance on phones (WebGLRenderer)

The player is on a mid-range phone with a cold cache. Headless Chromium on a development machine says nothing about that, so optimize against counts (draw calls, triangles, texture memory, bytes downloaded), not headless frame rate.

## Measure first

```ts
// In debugSummary() while working on performance:
const { calls, triangles } = renderer.info.render;
const { geometries, textures } = renderer.info.memory;
return { ...runtime.summary(), draw: { calls, triangles, geometries, textures } };
```

- `renderer.info.render` resets at each `render()` (with the default `info.autoReset = true`), so read it right after rendering the view you care about.
- `info.memory.geometries` and `textures` count GPU resources still alive. If they grow each time a level loads or `loadState` runs, something isn't disposed.
- Capture a busy view with `bun run see --at <tick>` and read the numbers from the summary.

## Draw calls

Each mesh with its own material is at least one draw call, plus one per shadow-casting light that renders it into a shadow map. On phones the CPU cost of draw calls usually runs out before the GPU does.

| Situation | Use |
| --- | --- |
| Many copies of one mesh (coins, trees, bullets) | `InstancedMesh(geometry, material, maxCount)`; `setMatrixAt`, then `instanceMatrix.needsUpdate = true`; `setColorAt` for variety |
| Many different meshes sharing a material (level props) | `BatchedMesh`, or merge them offline |
| Static level geometry | `mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js`, per material, once at load |
| Many small textures | One atlas or a `DataArrayTexture`, so materials can be shared |

```ts
const orbGeometry = new THREE.SphereGeometry(0.3, 16, 12);
const orbMaterial = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x996600 });
const orbs = new THREE.InstancedMesh(orbGeometry, orbMaterial, ORB_COUNT);
const m = new THREE.Matrix4(); // scratch, reused

function syncOrbs(world: World) {
  world.orbs.forEach((o, i) => {
    const s = world.collected.has(i) ? 0 : 1; // hide by scaling to zero
    m.makeScale(s, s, s).setPosition(o.x, o.y, o.z);
    orbs.setMatrixAt(i, m);
  });
  orbs.instanceMatrix.needsUpdate = true;
  orbs.computeBoundingSphere(); // the cached sphere is otherwise stale
}
```

Call `computeBoundingSphere()` only when instances actually moved, not every frame.

## Reuse and disposal

- Create geometries, materials and textures once per kind and share them.
- On a level change or `loadState`, reuse the meshes (preferred) or dispose everything you created:

```ts
function disposeTree(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      for (const value of Object.values(mat)) if (value instanceof THREE.Texture) value.dispose();
      mat.dispose();
    }
  });
  root.removeFromParent();
}
```

Don't dispose resources other live objects still share. `Object3D.dispose()` frees nothing; it only dispatches an event.

- `material.clone()` per object for a color change defeats batching. Use instance colors, vertex colors or a small fixed set of materials.
- Setting `material.needsUpdate`, toggling `fog` or adding a light at runtime recompiles shaders and hitches. Create every material and light combination at load and hide what you don't need.

## Allocation and the loop

- No `new THREE.Vector3()` (or arrays or closures) in `render()`, the tick or the camera rig. Use scratch objects at module or class scope.
- `object.matrixAutoUpdate = false` plus a manual `updateMatrix()` for objects that never move after placement.
- Raycasting the whole scene each frame is slow. Raycast a short list of collision meshes, or use Rapier's queries (`castRay`, `castShape`), which use its broad phase.

## Textures

- GPU memory is width × height × 4 bytes uncompressed, plus about a third for mipmaps: a 2048² PNG costs about 21 MB of VRAM however small the file is. KTX2 (Basis) stays compressed on the GPU, at roughly a quarter to an eighth of that.
- Most surfaces at 1024 px or less; hero characters may use 2048 px.
- ETC1S for color and UASTC for normal maps (see assets-pipeline).
- `texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())` on ground textures seen at grazing angles; elsewhere leave it at 1.

## Shadows

Shadows are the most common reason a scene that's fine on desktop drops frames on a phone.

- One `DirectionalLight` casts shadows. Point lights render six shadow maps each; don't give them shadows.
- `shadow.mapSize.set(1024, 1024)`. Fit `shadow.camera` (left, right, top, bottom, near, far) tightly around the play area near the player, and move the light and its `target` with the player each tick.
- `castShadow` only on objects whose shadow helps (characters, props), `receiveShadow` only on the ground and large surfaces.
- For a static scene with a static light: `renderer.shadowMap.autoUpdate = false`, and set `renderer.shadowMap.needsUpdate = true` when something changes.
- On low-end devices, swap real shadows for blob shadows: a dark radial-gradient quad under each character with `depthWrite: false`, scaled by height above ground.
- Use `PCFShadowMap`; `PCFSoftShadowMap` is deprecated.

## Frustum culling and level of detail

- Culling is on per object and uses bounding spheres. A large merged mesh is culled as one unit, so split big levels into chunks (one room, one 20 m tile).
- Keep `camera.far` as small as the game allows. Fog hides the far plane and pop-in.
- `THREE.LOD` for distant props with many triangles; gltf-transform's `simplify` can produce the lower levels.

## Pixel ratio and resolution

- The shell caps DPR at 2 through `renderPixelRatio()`. A fill-bound scene on phones can render at 1.5 or 1 and let the browser upscale.
- Dynamic resolution, if added: measure average frame time over a second of real-time play (not in test mode) and step the ratio down or up with hysteresis. It's visual-only state in `engine/`.

## Post-processing

Each `EffectComposer` pass costs at least one full-screen pass. On phones, skip bloom and SSAO by default. Tone mapping and output color conversion already happen in the main pass without a composer. With a composer, `OutputPass` goes last so they're applied once.

## Budgets

Rough targets for a mid-range phone until the game has measured baselines: under about 100 draw calls, under about 300k triangles in view, under about 100 MB of texture memory, and Rapier deferred until after first paint. These are rules of thumb.
