/**
 * Scenario: a saved game resumes with the same field and the orbs it had collected.
 */
import { expect } from "@playwright/test";
import { savedGame, scenario, wait } from "./kit.ts";

export default scenario({
  description: "a saved game resumes with the same field and collected orbs",
  start: { save: savedGame(1234, [1, 2]) },
  input: [wait(5)],
  expect({ summary }) {
    expect(summary).toMatchObject({ orbs: "2/6" });
  },
});
