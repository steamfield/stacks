/**
 * Tests for the engine-free runtime: new game and resume, the readiness gate, the world hash,
 * capture stages, save import and failed writes. Runs on an in-memory IndexedDB.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureLogging, createLogger, type LogEntry } from "../kit/core/index.ts";
import { createSaveStore } from "../kit/save.ts";
import { migrations, SAVE_VERSION, SaveSchema } from "../logic/save.ts";
import type { TickInput } from "../logic/world.ts";
import { type StageName, stageFor } from "./capture-stages.ts";
import { Runtime } from "./runtime.ts";

const STILL: TickInput = { move: { x: 0, y: 0 }, jumpPressed: false };
const FORWARD: TickInput = { move: { x: 0, y: -1 }, jumpPressed: false };
/** Ticks of walking forward that reach the first orb. */
const TICKS_TO_FIRST_ORB = 50;

let storeCount = 0;
const openStore = () =>
  createSaveStore({
    gameId: `runtime-${storeCount++}`,
    version: SAVE_VERSION,
    schema: SaveSchema,
    migrate: migrations,
  });

/** A runtime on `saves` whose input is whatever `held.input` is, with physics always ready. */
async function startRuntime(
  saves: Awaited<ReturnType<typeof openStore>>,
  options: { stage?: StageName } = {},
) {
  const held = { input: STILL, ready: true, notices: [] as string[] };
  const runtime = await Runtime.start({
    saves,
    gameId: "orb-test",
    seed: 1,
    notice: (message) => held.notices.push(message),
    readInput: () => held.input,
    isReady: () => held.ready,
    afterTick: () => {},
    stage: options.stage ?? null,
  });
  return { runtime, held };
}

let logged: LogEntry[] = [];
beforeEach(() => {
  logged = [];
  configureLogging((entry) => logged.push(entry));
});
afterEach(() => {
  configureLogging(() => {});
});

describe("runtime", () => {
  it("starts a new game, collects an orb, writes the save and restores it in the next session", async () => {
    const saves = await openStore();
    const first = await startRuntime(saves);
    expect(first.runtime.summary()).toMatchObject({ tick: 0, orbs: "0/6", status: "playing" });

    first.held.input = FORWARD;
    first.runtime.advance(TICKS_TO_FIRST_ORB);
    await first.runtime.settled();
    expect(first.runtime.summary()).toMatchObject({ orbs: "1/6" });
    expect(first.runtime.events.all().map((e) => e.type)).toContain("save.written");

    const second = await startRuntime(saves);
    expect(second.runtime.summary()).toMatchObject({ tick: 0, orbs: "1/6" });
    expect(second.runtime.world.seed).toBe(first.runtime.world.seed);
  });

  it("does not tick while the engine is not ready, and ticks once it is", async () => {
    const { runtime, held } = await startRuntime(await openStore());
    held.ready = false;
    expect(runtime.advance(10)).toBe(0);
    runtime.frame(1);
    expect(runtime.summary().tick).toBe(0);

    held.ready = true;
    expect(runtime.advance(10)).toBe(10);
    expect(runtime.summary().tick).toBe(10);
  });

  it("gives two runs that played the same input the same world hash, and different input another", async () => {
    const play = async (input: TickInput) => {
      const { runtime, held } = await startRuntime(await openStore());
      held.input = input;
      runtime.advance(30);
      return runtime.worldHash();
    };
    expect(await play(FORWARD)).toBe(await play(FORWARD));
    expect(await play(FORWARD)).not.toBe(await play(STILL));
  });

  it("puts a capture stage in the world and never saves it", async () => {
    const saves = await openStore();
    const staged = await startRuntime(saves, { stage: "nearly-cleared" });
    expect(staged.runtime.summary()).toMatchObject({ orbs: "5/6" });

    staged.held.input = FORWARD;
    staged.runtime.advance(TICKS_TO_FIRST_ORB);
    await staged.runtime.settled();
    expect(staged.runtime.summary()).toMatchObject({ status: "cleared" });
    expect(staged.runtime.events.all().map((e) => e.type)).not.toContain("save.written");

    const next = await startRuntime(saves);
    expect(next.runtime.summary()).toMatchObject({ orbs: "0/6" });
  });

  it("replaces the world from an imported save and saves from there", async () => {
    const { runtime } = await startRuntime(await openStore(), { stage: "nearly-cleared" });
    await runtime.loadSave({
      version: SAVE_VERSION,
      savedAt: "2026-01-01T00:00:00.000Z",
      data: { seed: 5, collected: [3] },
    });
    expect(runtime.summary()).toMatchObject({ tick: 0, orbs: "1/6" });

    await runtime.persist("test progress");
    expect(runtime.events.all().map((e) => e.type)).toContain("save.written");
  });

  it("rejects a save the store cannot read", async () => {
    const { runtime } = await startRuntime(await openStore());
    await expect(runtime.loadSave({ nonsense: true })).rejects.toThrow(
      "Fixture rejected by save store",
    );
  });

  it("reports a save the store throws on as save.failed and keeps running", async () => {
    const saves = await openStore();
    const { runtime, held } = await startRuntime(saves);
    saves.save = () => Promise.reject(new Error("disk full"));
    held.input = FORWARD;
    runtime.advance(TICKS_TO_FIRST_ORB);
    expect(runtime.saving).toBe(true);
    await runtime.settled();
    expect(runtime.saving).toBe(false);
    expect(runtime.events.all()).toContainEqual(
      expect.objectContaining({ type: "save.failed", reason: "disk full" }),
    );
  });

  it("logs a failed save under the game id it was given", async () => {
    const saves = await openStore();
    const { runtime, held } = await startRuntime(saves);
    saves.save = () => Promise.reject(new Error("disk full"));
    held.input = FORWARD;
    runtime.advance(TICKS_TO_FIRST_ORB);
    await runtime.settled();
    expect(logged).toEqual([
      { level: "warn", namespace: "orb-test", message: "orb progress not saved: disk full" },
    ]);
  });
});

describe("an unknown capture stage", () => {
  const log = createLogger("game");
  const open = { debug: false, testMode: true };

  it("is not applied, and warns with the valid stage names when the gate is open", () => {
    expect(stageFor(open, "?stage=nowhere", log)).toBeNull();
    expect(logged.map((entry) => `${entry.level} ${entry.message}`)).toEqual([
      "warn unknown ?stage=nowhere; valid stages: nearly-cleared",
    ]);
  });

  it("says nothing outside debug and test mode, or when no stage is asked for", () => {
    expect(stageFor({ debug: false, testMode: false }, "?stage=nowhere", log)).toBeNull();
    expect(stageFor(open, "", log)).toBeNull();
    expect(logged).toEqual([]);
  });
});
