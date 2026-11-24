/**
 * Tests for hashWorld: equal for equal play whatever the event log holds, different for different
 * play.
 */
import { describe, expect, it } from "vitest";
import { EventLog } from "../kit/core/index.ts";
import type { GameEvent } from "./events.ts";
import { hashWorld } from "./hash.ts";
import { createWorld, stepWorld, type TickInput, type World } from "./world.ts";

const FORWARD: TickInput = { move: { x: 0, y: -1 }, jumpPressed: false };
const STAND: TickInput = { move: { x: 0, y: 0 }, jumpPressed: false };

/** A fresh world after `ticks` ticks of `input`. */
function played(input: TickInput, ticks: number): World {
  const world = createWorld(new EventLog<GameEvent>(), { seed: 1 });
  for (let tick = 0; tick < ticks; tick++) stepWorld(world, input, 1 / 60);
  return world;
}

describe("hashWorld", () => {
  it("gives two runs of the same input the same hash, whatever their event logs hold", () => {
    const first = played(FORWARD, 60);
    const second = played(FORWARD, 60);
    first.events.emit({ type: "player.jumped" });
    expect(hashWorld(first)).toBe(hashWorld(second));
  });

  it("tells apart runs that end in a different place after the same number of ticks", () => {
    expect(hashWorld(played(FORWARD, 60))).not.toBe(hashWorld(played(STAND, 60)));
  });
});
