/**
 * The scenario kit for this game: typed input helpers plus the named sequences and saves that
 * scenarios share, so each scenario reads as what it checks rather than how it gets there.
 */
import type { Action } from "../src/engine/input.ts";
import { SAVE_VERSION } from "../src/logic/save.ts";
import { scenarioKit } from "../tests/support/scenario.ts";

export const { scenario, hold, tap, wait } = scenarioKit<Action>();

/** Ticks of walking straight forward from the spawn to the first orb. */
export const WALK_TO_FIRST_ORB = [hold("forward", 50)];

/** A save file in the current format with the given orbs collected, for `start: { save }`. */
export function savedGame(seed: number, collected: number[]) {
  return { version: SAVE_VERSION, savedAt: "2026-01-01T00:00:00.000Z", data: { seed, collected } };
}
