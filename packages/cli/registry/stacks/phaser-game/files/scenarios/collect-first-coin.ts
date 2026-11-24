/** New game from the title, run right to the first ground coin, and check the autosave. */
import { expect } from "@playwright/test";
import { hold, scenario, TITLE_TO_PLAY } from "./kit.ts";

export default scenario({
  description:
    "starting a new game from the title and running right collects the first ground coin and autosaves",
  input: [...TITLE_TO_PLAY, hold("right", 120)],
  expect({ summary, events }) {
    expect(summary).toMatchObject({ scene: "play", coins: "1/9", player: { grounded: true } });
    expect(events.filter((e) => e.type === "menu.selected")).toMatchObject([
      { option: "New game" },
    ]);
    expect(events.filter((e) => e.type === "coin.collected")).toMatchObject([
      { index: 7, total: 1 },
    ]);
    expect(events.map((e) => e.type)).toContain("save.written");
  },
});
