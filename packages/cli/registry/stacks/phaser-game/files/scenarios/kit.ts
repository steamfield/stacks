/**
 * The typed scenario kit and the presets scenarios and smoke tests share: input that gets from one
 * screen to another, and save fixtures built from the current `SAVE_VERSION`, so a save change
 * updates them in one place.
 */
import type { Action } from "../src/engine/input.ts";
import { SAVE_VERSION, type SaveData } from "../src/logic/save.ts";
import { scenarioKit } from "../tests/support/scenario.ts";

/** Scenario builders typed against the game's actions, so a misspelt action fails typecheck. */
export const { scenario, hold, tap, wait } = scenarioKit<Action>();

/**
 * From the title into play: confirm the selected row (Continue when the save has progress, else
 * New game), then wait two ticks, which run in play (`world.tick` is 2 afterwards). The first of
 * them reads jump as released, so a `jump` step straight after this preset counts as a fresh press.
 */
export const TITLE_TO_PLAY = [tap("jump"), wait(2)];

/** A save with the two coins on the first ledge (indices 5 and 6) collected, as a save envelope. */
export const TWO_COINS_SAVE = {
  version: SAVE_VERSION,
  savedAt: "2026-11-22T00:00:00.000Z",
  data: { collected: [5, 6], completed: false } satisfies SaveData,
};
