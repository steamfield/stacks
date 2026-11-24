/**
 * Scenario: walking into a crate shoves it along with Rapier physics.
 */
import { expect } from "@playwright/test";
import { hold, scenario, wait } from "./kit.ts";

interface State {
  crates: { x: number; y: number; z: number }[];
}

export default scenario({
  description: "walking into a crate shoves it along with physics",
  input: [hold("right", 90), wait(30)],
  expect({ state }) {
    const [crate] = (state as State).crates;
    // The crate starts at x=3; the player walks to x=7.5 and pushes it ahead.
    expect(crate?.x).toBeGreaterThan(4);
  },
});
