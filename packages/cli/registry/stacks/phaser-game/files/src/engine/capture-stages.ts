/**
 * Capture stages: `?stage=<name>` puts the world into a known state right after it is built, so a
 * moment that takes a long input script to reach can be captured with `bun run see` straight
 * away. A stage only writes plain world state that the scenes read. It is honoured only with
 * `?debug=1` or in test mode, and the runtime never saves a staged run, so a capture can't
 * overwrite progress.
 *
 * Add a name to `STAGES` and a case to `applyStage` for each moment worth reviewing.
 */
import type { Logger } from "../kit/core/index.ts";
import { TILE } from "../logic/level.ts";
import { PHYSICS, type World } from "../logic/world.ts";

/** Every stage name `applyStage` knows. */
export const STAGES = ["near-goal"] as const;

/** A name from `STAGES`. */
export type StageName = (typeof STAGES)[number];

/** Tiles between the `near-goal` player and the flag. */
const NEAR_GOAL_TILES = 2;

/** The launch params that decide whether `?stage=` is honoured. */
export interface StageGate {
  debug: boolean;
  testMode: boolean;
}

/**
 * The stage `search` (a `location.search` string) asks for, or null when it names none, names an
 * unknown one (logged as a warning listing the valid names), or the page is in neither debug nor
 * test mode.
 */
export function stageFor(gate: StageGate, search: string, log: Logger): StageName | null {
  if (!gate.debug && !gate.testMode) return null;
  const name = new URLSearchParams(search).get("stage");
  const stage = STAGES.find((candidate) => candidate === name);
  if (name !== null && !stage) {
    log.warn(`unknown ?stage=${name}; valid stages: ${STAGES.join(", ")}`);
  }
  return stage ?? null;
}

/**
 * Writes the stage's state into `world`. Call it once, before the first tick.
 *
 * `near-goal` stands the player on the goal's row, `NEAR_GOAL_TILES` tiles to its left, at rest.
 */
export function applyStage(world: World, stage: StageName): void {
  switch (stage) {
    case "near-goal": {
      const { goal } = world.level;
      Object.assign(world.player, {
        x: (goal.x - NEAR_GOAL_TILES) * TILE + (TILE - PHYSICS.width) / 2,
        y: (goal.y + 1) * TILE - PHYSICS.height,
        vx: 0,
        vy: 0,
        grounded: true,
      });
      return;
    }
  }
}
