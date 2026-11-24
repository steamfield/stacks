/**
 * Save compatibility: every committed tests/fixtures/save-v<N>.json, one per save version, still
 * loads with the current schema and migrations.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createSaveStore } from "../src/kit/save.ts";
import { migrations, SAVE_VERSION, SaveSchema } from "../src/logic/save.ts";
import { checkSaveFixtures } from "./support/save-fixtures.ts";

const fixturesDir = new URL("./fixtures/", import.meta.url);
let store = 0;
const freshStore = () =>
  createSaveStore({
    gameId: `fixture-${store++}`,
    version: SAVE_VERSION,
    schema: SaveSchema,
    migrate: migrations,
  });

describe("save compatibility", () => {
  // Every fixture, including ones added later without their own assertions, must still load.
  it("has a fixture for every save version, and each loads with the current code", async () => {
    const report = await checkSaveFixtures({
      dir: fixturesDir,
      currentVersion: SAVE_VERSION,
      openStore: freshStore,
    });
    expect(report).toEqual({ missingVersions: [], failures: [] });
  });
});
