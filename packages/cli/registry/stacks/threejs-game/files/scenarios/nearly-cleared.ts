/**
 * Scenario: the nearly-cleared capture stage leaves one orb, and collecting it clears the field
 * without writing a save.
 */
import { expect } from "@playwright/test";
import { scenario, WALK_TO_FIRST_ORB } from "./kit.ts";

export default scenario({
  description:
    "the nearly-cleared stage leaves one orb, and collecting it clears the field without saving",
  start: { query: { stage: "nearly-cleared" } },
  input: WALK_TO_FIRST_ORB,
  expect({ summary, events }) {
    expect(summary).toMatchObject({ orbs: "6/6", status: "cleared" });
    expect(events.map((e) => e.type)).toContain("field.cleared");
    expect(events.map((e) => e.type)).not.toContain("save.written");
  },
});
