/** Save compatibility: every committed save fixture still loads with the current code. */
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
  it("has a fixture for every save version, and each loads migrated to the current one", async () => {
    const report = await checkSaveFixtures({
      dir: fixturesDir,
      currentVersion: SAVE_VERSION,
      openStore: freshStore,
    });
    expect(report).toEqual({ missingVersions: [], failures: [] });
  });
});
