/**
 * The Playwright side of the tests: the `game` fixture every spec uses, and the registration that
 * turns each file in `scenarios/` into a test.
 */
import { test as base, expect } from "@playwright/test";
import { GameDriver } from "./driver.ts";
import { loadScenarioFile, SCENARIOS_DIR, scenarioFiles } from "./scenario-files.ts";

export { expect };

/**
 * `game`: a GameDriver for the page. After every test it attaches the console log and fails the
 * test if anything went wrong without throwing (console errors, failed requests, game errors,
 * dropped events).
 */
export const test = base.extend<{ game: GameDriver; gamePath: string }>({
  gamePath: ["/", { option: true }],
  game: async ({ page, gamePath }, use, testInfo) => {
    const driver = new GameDriver(page, gamePath);
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

/** Registers one test per scenario file. Call it with top-level await in a spec file. */
export async function defineScenarioTests(dir: URL = SCENARIOS_DIR): Promise<void> {
  for (const file of scenarioFiles(dir)) {
    const scenario = await loadScenarioFile(file, dir);
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
