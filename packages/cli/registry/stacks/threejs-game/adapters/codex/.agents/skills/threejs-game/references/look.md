# Color, tone mapping and cheap lighting (WebGLRenderer)

## Color management, in four rules

1. `ColorManagement.enabled` is true and `renderer.outputColorSpace` is `SRGBColorSpace` by default. Leave both alone.
2. Hex colors in code (`new THREE.Color(0x4fc3f7)`, `color: 0xffd23f` on materials) are read as sRGB and converted to linear for lighting. Pick colors as you see them in a color picker.
3. Textures with color data (base color, emissive, sprites, UI) need `texture.colorSpace = THREE.SRGBColorSpace`. Data textures (normal, roughness, metalness, AO, height) keep `NoColorSpace`. `GLTFLoader` does this for glTF materials.
4. Don't add gamma correction by hand (no `pow(c, 1/2.2)` in shaders, no `GammaCorrectionShader`). With `EffectComposer`, end with `OutputPass`, which applies tone mapping and the sRGB conversion once.

Symptoms: everything washed out means an sRGB conversion happened twice, or a color texture is missing its `colorSpace`. Dark, muddy and over-contrasty means a color texture was treated as linear.

## Tone mapping

The shipped game renders with `NoToneMapping`. A game with lit PBR materials should choose one deliberately:

| Constant | Character | Good for |
| --- | --- | --- |
| `AgXToneMapping` | Desaturates very bright highlights gracefully, little hue shift | Scenes with bright lights, emissives and sky; a safe default for lit scenes |
| `ACESFilmicToneMapping` | Punchy contrast; shifts saturated hues (bright reds go orange, blues go purple) | A filmic look, if the art is tuned under it |
| `NeutralToneMapping` | Khronos PBR Neutral; keeps base colors close to their authored values | Stylized, flat-colored art where the palette must survive |
| `NoToneMapping` | Clips at 1.0 | Unlit or toon materials, where you control output directly |

- Set it once on the renderer (`renderer.toneMapping`) and tune `toneMappingExposure` (start at 1). Materials opt out with `toneMapped: false`, which suits UI-like meshes and markers that must show their exact color.
- Tone mapping applies when rendering to the screen. When rendering to a render target, `OutputPass` applies it instead.
- Changing tone mapping changes every color in the game. Decide early, then check the palette with `bun run see` captures.

## Lighting that looks good cheaply

```ts
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // image-based light, one-time cost
pmrem.dispose();

scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a3b2a, 0.6)); // sky and ground bounce
const sun = new THREE.DirectionalLight(0xfff1d6, 2.5);
sun.position.set(6, 12, 4);
sun.castShadow = true;
scene.add(sun, sun.target);
scene.fog = new THREE.Fog(0x87b5e5, 25, 60); // match the background color
```

- One key light and one fill. A warm directional key and a cool hemisphere fill give readable form and color contrast. A third light rarely helps and costs every fragment.
- An environment map for PBR. Metal and glossy materials look flat and black without one. `RoomEnvironment` through `PMREMGenerator` needs no download. An HDR (`HDRLoader`) looks more specific but costs bytes. Scale its contribution with `scene.environmentIntensity`.
- Bake what doesn't move. Lightmaps or vertex colors baked in the modeling tool, on `MeshLambertMaterial` or `MeshBasicMaterial`, cost almost nothing at runtime.
- Material choice is a cost choice: `MeshBasicMaterial` < `MeshLambertMaterial` < `MeshPhongMaterial` < `MeshStandardMaterial` < `MeshPhysicalMaterial`. Standard for hero objects, Lambert or Basic for distant or numerous ones. Physical features (clearcoat, transmission) are expensive on phones.
- Toon look: `MeshToonMaterial` with a 3 to 5 step `gradientMap` (`NearestFilter`) plus an inverted-hull outline (a back-face clone, slightly scaled, in a dark `MeshBasicMaterial`) is cheap. Outline post-process passes cost more.
- Readability beats realism. Silhouettes should read against the background: fog-colored rims, a darker ground, saturated player and pickup colors against muted scenery. Check a capture in grayscale.

## Light intensity units

Lighting is physical: `PointLight` and `SpotLight` intensity is in candela with inverse-square falloff (`decay = 2`), and `DirectionalLight` has no falloff. Values from old tutorials (0.5 to 1 for a point light) come out very dim. Tune by looking at `bun run see` captures, not by copying numbers.
