/** One Playwright test per file in `scenarios/`. */
import { defineScenarioTests } from "./support/fixture.ts";

await defineScenarioTests();
