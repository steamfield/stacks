/**
 * What `window.__game.debugSummary()` and `debugState()` report: a few fields for the `see`
 * summary and scenario assertions, and the fuller state for `state.json`. Both carry `worldHash`
 * while a world exists, so two runs of the same input can be compared with one number.
 */
import { hashWorld } from "../logic/hash.ts";
import { summarize, toAscii } from "../logic/world.ts";
import type { Runtime } from "./runtime.ts";

/** The small summary scenarios assert on: scene, save status, and the world's summary and hash. */
export function debugSummary(rt: Runtime, saveStatus: string): Record<string, unknown> {
  const { world } = rt;
  return {
    scene: rt.scene,
    save: saveStatus,
    ...(world ? { ...summarize(world), worldHash: hashWorld(world) } : {}),
  };
}

/** The full state: scene, title menu, save, the world's changing fields, its ASCII view and hash. */
export function debugState(rt: Runtime): Record<string, unknown> {
  const { world } = rt;
  return {
    scene: rt.scene,
    menu: rt.scene === "title" ? rt.menu : undefined,
    save: rt.save,
    staged: rt.staged,
    world: world && {
      player: world.player,
      collected: [...world.collected],
      status: world.status,
      tick: world.tick,
    },
    ascii: world ? toAscii(world) : undefined,
    worldHash: world ? hashWorld(world) : undefined,
  };
}
