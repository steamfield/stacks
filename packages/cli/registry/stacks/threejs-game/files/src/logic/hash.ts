/**
 * One number for the whole world state, so two runs (or two browsers) of the same input can be
 * compared at a glance. Smoke asserts the same hash on every Playwright project.
 *
 * The hash covers every field of `World` except the ones below, so state added to `World` later is
 * hashed without touching this file.
 */
import { hashState } from "../kit/core/index.ts";
import type { World } from "./world.ts";

/** World fields left out: the event sink is not state. */
const UNHASHED_WORLD_KEYS: ReadonlySet<keyof World> = new Set(["events"]);

/**
 * A 32-bit hash of the world's changing state: the player, the orbs, collected orbs, status and tick.
 *
 * @throws {TypeError} When a hashed world field holds a value `hashState` has no rule for, such as
 *   a class instance.
 */
export function hashWorld(world: World): number {
  return hashState(world, { skipKeys: UNHASHED_WORLD_KEYS });
}
