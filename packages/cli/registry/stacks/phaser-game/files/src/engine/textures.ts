/**
 * Placeholder art drawn at boot, so gameplay can be built and tested before real sprites exist.
 * Replace a texture by loading an imported image under the same key in a scene's preload().
 */
import type Phaser from "phaser";

/** Texture keys. Use these, never string literals, so a typo fails typecheck. */
export const Tex = {
  player: "player",
  tile: "tile",
  coin: "coin",
  goal: "goal",
} as const;

export function createPlaceholderTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  const make = (key: string, w: number, h: number, draw: () => void) => {
    g.clear();
    draw();
    g.generateTexture(key, w, h);
  };
  make(Tex.player, 10, 14, () => {
    g.fillStyle(0x4fc3f7).fillRect(0, 0, 10, 14);
    g.fillStyle(0x0d47a1).fillRect(6, 3, 2, 3);
  });
  make(Tex.tile, 16, 16, () => {
    g.fillStyle(0x6d4c41).fillRect(0, 0, 16, 16);
    g.fillStyle(0x8bc34a).fillRect(0, 0, 16, 3);
  });
  make(Tex.coin, 8, 8, () => {
    g.fillStyle(0xffd23f).fillCircle(4, 4, 4);
  });
  make(Tex.goal, 16, 16, () => {
    g.fillStyle(0xeeeeee).fillRect(2, 0, 2, 16);
    g.fillStyle(0xe53935).fillTriangle(4, 1, 14, 4, 4, 7);
  });
  g.destroy();
}
