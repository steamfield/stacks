/** The `near-goal` capture stage, and the rule that a staged run is never saved. */
import { expect } from "@playwright/test";
import { hold, scenario } from "./kit.ts";

export default scenario({
  description:
    "the near-goal capture stage starts beside the flag, and the staged win is never saved",
  start: { scene: "play", query: { stage: "near-goal" } },
  input: [hold("right", 40)],
  expect({ summary, events }) {
    expect(summary).toMatchObject({ scene: "play", status: "won", coins: "0/9" });
    expect(events.map((e) => e.type)).toContain("level.completed");
    expect(events.map((e) => e.type)).not.toContain("save.written");
  },
});
