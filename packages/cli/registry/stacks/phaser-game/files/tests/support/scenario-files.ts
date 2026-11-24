/**
 * Finds and imports the files in `scenarios/`. Kept apart from the Playwright fixture so
 * `bun run see` can load a scenario without the test runner.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Scenario } from "./scenario.ts";

/** The scenario folder, next to `tests/`. */
export const SCENARIOS_DIR = new URL("../../scenarios/", import.meta.url);

/** The scenario files in `dir`: every `.ts` file except `kit.ts`, sorted. */
export function scenarioFiles(dir: URL = SCENARIOS_DIR): string[] {
  return readdirSync(fileURLToPath(dir))
    .filter((file) => file.endsWith(".ts") && file !== "kit.ts")
    .sort();
}

/**
 * Imports one scenario file's default export.
 *
 * @throws {Error} When the file has no default export.
 */
export async function loadScenarioFile(file: string, dir: URL = SCENARIOS_DIR): Promise<Scenario> {
  const url = pathToFileURL(join(fileURLToPath(dir), file)).href;
  const mod = (await import(url)) as { default?: Scenario };
  if (!mod.default) throw new Error(`${file} must default-export a scenario(...)`);
  return mod.default;
}
