/**
 * Checks the committed save fixtures (`tests/fixtures/save-v<N>.json`): one exists for every save
 * version, and each still loads with the current code, migrated from the version its name says.
 * `tests/save.test.ts` asserts the report is clean.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURE_NAME = /^save-v(\d+)\.json$/;

/** The part of a save store the check uses: importing a save file as a player would. */
export interface FixtureStore {
  importJson(slot: string, json: string): Promise<{ kind: string; migratedFrom?: number }>;
}

/** What to check. */
export interface SaveFixtureCheckOptions {
  /** The fixtures folder, e.g. `new URL("./fixtures/", import.meta.url)`. */
  dir: URL;
  /** The game's `SAVE_VERSION`. */
  currentVersion: number;
  /** A fresh, empty store for each fixture, built with the game's schema and migrations. */
  openStore: () => Promise<FixtureStore>;
}

/** One fixture that didn't load the way its version says it should. */
export interface SaveFixtureFailure {
  file: string;
  problem: string;
}

/** Empty lists mean every fixture is present and loads. */
export interface SaveFixtureReport {
  /** Versions from 1 to the current one with no `save-v<N>.json`. */
  missingVersions: number[];
  failures: SaveFixtureFailure[];
}

/**
 * Imports every `save-v<N>.json` in `dir` into its own fresh store and reports the versions with
 * no fixture and the fixtures that didn't load. A fixture older than the current version must come
 * back `ok` and migrated from N; the current version's fixture must come back `ok` unmigrated.
 *
 * @throws {Error} When `dir` or a fixture can't be read, or `openStore` throws.
 */
export async function checkSaveFixtures(
  options: SaveFixtureCheckOptions,
): Promise<SaveFixtureReport> {
  const fixtures = listFixtures(options.dir);
  const present = new Set(fixtures.map((fixture) => fixture.version));
  const missingVersions: number[] = [];
  for (let version = 1; version <= options.currentVersion; version++) {
    if (!present.has(version)) missingVersions.push(version);
  }
  const failures: SaveFixtureFailure[] = [];
  for (const fixture of fixtures) {
    const store = await options.openStore();
    const json = readFileSync(new URL(fixture.file, options.dir), "utf8");
    const loaded = await store.importJson("main", json);
    const problem = loadProblem(loaded, fixture.version, options.currentVersion);
    if (problem) failures.push({ file: fixture.file, problem });
  }
  return { missingVersions, failures };
}

/** The fixture files in `dir`, oldest version first. */
function listFixtures(dir: URL): { file: string; version: number }[] {
  return readdirSync(fileURLToPath(dir))
    .flatMap((file) => {
      const match = FIXTURE_NAME.exec(file);
      return match ? [{ file, version: Number(match[1]) }] : [];
    })
    .sort((a, b) => a.version - b.version);
}

/** Why a load result is wrong for a fixture of `version`, or undefined when it is right. */
function loadProblem(
  loaded: { kind: string; migratedFrom?: number },
  version: number,
  currentVersion: number,
): string | undefined {
  const expected = version < currentVersion ? `ok, migrated from v${version}` : "ok, not migrated";
  const expectedFrom = version < currentVersion ? version : undefined;
  if (loaded.kind === "ok" && loaded.migratedFrom === expectedFrom) return undefined;
  return `expected ${expected}, got ${JSON.stringify(loaded)}`;
}
