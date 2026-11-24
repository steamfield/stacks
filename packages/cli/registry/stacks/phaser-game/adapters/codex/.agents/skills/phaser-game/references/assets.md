# Phaser assets

How to get images, atlases, maps, audio and fonts into the game so they are hashed, build-checked, typed and testable. Check loader signatures against the installed `phaser.d.ts`, and read the loading-assets and tilemaps skills in `node_modules/phaser/skills/` if that folder exists.

## Import, don't path

```ts
// src/engine/assets.ts
import tilesPng from "../assets/tiles.png";
import heroPng from "../assets/hero.png";
import heroJson from "../assets/hero.json?url"; // ?url: a hashed file, not JSON parsed into the bundle
import level1Url from "../assets/level-1.tmj?url";
import jumpSfx from "../assets/sfx/jump.m4a";

export const Tex = { tiles: "tiles", hero: "hero" } as const;
export const Maps = { level1: "level-1" } as const;
export const Sfx = { jump: "jump" } as const;

export function loadPlayAssets(scene: Phaser.Scene): void {
  scene.load.image(Tex.tiles, tilesPng);
  scene.load.atlas(Tex.hero, heroPng, heroJson);
  scene.load.tilemapTiledJSON(Maps.level1, level1Url);
  scene.load.audio(Sfx.jump, jumpSfx);
}
```

- Images and audio import as URLs by default. JSON, `.tmj`, `.fnt`/`.xml` and anything else that should stay a separate file needs `?url`. Without it, Vite inlines JSON into the JavaScript bundle.
- Vite inlines assets under 4 KB as `data:` URIs. Phaser's loader accepts `data:` URLs, so this is fine.
- Don't use `public/` for game assets. Those files keep fixed names, aren't build-checked, and revalidate on every load.
- Record every third-party asset's source and license in `src/assets/CREDITS.md`.
- Keep the key consts next to the imports. A typo in a key is then a type error, not a missing texture at runtime.

## Atlases and sprite sheets

- One atlas per scene or per character family, rather than dozens of single images. Fewer textures means fewer batch breaks and fewer requests.
- Packing tools: TexturePacker (paid), free-tex-packer, or Aseprite's own export. Use JSON Hash or JSON Array output; Phaser's `load.atlas` reads both. Ignore the `image` field inside the JSON, since the PNG URL is passed separately.
- Aseprite: export the sheet as "JSON Array" with tags, load with `this.load.aseprite(key, png, json)`, then call `this.anims.createFromAseprite(key)` once in the boot scene. Tag names become animation keys, so add them to a typed const too.
- `load.spritesheet` is for fixed-size grids referenced by frame index. Use atlases with named frames for anything else.
- Pixel art: enable 1-2 px extrude (or padding with border repeat) in the packer, or neighbours bleed at some zoom levels.
- Compressed textures made for an older Phaser major may need re-encoding; check the installed version's notes. Plain PNG and WebP need nothing.

## Tiled maps

The shipped game uses ASCII levels parsed in `src/logic/level.ts`, which agents read and write reliably. Switch to Tiled when levels need art layers, object placement or more than a screen or two.

Keep logic engine-free by passing the parsed JSON in, not by importing Phaser into logic:

```ts
// src/logic/tiled.ts: plain TypeScript, validated with zod, unit tested with fixture JSON
export function levelFromTiled(json: unknown): Level { /* read the "collision" layer and the "spawns" object layer */ }

// src/engine/play-scene.ts
create() {
  const map = this.make.tilemap({ key: Maps.level1 });
  const tiles = map.addTilesetImage("tiles", Tex.tiles); // first argument: the tileset name inside Tiled
  if (!tiles) throw new Error('Tileset "tiles" not found in level-1.tmj');
  map.createLayer("ground", tiles, 0, 0);
  // The tilemap cache holds { format, data }; data is the raw Tiled JSON.
  const level = levelFromTiled(this.cache.tilemap.get(Maps.level1).data);
  // hand `level` to createWorld; logic does collision from it, Phaser only draws
}
```

Tiled rules (most fail with a `null` and a console warning, not an error):

- Embed tilesets in the map (Map > Embed Tileset). External `.tsx` tilesets and "Collection of Images" tilesets aren't supported.
- Tileset names and layer names must match the strings in code exactly. Group layers flatten to `Group/Layer`.
- Mark collision with a dedicated layer or a tile property (`collides: true`) that logic reads. Don't rely on Arcade's `setCollisionByProperty` unless you've chosen engine-side physics on purpose.
- Use object layers for spawns, pickups, triggers and doors. Give objects a type or class and custom properties, and have logic validate them with zod so a bad map fails with a clear message.
- Unit tests can read the same `.tmj` with `readFileSync` and call `levelFromTiled`, so collision and spawn parsing is covered without a browser.

## Audio

- One compressed format per sound. AAC in `.m4a` and MP3 both decode through Web Audio in current Chromium, Firefox and Safari. Don't ship Ogg-only audio; Safari's Ogg support through `decodeAudioData` has been unreliable.
- Short sound effects: mono, trimmed, 44.1 or 48 kHz. Several small ones can share one audio sprite (`load.audioSprite`).
- Music: Web Audio decodes the whole file into memory. Keep loops short (about 1-2 MB) and load music after the first scene is playable, not before the title.
- Respect a volume or mute setting stored in the save (see `game-feel`), and set `this.sound.mute` and `volume` from it at boot.
- Register `game.sound.context` with `ctx.registerAudioContext` (SKILL.md section 4). The shell resumes registered contexts on the player's first gesture.

## Fonts

- Pixel fonts: `BitmapText`. Load with `this.load.bitmapFont(key, pngUrl, fntOrXmlUrl)` from imported URLs. It's cheap to update every frame, unlike `Text`.
- Web fonts for `Text`: import the font file URL, register it with the `FontFace` API, and await `document.fonts.load('16px "Name"')` before the scene that uses it creates text. Phaser doesn't load web fonts and draws a fallback if the font isn't ready.
- Font names with spaces or digits need inner quotes: `fontFamily: '"Press Start 2P"'`.

## Load-time budget

Aim for under 5 s to interactive on a mid-range phone with a cold cache. Phaser itself is most of the shipped bundle; `bun run build` prints the size of each file in `dist/`. Budget the rest:

- Title screen assets only before the title. Everything else loads per scene.
- Prefer WebP or optimized PNG for art (pngquant or oxipng for pixel art; lossless WebP also works).
- Check the sizes `bun run build` reports after adding assets.
