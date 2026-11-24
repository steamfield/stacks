/**
 * The Playwright side of the game's tests: the `game` fixture every spec uses, and the loader that
 * turns each file in scenarios/ into one test.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test as base, expect } from "@playwright/test";
import { GameDriver } from "./driver.ts";
import type { Scenario } from "./scenario.ts";

export { expect };

/**
 * `game` fixture: a GameDriver for this page. After every test it attaches the console log and
 * fails the test if anything went wrong without throwing (console errors, failed requests, game
 * errors, dropped events).
 */
export const test = base.extend<{ game: GameDriver }>({
  game: async ({ page }, use, testInfo) => {
    const driver = new GameDriver(page);
    await use(driver);
    await testInfo.attach("console.log", {
      body: driver.console.join("\n") || "(empty)",
      contentType: "text/plain",
    });
    const problems = await driver.problems();
    if (problems.length > 0) {
      const lines = problems.map((p) => `  ${p.kind}: ${p.message}`).join("\n");
      throw new Error(`Problems during the test:\n${lines}`);
    }
  },
});

/**
 * Registers one test per scenario file in `dir` (every .ts file except kit.ts). Call it with
 * top-level await in a spec file:
 *   await defineScenarioTests(new URL("../scenarios/", import.meta.url));
 *
 * @throws {Error} When a scenario file has no default export.
 */
export async function defineScenarioTests(dir: URL): Promise<void> {
  const path = fileURLToPath(dir);
  const files = readdirSync(path)
    .filter((f) => f.endsWith(".ts") && f !== "kit.ts")
    .sort();
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(path, file)).href)) as { default?: Scenario };
    const scenario = mod.default;
    if (!scenario) throw new Error(`${file} must default-export a scenario(...)`);
    const register = scenario.todo ? test.fail : test;
    register(`scenarios/${file}: ${scenario.description}`, async ({ game }) => {
      test.slow(scenario.slow === true, "plays a long stretch of the game");
      await game.open({
        ...(scenario.start?.seed !== undefined && { seed: scenario.start.seed }),
        ...(scenario.start?.scene !== undefined && { scene: scenario.start.scene }),
        ...(scenario.start?.query !== undefined && { query: scenario.start.query }),
      });
      const result = await game.runScenario(scenario);
      await scenario.expect?.(result);
    });
  }
}
