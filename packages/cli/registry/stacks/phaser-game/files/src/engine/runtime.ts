/**
 * The state the scenes share and the only place logic ticks. `Runtime` owns the event log, the
 * fixed step, the current scene, the title menu, the world and the save, and queues save writes.
 * It never imports Phaser: it asks for scene switches through `startScene`, and scenes call
 * `entered` once they are built. That keeps the whole game flow testable in Vitest.
 *
 * Screens: boot, then title (Continue when the save has progress, and New game), then play. Jump
 * on the finished level goes back to the title.
 */
import { createLogger, EventLog, FixedStep, type Logger } from "../kit/core/index.ts";
import type { SaveStore } from "../kit/save.ts";
import type { GameContext } from "../kit/shell.ts";
import type { GameEvent } from "../logic/events.ts";
import { LEVEL_1, parseLevel } from "../logic/level.ts";
import { NEW_GAME, type SaveData } from "../logic/save.ts";
import { createWorld, stepWorld, toSave, type World } from "../logic/world.ts";
import { applyStage, stageFor } from "./capture-stages.ts";
import { input } from "./input.ts";

/** Phaser scene keys, one per screen. */
export type SceneKey = "boot" | "title" | "play";

/** Events the engine adds on top of the world's. */
export type EngineEvent =
  | { type: "scene.started"; scene: SceneKey }
  | { type: "menu.selected"; option: MenuOption }
  | { type: "save.written" }
  | { type: "save.failed"; reason: string };

/** Everything that can appear in the runtime's event log. */
export type RuntimeEvent = GameEvent | EngineEvent;

/** A title menu row. */
export type MenuOption = "Continue" | "New game";

/** The title menu: the rows it shows and the one under the cursor. */
export interface Menu {
  options: MenuOption[];
  selected: number;
}

/** What the runtime needs from the outside: the shell context, saves and a scene switcher. */
export interface RuntimeOptions {
  ctx: GameContext;
  saves: SaveStore<SaveData>;
  /** The loaded save, or null when there is none or it could not be read. */
  save: SaveData | null;
  /** Stops the running scenes and starts `scene`. Phaser switches; the runtime only asks. */
  startScene(scene: SceneKey): void;
  /** The page's query string (`location.search`), read for `?stage=`. Empty when there is none. */
  search?: string;
}

/** The one save slot the game uses. */
export const SAVE_SLOT = "main";

/** Shared engine state. Logic changes only inside the FixedStep callback. */
export class Runtime {
  readonly events = new EventLog<RuntimeEvent>();
  readonly step = new FixedStep((dt) => this.tick(dt));
  scene: SceneKey = "boot";
  /** True between asking for a scene and that scene's create(); ticks wait while it is set. */
  loading = true;
  world: World | null = null;
  save: SaveData | null;
  menu: Menu = { options: [], selected: 0 };
  /** True when the current run was put in place by `?stage=`; it is never saved. */
  staged = false;
  readonly ctx: GameContext;

  private readonly saves: SaveStore<SaveData>;
  private readonly startScene: (scene: SceneKey) => void;
  private readonly search: string;
  private readonly log: Logger;
  /** Save writes asked for and not yet settled. */
  private writesPending = 0;
  /** Where the write queue ends: each write starts once the one before it has settled. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: RuntimeOptions) {
    this.ctx = options.ctx;
    this.saves = options.saves;
    this.save = options.save;
    this.startScene = options.startScene;
    this.search = options.search ?? "";
    this.log = createLogger(options.ctx.game.id);
  }

  /** True while any save write is queued or running. The test harness waits on it through idle(). */
  get saving(): boolean {
    return this.writesPending > 0;
  }

  /** Leaves boot for `?scene=`: `play` continues the save, anything else opens the title. */
  start(): void {
    if (this.ctx.params.scene === "play") this.startPlay(this.save ?? NEW_GAME);
    else this.goTo("title");
  }

  /** Feeds one game step's wall time to the fixed step. In test mode the shell calls advance(). */
  frame(deltaMs: number): void {
    if (!this.ctx.params.testMode) this.step.frame(deltaMs / 1000);
  }

  /** Switches scenes. Ticks pause until the new scene calls `entered`. */
  goTo(scene: SceneKey): void {
    this.loading = true;
    this.startScene(scene);
  }

  /** Called from a scene's create() once it is ready. The title builds its menu from the save. */
  entered(scene: SceneKey): void {
    this.scene = scene;
    this.loading = false;
    if (scene === "title") this.menu = { options: titleOptions(this.save), selected: 0 };
    this.events.emit({ type: "scene.started", scene });
  }

  /** Builds the level's world from `save`, applies any `?stage=`, and starts the play scene. */
  startPlay(save: SaveData): void {
    this.world = createWorld(parseLevel(LEVEL_1), this.events, save);
    const stage = stageFor(this.ctx.params, this.search, this.log);
    if (stage) applyStage(this.world, stage);
    this.staged = stage !== null;
    this.goTo("play");
  }

  /** Makes `data` the current save and plays from it, as when a save fixture is loaded. */
  loadSave(data: SaveData): void {
    this.save = data;
    this.startPlay(data);
  }

  /** The tab was hidden: write the run in play now, since this may be the last chance on mobile. */
  hide(): Promise<void> | undefined {
    return this.scene === "play" ? this.persist() : undefined;
  }

  /**
   * Queues a write of the world's progress, emitting `save.written` or `save.failed`. Writes run
   * one at a time in the order asked for, so a slow older write can't land after a newer one. A
   * failed write is warned about and becomes `save.failed`; play carries on either way, so the
   * promise never rejects. A staged run is never written.
   */
  persist(): Promise<void> {
    if (!this.world || this.staged) return this.writeQueue;
    const data = toSave(this.world);
    this.writesPending++;
    this.writeQueue = this.writeQueue.then(() => this.write(data));
    return this.writeQueue;
  }

  private async write(data: SaveData): Promise<void> {
    try {
      const outcome = await this.saves.save(SAVE_SLOT, data);
      if (outcome.ok) {
        this.save = data;
        this.events.emit({ type: "save.written" });
      } else {
        this.failWrite(outcome.reason);
      }
    } catch (error) {
      this.failWrite(error instanceof Error ? error.message : String(error));
    } finally {
      this.writesPending--;
    }
  }

  private failWrite(reason: string): void {
    this.log.warn(`progress not saved: ${reason}`);
    this.events.emit({ type: "save.failed", reason });
  }

  private tick(dt: number): void {
    if (this.loading) return;
    this.events.tick = this.step.tick;
    input.update();
    if (this.scene === "title") this.tickTitle();
    else if (this.scene === "play") this.tickPlay(dt);
  }

  private tickTitle(): void {
    const { menu } = this;
    const rows = menu.options.length;
    if (input.justPressed("down")) menu.selected = (menu.selected + 1) % rows;
    if (input.justPressed("up")) menu.selected = (menu.selected + rows - 1) % rows;
    if (!input.justPressed("jump")) return;
    const option = menu.options[menu.selected] ?? "New game";
    this.events.emit({ type: "menu.selected", option });
    this.startPlay(option === "Continue" && this.save ? this.save : NEW_GAME);
  }

  private tickPlay(dt: number): void {
    const world = this.world;
    if (!world) return;
    if (world.status === "won" && input.justPressed("jump")) {
      this.goTo("title");
      return;
    }
    const coinsBefore = world.collected.size;
    const wasPlaying = world.status === "playing";
    stepWorld(
      world,
      {
        move: input.vector("move").x,
        jumpPressed: input.justPressed("jump"),
        jumpHeld: input.isDown("jump"),
      },
      dt,
    );
    const justWon = wasPlaying && world.status === "won";
    if (world.collected.size !== coinsBefore || justWon) void this.persist();
  }
}

/** The title rows for `save`: Continue only when it holds progress. */
function titleOptions(save: SaveData | null): MenuOption[] {
  const hasProgress = save !== null && (save.collected.length > 0 || save.completed);
  return hasProgress ? ["Continue", "New game"] : ["New game"];
}
