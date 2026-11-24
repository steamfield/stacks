/**
 * `hashWorld` is the same for two runs of the same input whatever their event logs hold, and
 * differs for runs that end in different places.
 */
import { describe, expect, it } from "vitest";
import { EventLog } from "../kit/core/index.ts";
import type { GameEvent } from "./events.ts";
import { hashWorld } from "./hash.ts";
import { LEVEL_1, parseLevel } from "./level.ts";
import { createWorld, stepWorld, type TickInput, type World } from "./world.ts";

const RUN: TickInput = { move: 1, jumpPressed: false, jumpHeld: false };
const STAND: TickInput = { move: 0, jumpPressed: false, jumpHeld: false };

/** A fresh world on LEVEL_1 after `ticks` ticks of `input`. */
function played(input: TickInput, ticks: number): World {
  const world = createWorld(parseLevel(LEVEL_1), new EventLog<GameEvent>());
  for (let tick = 0; tick < ticks; tick++) stepWorld(world, input, 1 / 60);
  return world;
}

describe("hashWorld", () => {
  it("gives two runs of the same input the same hash, whatever their event logs hold", () => {
    const first = played(RUN, 120);
    const second = played(RUN, 120);
    first.events.emit({ type: "player.jumped" });
    expect(hashWorld(first)).toBe(hashWorld(second));
  });

  it("tells apart runs that end in a different place after the same number of ticks", () => {
    expect(hashWorld(played(RUN, 120))).not.toBe(hashWorld(played(STAND, 120)));
  });
});
