/**
 * One Playwright test per file in scenarios/. The same files run one at a time through
 * `bun run see --scenario <name>`.
 */
import { defineScenarioTests } from "./support/fixture.ts";

await defineScenarioTests(new URL("../scenarios/", import.meta.url));
