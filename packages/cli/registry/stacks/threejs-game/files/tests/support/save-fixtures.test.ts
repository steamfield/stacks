/**
 * Tests for checkSaveFixtures against real save stores (in fake IndexedDB) and a temporary fixtures
 * folder: a clean report, a missing version, a migration the code lost and a newer-than-code save.
 */
import "fake-indexeddb/auto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createSaveStore, type SaveStoreOptions } from "../../src/kit/save.ts";
import { checkSaveFixtures, type FixtureStore } from "./save-fixtures.ts";

/** A small game's save: v1 held coins, v2 (current) added a name. */
interface SaveV2 {
  coins: number;
  name: string;
}

const CURRENT_VERSION = 2;

type Migrations = NonNullable<SaveStoreOptions<SaveV2>["migrate"]>;

const MIGRATIONS: Migrations = { 1: (data) => ({ ...(data as object), name: "Player" }) };

/** Validates the v2 shape, in the safeParse form the save store takes. */
const SCHEMA: SaveStoreOptions<SaveV2>["schema"] = {
  safeParse(data) {
    const save = data as Partial<SaveV2> | null;
    const valid = typeof save?.coins === "number" && typeof save.name === "string";
    return valid
      ? { success: true, data: save as SaveV2 }
      : { success: false, error: { message: `not a v2 save: ${JSON.stringify(data)}` } };
  },
};

const folders: string[] = [];
let storeCount = 0;

afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fixtures folder holding `files` (name to contents), as a `file:` URL ending in a slash. */
function fixturesFolder(files: Record<string, string>): URL {
  const dir = mkdtempSync(join(tmpdir(), "save-fixtures-"));
  folders.push(dir);
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
  return pathToFileURL(`${dir}/`);
}

/** A save file as the store exports it. */
const envelope = (version: number, data: object) =>
  JSON.stringify({ version, savedAt: "2026-01-01T00:00:00.000Z", data });

/** Fresh real stores, each in its own database, with `migrate` as their migrations. */
function storeOpener(migrate: Migrations = MIGRATIONS): () => Promise<FixtureStore> {
  return () =>
    createSaveStore({
      gameId: `fixtures-${storeCount++}`,
      version: CURRENT_VERSION,
      schema: SCHEMA,
      migrate,
    });
}

const allVersions = {
  "save-v1.json": envelope(1, { coins: 4 }),
  "save-v2.json": envelope(2, { coins: 4, name: "Pat" }),
};

describe("checkSaveFixtures", () => {
  it("reports nothing when every version has a fixture that loads", async () => {
    const dir = fixturesFolder({ ...allVersions, "README.md": "notes" });
    const report = await checkSaveFixtures({
      dir,
      currentVersion: CURRENT_VERSION,
      openStore: storeOpener(),
    });
    expect(report).toEqual({ missingVersions: [], failures: [] });
  });

  it("names the versions with no committed fixture", async () => {
    const dir = fixturesFolder({ "save-v2.json": allVersions["save-v2.json"] });
    const report = await checkSaveFixtures({
      dir,
      currentVersion: CURRENT_VERSION,
      openStore: storeOpener(),
    });
    expect(report).toEqual({ missingVersions: [1], failures: [] });
  });

  it("names a fixture the current code can no longer migrate", async () => {
    const dir = fixturesFolder(allVersions);
    const report = await checkSaveFixtures({
      dir,
      currentVersion: CURRENT_VERSION,
      openStore: storeOpener({}),
    });
    expect(report.failures.map((f) => f.file)).toEqual(["save-v1.json"]);
    expect(report.failures[0]?.problem).toMatch(/^expected ok, migrated from v1, got .*unreadable/);
  });

  it("flags a fixture newer than the code", async () => {
    const dir = fixturesFolder({ ...allVersions, "save-v3.json": envelope(3, {}) });
    const report = await checkSaveFixtures({
      dir,
      currentVersion: CURRENT_VERSION,
      openStore: storeOpener(),
    });
    expect(report.failures).toEqual([
      {
        file: "save-v3.json",
        problem: 'expected ok, not migrated, got {"kind":"newer-than-code","version":3}',
      },
    ]);
  });
});
