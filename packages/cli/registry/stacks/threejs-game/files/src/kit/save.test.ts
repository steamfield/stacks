/**
 * Tests for the save store against an in-memory IndexedDB: round trips, migration, and the cases
 * where it must refuse to overwrite what is stored.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createSaveStore } from "./save.ts";

const V2 = z.object({ coins: z.number(), name: z.string() });
let n = 0;
const fresh = (version = 2) =>
  createSaveStore({
    gameId: `test-${n++}`,
    version,
    schema: V2,
    migrate: { 1: (d) => ({ ...(d as object), name: "Player" }) },
  });

describe("createSaveStore", () => {
  it("round-trips a save", async () => {
    const saves = await fresh();
    expect(await saves.load("a")).toEqual({ kind: "empty" });
    expect(await saves.save("a", { coins: 3, name: "Pat" })).toEqual({ ok: true });
    expect(await saves.load("a")).toEqual({ kind: "ok", data: { coins: 3, name: "Pat" } });
  });

  it("migrates old saves", async () => {
    const saves = await fresh();
    const ok = await saves.importJson(
      "a",
      JSON.stringify({ version: 1, savedAt: "", data: { coins: 1 } }),
    );
    expect(ok).toMatchObject({
      kind: "ok",
      data: { coins: 1, name: "Player" },
      migratedFrom: 1,
    });
  });

  it("never overwrites a save that fails validation", async () => {
    const id = `test-${n++}`;
    const v2 = await createSaveStore({ gameId: id, version: 2, schema: V2 });
    await v2.save("a", { coins: 1, name: "x" });
    const strict = await createSaveStore({
      gameId: id,
      version: 2,
      schema: z.object({ coins: z.number(), name: z.string(), extra: z.string() }),
    });
    expect((await strict.load("a")).kind).toBe("unreadable");
    expect(await strict.save("a", { coins: 2, name: "y", extra: "z" })).toMatchObject({
      ok: false,
    });
    expect(await strict.exportJson("a")).toContain('"coins": 1');
  });

  it("refuses to overwrite a save from newer code (rollback)", async () => {
    const id = `test-${n++}`;
    const v3 = await createSaveStore({ gameId: id, version: 3, schema: V2 });
    await v3.save("a", { coins: 9, name: "new" });
    const v2 = await createSaveStore({ gameId: id, version: 2, schema: V2 });
    expect(await v2.load("a")).toEqual({ kind: "newer-than-code", version: 3 });
    expect((await v2.save("a", { coins: 0, name: "old" })).ok).toBe(false);
  });
});
