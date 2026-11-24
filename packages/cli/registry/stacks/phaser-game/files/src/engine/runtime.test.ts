/**
 * The game flow without a browser: a real `Runtime` over a real save store (fake IndexedDB), driven
 * tick by tick through injected input. Scenes come up as soon as they are asked for unless a test
 * defers them, to stand in for the frames Phaser takes to build one.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureLogging, type LogEntry } from "../kit/core/index.ts";
import { createSaveStore, type SaveResult, type SaveStore } from "../kit/save.ts";
import type { GameContext } from "../kit/shell.ts";
import { migrations, SAVE_VERSION, type SaveData, SaveSchema } from "../logic/save.ts";
import { summarize } from "../logic/world.ts";
import { type Action, input } from "./input.ts";
import { Runtime, SAVE_SLOT, type SceneKey } from "./runtime.ts";

/** Ticks of holding right from the spawn that reach the first ground coin (index 7). */
const TO_FIRST_COIN = 120;

let storeCount = 0;
const realStore = () =>
  createSaveStore<SaveData>({
    gameId: `runtime-${storeCount++}`,
    version: SAVE_VERSION,
    schema: SaveSchema,
    migrate: migrations,
  });

interface Harness {
  rt: Runtime;
  /** Every `ctx.reportError` call's source. */
  gameErrors: string[];
  /** Brings up the scene the runtime last asked for, if it is still waiting (only with `deferScenes`). */
  showScene(): void;
}

interface HarnessOptions {
  save?: SaveData | null;
  search?: string;
  debug?: boolean;
  testMode?: boolean;
  /** Leave each asked-for scene loading until the test calls `showScene`. */
  deferScenes?: boolean;
}

/**
 * A booted runtime over `saves`, opened at `search`. The test steps it directly whatever the
 * params say; `debug` and `testMode` only change what the runtime honours.
 */
function bootedRuntime(saves: SaveStore<SaveData>, options: HarnessOptions = {}): Harness {
  const { save = null, search = "", debug = false, testMode = true, deferScenes = false } = options;
  let asked: SceneKey | null = null;
  const showScene = () => {
    const scene = asked;
    asked = null;
    if (scene) rt.entered(scene);
  };
  const gameErrors: string[] = [];
  const ctx = {
    game: { id: "runtime-test", title: "Runtime test", orientation: "landscape" },
    params: { seed: 1, scene: null, debug, testMode },
    reportError: (source: string) => gameErrors.push(source),
    notice: () => {},
  } as unknown as GameContext;
  const startScene = (scene: SceneKey) => {
    asked = scene;
    if (!deferScenes) showScene();
  };
  const rt: Runtime = new Runtime({ ctx, saves, save, search, startScene });
  rt.start();
  return { rt, gameErrors, showScene };
}

/** Presses `action` for one tick, then lets a tick pass with it released. */
function press(rt: Runtime, action: Action): void {
  input.inject(action, true);
  rt.step.advance(1);
  input.inject(action, false);
  rt.step.advance(1);
}

/** Holds `actions` together for `ticks` ticks, then releases them. */
function hold(rt: Runtime, actions: Action | Action[], ticks: number): void {
  const held = typeof actions === "string" ? [actions] : actions;
  for (const action of held) input.inject(action, true);
  rt.step.advance(ticks);
  for (const action of held) input.inject(action, false);
}

/** Lets every queued save write run to its end. */
async function settled(rt: Runtime): Promise<void> {
  await vi.waitFor(() => expect(rt.saving).toBe(false));
}

/** A save with progress, so the title offers Continue and New game. */
const ONE_COIN: SaveData = { collected: [7], completed: false };

const eventTypes = (rt: Runtime) => rt.events.all().map((e) => e.type);

let logged: LogEntry[] = [];
beforeEach(() => {
  logged = [];
  configureLogging((entry) => logged.push(entry));
});
afterEach(() => {
  configureLogging(() => {});
});

describe("a new game", () => {
  it("starts on a title offering only New game, and confirming it starts the level", async () => {
    const { rt } = bootedRuntime(await realStore());
    expect(rt.scene).toBe("title");
    expect(rt.menu).toEqual({ options: ["New game"], selected: 0 });

    press(rt, "jump");

    expect(rt.scene).toBe("play");
    expect(rt.world && summarize(rt.world)).toMatchObject({ status: "playing", coins: "0/9" });
    expect(eventTypes(rt)).toEqual(["scene.started", "menu.selected", "scene.started"]);
  });

  it("saves the first coin it collects, and a reload continues from it", async () => {
    const saves = await realStore();
    const { rt, gameErrors } = bootedRuntime(saves);
    press(rt, "jump");
    hold(rt, "right", TO_FIRST_COIN);
    await settled(rt);

    expect(rt.events.all().filter((e) => e.type === "coin.collected")).toMatchObject([
      { index: 7, total: 1 },
    ]);
    expect(eventTypes(rt)).toContain("save.written");
    const loaded = await saves.load(SAVE_SLOT);
    expect(loaded).toMatchObject({ kind: "ok", data: { collected: [7], completed: false } });
    if (loaded.kind !== "ok") return;

    const reloaded = bootedRuntime(saves, { save: loaded.data }).rt;
    expect(reloaded.menu.options).toEqual(["Continue", "New game"]);
    press(reloaded, "jump");
    expect(reloaded.world && summarize(reloaded.world)).toMatchObject({ coins: "1/9" });
    expect(gameErrors).toEqual([]);
  });

  it("ignores ticks and input while the next scene is still loading", async () => {
    const { rt, showScene } = bootedRuntime(await realStore(), {
      save: ONE_COIN,
      deferScenes: true,
    });
    showScene();
    press(rt, "jump");
    press(rt, "down");
    hold(rt, "right", 10);

    expect(rt.loading).toBe(true);
    expect(rt.scene).toBe("title");
    expect(rt.menu).toEqual({ options: ["Continue", "New game"], selected: 0 });
    expect(rt.world?.tick).toBe(0);

    showScene();
    rt.step.advance(1);
    expect(rt.scene).toBe("play");
    expect(rt.world?.tick).toBe(1);
  });
});

describe("a capture stage", () => {
  it("puts the player beside the flag and never saves the staged win", async () => {
    const saves = await realStore();
    const { rt } = bootedRuntime(saves, { search: "?stage=near-goal" });
    press(rt, "jump");
    expect(rt.staged).toBe(true);
    expect(rt.world && summarize(rt.world).player.tile).toEqual([36, 9]);

    hold(rt, "right", 40);
    await rt.hide();
    await settled(rt);

    expect(rt.world?.status).toBe("won");
    expect(eventTypes(rt)).not.toContain("save.written");
    expect(await saves.load(SAVE_SLOT)).toMatchObject({ kind: "empty" });
  });

  it.each([
    { gate: "test mode", debug: false, testMode: true },
    { gate: "?debug=1 outside test mode", debug: true, testMode: false },
  ])("is honoured in $gate", async ({ debug, testMode }) => {
    const { rt } = bootedRuntime(await realStore(), {
      search: "?stage=near-goal",
      debug,
      testMode,
    });
    press(rt, "jump");

    expect(rt.staged).toBe(true);
    expect(rt.world && summarize(rt.world).player.tile).toEqual([36, 9]);
  });

  it("is ignored outside debug and test mode, so a shared link plays normally", async () => {
    const { rt } = bootedRuntime(await realStore(), {
      search: "?stage=near-goal",
      testMode: false,
    });
    press(rt, "jump");

    expect(rt.staged).toBe(false);
    expect(rt.world && summarize(rt.world).player.tile).toEqual([1, 9]);
    expect(logged).toEqual([]);
  });
});

describe("an unknown capture stage", () => {
  it("plays normally and warns with the valid stage names when the gate is open", async () => {
    const { rt } = bootedRuntime(await realStore(), { search: "?stage=nowhere" });
    press(rt, "jump");

    expect(rt.staged).toBe(false);
    expect(logged.map((entry) => `${entry.level} ${entry.message}`)).toEqual([
      "warn unknown ?stage=nowhere; valid stages: near-goal",
    ]);
  });
});

describe("overlapping save writes", () => {
  it("land in the order asked for, leaving the newest progress saved", async () => {
    const store = await realStore();
    const releases: (() => void)[] = [];
    // Each write reaches the real store only when the test releases it.
    const held: SaveStore<SaveData> = {
      ...store,
      save: (slot, data) =>
        new Promise<SaveResult>((resolve) => {
          releases.push(() => void store.save(slot, data).then(resolve));
        }),
    };
    const { rt, gameErrors } = bootedRuntime(held);
    press(rt, "jump");
    // Both ground coins, then the flag: three writes asked for before any is released.
    hold(rt, "right", 180);
    hold(rt, ["right", "jump"], 20);
    hold(rt, "right", 400);
    expect(rt.world && summarize(rt.world)).toMatchObject({ status: "won", coins: "2/9" });

    // Release whichever write is waiting newest first, until none is left.
    await vi.waitFor(() => {
      releases.pop()?.();
      expect(rt.saving).toBe(false);
    });

    const newest = { collected: [7, 8], completed: true };
    expect(await store.load(SAVE_SLOT)).toMatchObject({ kind: "ok", data: newest });
    expect(rt.save).toEqual(newest);
    expect(eventTypes(rt).filter((type) => type === "save.written")).toHaveLength(3);
    expect(gameErrors).toEqual([]);
  });
});

describe("a save that cannot be written", () => {
  it.each([
    {
      failure: "the store reports",
      save: () => Promise.resolve<SaveResult>({ ok: false, reason: "disk full" }),
      warning: "progress not saved: disk full",
    },
    {
      failure: "the store throws",
      save: () => Promise.reject(new Error("IndexedDB is gone")),
      warning: "progress not saved: IndexedDB is gone",
    },
  ])(
    "becomes save.failed and a warning, not a game error, when $failure",
    async ({ save, warning }) => {
      const store = await realStore();
      const { rt, gameErrors } = bootedRuntime({ ...store, save } as SaveStore<SaveData>);
      press(rt, "jump");
      hold(rt, "right", TO_FIRST_COIN);
      await settled(rt);

      expect(rt.events.all().filter((e) => e.type === "save.failed")).toHaveLength(1);
      expect(eventTypes(rt)).not.toContain("save.written");
      expect(gameErrors).toEqual([]);
      expect(rt.save).toBeNull();
      expect(logged.map((entry) => `${entry.level} ${entry.message}`)).toEqual([`warn ${warning}`]);
    },
  );
});
