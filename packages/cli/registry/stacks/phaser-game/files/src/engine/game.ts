/**
 * Wiring between the shell and Phaser: loads the save, builds the `Runtime` and the Phaser game
 * with its scenes, fits the canvas at integer zoom, reports WebGL context loss, and returns the
 * `GameHandle` the shell and tests drive. The scenes only render runtime state; game flow and
 * logic ticks live in `runtime.ts`.
 */
import Phaser from "phaser";
import type { SaveStore } from "../kit/save.ts";
import { type GameContext, type GameHandle, integerScale } from "../kit/shell.ts";
import { TILE } from "../logic/level.ts";
import type { SaveData } from "../logic/save.ts";
import { PHYSICS, summarize } from "../logic/world.ts";
import { debugState, debugSummary } from "./debug.ts";
import { Runtime, SAVE_SLOT, type SceneKey } from "./runtime.ts";
import { createPlaceholderTextures, Tex } from "./textures.ts";

const WIDTH = 320;
const HEIGHT = 180;

/** Draws the placeholder textures, then hands over to the runtime to pick the first screen. */
class BootScene extends Phaser.Scene {
  private readonly rt: Runtime;
  constructor(rt: Runtime) {
    super("boot");
    this.rt = rt;
  }
  create() {
    createPlaceholderTextures(this);
    this.rt.start();
  }
}

/** The game's title and the runtime's menu, with the cursor on the selected row. */
class TitleScene extends Phaser.Scene {
  private optionTexts: Phaser.GameObjects.Text[] = [];
  private shown = "";
  private readonly rt: Runtime;
  constructor(rt: Runtime) {
    super("title");
    this.rt = rt;
  }
  create() {
    this.rt.entered("title");
    this.add
      .text(WIDTH / 2, 50, this.rt.ctx.game.title.toUpperCase(), {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#ffd23f",
      })
      .setOrigin(0.5);
    this.optionTexts = this.rt.menu.options.map((label, i) =>
      this.add
        .text(WIDTH / 2, 100 + i * 18, label, { fontFamily: "monospace", fontSize: "12px" })
        .setOrigin(0.5),
    );
    this.shown = "";
  }
  override update() {
    const { menu } = this.rt;
    // setText re-rasterizes a canvas, so only touch the rows when the selection changes.
    const key = `${menu.selected}`;
    if (key === this.shown) return;
    this.shown = key;
    this.optionTexts.forEach((text, i) => {
      const label = menu.options[i] ?? "";
      text.setText(i === menu.selected ? `> ${label} <` : label);
    });
  }
}

/** The level, coins, flag and player drawn from the runtime's world, with a coin HUD. */
class PlayScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private coins: Phaser.GameObjects.Image[] = [];
  private hud!: Phaser.GameObjects.Text;
  private debug: Phaser.GameObjects.Graphics | null = null;
  private readonly rt: Runtime;
  constructor(rt: Runtime) {
    super("play");
    this.rt = rt;
  }
  create() {
    const world = this.rt.world;
    if (!world) {
      throw new Error("PlayScene started without a world: call Runtime.startPlay, not goTo(play)");
    }
    const { level } = world;
    level.solid.forEach((row, y) => {
      row.forEach((solid, x) => {
        if (solid) this.add.image(x * TILE, y * TILE, Tex.tile).setOrigin(0);
      });
    });
    this.coins = level.coins.map((c) =>
      this.add.image(c.x * TILE + TILE / 2, c.y * TILE + TILE / 2, Tex.coin),
    );
    this.add.image(level.goal.x * TILE, level.goal.y * TILE, Tex.goal).setOrigin(0);
    this.player = this.add.image(0, 0, Tex.player).setOrigin(0);
    this.hud = this.add
      .text(6, 6, "", { fontFamily: "monospace", fontSize: "10px" })
      .setScrollFactor(0);
    this.cameras.main
      .setBounds(0, 0, level.width * TILE, level.height * TILE)
      .startFollow(this.player, true);
    this.debug = this.rt.ctx.params.debug ? this.add.graphics() : null;
    this.sync();
    this.rt.entered("play");
  }
  override update() {
    this.sync();
  }
  private sync() {
    const world = this.rt.world;
    if (!world) return;
    this.player.setPosition(Math.round(world.player.x), Math.round(world.player.y));
    this.coins.forEach((coin, i) => {
      coin.setVisible(!world.collected.has(i));
    });
    const summary = summarize(world);
    let hud =
      world.status === "won"
        ? `Level complete! ${summary.coins}  (A: title)`
        : `Coins ${summary.coins}`;
    if (this.debug) {
      const { x, y } = world.player;
      this.debug.clear().lineStyle(1, 0xff00ff).strokeRect(x, y, PHYSICS.width, PHYSICS.height);
      hud += `\ntick ${world.tick} tile ${summary.player.tile.join(",")}`;
    }
    if (this.hud.text !== hud) this.hud.setText(hud);
  }
}

/** Starts the game inside `ctx.container` and returns the handle the shell drives. */
export async function startPhaser(
  ctx: GameContext,
  saves: SaveStore<SaveData>,
): Promise<GameHandle> {
  const save = await loadSave(ctx, saves);
  let game: Phaser.Game | null = null;
  const rt = new Runtime({
    ctx,
    saves,
    save,
    search: window.location.search,
    startScene: (scene) => {
      if (game) switchScene(game, scene);
    },
  });
  game = createPhaserGame(ctx, rt);
  watchGame(ctx, game, rt);
  return createHandle(rt, game, saves);
}

/** The saved game, or null when there is none or it can't be read (never overwritten then). */
async function loadSave(ctx: GameContext, saves: SaveStore<SaveData>): Promise<SaveData | null> {
  const loaded = await saves.load(SAVE_SLOT);
  if (loaded.kind === "unreadable" || loaded.kind === "newer-than-code") {
    ctx.notice("Your saved progress could not be loaded, so it will not be overwritten.");
  } else if (saves.status === "memory-only") {
    ctx.notice("Progress will not be saved in this browser mode.");
  }
  return loaded.kind === "ok" ? loaded.data : null;
}

function createPhaserGame(ctx: GameContext, rt: Runtime): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: ctx.container,
    width: WIDTH,
    height: HEIGHT,
    pixelArt: true,
    backgroundColor: "#1d2b53",
    banner: false,
    scale: { mode: Phaser.Scale.NONE },
    scene: [new BootScene(rt), new TitleScene(rt), new PlayScene(rt)],
  });
}

function switchScene(game: Phaser.Game, scene: SceneKey): void {
  // stop() is queued but start() of a running scene restarts it at once; stopping the target too
  // would let the queued stop land after the restart and leave it blank.
  for (const running of game.scene.getScenes(true)) {
    if (running.scene.key !== scene) running.scene.stop();
  }
  game.scene.start(scene);
}

/**
 * Feeds the logic clock once per game step (not per scene, so a scene switch mid-step can't tick
 * twice), fits the canvas to the container at integer zoom, and reports WebGL context loss.
 */
function watchGame(ctx: GameContext, game: Phaser.Game, rt: Runtime): void {
  game.events.on(Phaser.Core.Events.STEP, (_time: number, deltaMs: number) => rt.frame(deltaMs));
  const fitToContainer = () => game.scale.setZoom(integerScale(WIDTH, HEIGHT, ctx.container));
  new ResizeObserver(fitToContainer).observe(ctx.container);
  game.events.once(Phaser.Core.Events.READY, () => {
    fitToContainer();
    game.canvas.addEventListener("webglcontextlost", () =>
      ctx.reportError("webgl", "WebGL context lost"),
    );
  });
}

function rendererName(game: Phaser.Game): string {
  if (!game.renderer) return "none";
  return game.renderer.type === Phaser.WEBGL ? "webgl" : "canvas";
}

function createHandle(rt: Runtime, game: Phaser.Game, saves: SaveStore<SaveData>): GameHandle {
  const idle = () => game.isBooted && !rt.loading && !rt.saving;
  return {
    events: rt.events,
    idle,
    advance(ticks) {
      let ran = 0;
      while (ran < ticks && idle()) {
        rt.step.advance(1);
        ran++;
      }
      return ran;
    },
    renderer: () => rendererName(game),
    debugSummary: () => debugSummary(rt, saves.status),
    debugState: () => debugState(rt),
    async loadState(fixture) {
      const imported = await saves.importJson(SAVE_SLOT, JSON.stringify(fixture));
      if (imported.kind !== "ok") {
        throw new Error(`Save fixture rejected by the save store: ${JSON.stringify(imported)}`);
      }
      rt.loadSave(imported.data);
    },
    pause: () => game.loop.sleep(),
    resume: () => game.loop.wake(),
    onHide: () => rt.hide(),
  };
}
