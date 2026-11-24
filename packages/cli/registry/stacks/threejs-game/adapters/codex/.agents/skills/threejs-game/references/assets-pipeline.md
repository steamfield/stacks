# 3D asset pipeline: glTF, meshopt, KTX2

Models are binary glTF 2.0 (`.glb`), compressed with `@gltf-transform/cli` and loaded with `GLTFLoader` from `three/addons`. Agents can't make art: use primitives as placeholders, and take real models from the owner or CC0 packs, credited in `src/assets/CREDITS.md`.

## Optimizing a model

```sh
# One pass: dedup, prune, weld, simplify, resize textures, meshopt geometry, KTX2 textures.
bunx @gltf-transform/cli optimize in.glb src/assets/hero.glb --compress meshopt --texture-compress ktx2
bunx @gltf-transform/cli inspect src/assets/hero.glb   # sizes, vertex counts, texture formats
```

- Check the exact flags with `gltf-transform optimize -h` for the version you run before relying on them.
- KTX2 encoding shells out to KTX-Software (`toktx` or `ktx`), which must be installed. If it isn't, ask the owner rather than falling back to large PNGs silently.
- For finer control, run the individual commands: `etc1s` for color textures (small, lower quality), `uastc` for normal maps and other data textures (larger, much better quality), `meshopt` for geometry and animation, `resize` to cap texture size.
- Prefer meshopt to Draco. The meshopt decoder is small, needs no worker or separate WASM file, and also compresses animation and morph targets. Use Draco only for a model that's already Draco-compressed.
- Commit the optimized `.glb`, not the source `.blend` or `.fbx`, unless the owner wants sources in the repo.

## Importing so Vite hashes it

```ts
import heroGlb from "../assets/hero.glb?url"; // ?url: Vite doesn't treat .glb as an asset by default
```

Pass the URL to the loader. Don't put models in `public/`: files there keep fixed names, aren't checked by the build, and revalidate on every load.

## Loading

```ts
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const ktx2 = new KTX2Loader().detectSupport(renderer);
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);

let pendingLoads = 0;
async function loadModel(url: string): Promise<THREE.Group> {
  pendingLoads++;
  try {
    return (await gltfLoader.loadAsync(url)).scene;
  } catch (err) {
    ctx.reportError("gltf", err);
    throw err;
  } finally {
    pendingLoads--;
  }
}
// idle: () => physics !== null && !runtime.saving && pendingLoads === 0
```

- Create the loaders once, not per model. `KTX2Loader` starts a worker pool; call `ktx2.dispose()` on teardown.
- Load errors go to `ctx.reportError`, so `see` and e2e fail on them. `idle()` stays false while any load is pending, so `advance()` never ticks past a load.
- Clone loaded scenes for repeated placement (`SkeletonUtils.clone` from `three/addons/utils/SkeletonUtils.js` for skinned models). Clones share geometry and materials, so don't dispose them per clone.
- Cache by URL: loading the same model twice downloads and parses it twice.

### The Basis transcoder under Vite

`KTX2Loader` and `DRACOLoader` locate their WASM decoders with a URL relative to their own module, and Vite's dependency pre-bundling (`optimizeDeps` in `vite.config.ts` includes `three`) can break that kind of URL in the dev server. The first time the game loads a KTX2 texture, check both `bun run dev` and `bun run e2e` (the production build). If dev fails, the dependable fallback is:

```ts
// Copy node_modules/three/examples/jsm/libs/basis/ to public/basis/ (two files with fixed names)
ktx2.setTranscoderPath(`${import.meta.env.BASE_URL}basis/`);
```

`MeshoptDecoder` inlines its WASM in the module, so it needs no path.

## Textures loaded by hand

- `GLTFLoader` sets `colorSpace` on glTF textures. For textures you load yourself, set `colorSpace = THREE.SRGBColorSpace` on color and emissive maps and leave normal, roughness, metalness and AO maps at `NoColorSpace`.
- Use `KTX2Loader` for standalone textures, or `TextureLoader` with an imported WebP for small UI images.
- glTF textures aren't flipped (`flipY = false`). Keep that when swapping your own texture onto a glTF material.

## Animation

- One `AnimationMixer` per animated model. Advance it in the tick with `mixer.update(TICK_DT)` so animation lines up with logic ticks and repeats in `bun run see`.
- Crossfade between clips with `action.crossFadeTo(next, 0.15, false)`. Pick the clip from logic state (grounded, speed, attacking), never from input directly.
- Keep root motion out. Logic decides movement; strip root translation from clips (gltf-transform or the modeling tool) so animation and gameplay don't fight.

## Size check

A typical character `.glb` should be well under 1 MB after optimization. If one isn't, look for oversized textures in `gltf-transform inspect` first. `bun run build` prints each output file's size.
