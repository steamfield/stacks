/** Jump the wall and run to the flag. */
import { expect } from "@playwright/test";
import { hold, scenario } from "./kit.ts";

export default scenario({
  description: "jumping the wall and running to the flag completes the level",
  start: { scene: "play" },
  input: [hold("right", 180), hold(["right", "jump"], 20), hold("right", 400)],
  expect({ summary, events }) {
    expect(summary).toMatchObject({ status: "won" });
    expect(events.find((e) => e.type === "level.completed")).toMatchObject({ coins: 2 });
  },
});
