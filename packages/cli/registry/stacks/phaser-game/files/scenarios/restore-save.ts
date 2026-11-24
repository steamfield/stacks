/** A save fixture loads straight into play with its coins. */
import { expect } from "@playwright/test";
import { scenario, TWO_COINS_SAVE, wait } from "./kit.ts";

export default scenario({
  description: "a saved game resumes with its collected coins",
  start: { save: TWO_COINS_SAVE },
  input: [wait(5)],
  expect({ summary }) {
    expect(summary).toMatchObject({ scene: "play", coins: "2/9" });
  },
});
