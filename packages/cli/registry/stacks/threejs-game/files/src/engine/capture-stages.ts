/**
 * Capture stages: `?stage=<name>` puts the world into a state worth looking at, so a screenshot or
 * `bun run see` run doesn't have to play up to it. A stage only writes plain world state. It is
 * honoured only with `?debug=1` or in test mode, and the runtime refuses to save a staged world.
 *
 * The names: `nearly-cleared` leaves only the orb straight ahead of the spawn, so one walk forward
 * clears the field.
 */
import type { Logger } from "../kit/core/index.ts";
import type { World } from "../logic/world.ts";

/** Every stage name `applyStage` knows. */
export const STAGES = ["nearly-cleared"] as const;

/** One of the names in {@link STAGES}. */
export type StageName = (typeof STAGES)[number];

/** The launch flags that decide whether a stage may be used. */
export interface StageGate {
  debug: boolean;
  testMode: boolean;
}

/**
 * The `?stage=` the page was opened with: null unless it names a known stage and the launch is a
 * debug or test-mode one, so a stray or shared link cannot stage a real game. An unknown name is
 * logged as a warning that lists the valid ones.
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

/** Writes the stage's state into `world`. Call it once, right after the world is built. */
export function applyStage(world: World, stage: StageName): void {
  switch (stage) {
    case "nearly-cleared":
      world.orbs.forEach((_, index) => {
        if (index !== 0) world.collected.add(index);
      });
      return;
  }
}
