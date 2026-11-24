/**
 * Scenario: walking forward from the spawn collects the first orb and autosaves.
 */
import { expect } from "@playwright/test";
import { scenario, WALK_TO_FIRST_ORB } from "./kit.ts";

export default scenario({
  description: "walking forward from the spawn collects the first orb and autosaves",
  input: WALK_TO_FIRST_ORB,
  expect({ summary, events }) {
    expect(summary).toMatchObject({ orbs: "1/6", physics: "ready" });
    expect(events.filter((e) => e.type === "orb.collected")).toMatchObject([
      { index: 0, total: 1 },
    ]);
    expect(events.map((e) => e.type)).toContain("save.written");
  },
});
