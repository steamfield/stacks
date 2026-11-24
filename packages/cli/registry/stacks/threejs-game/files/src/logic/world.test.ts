/**
 * Tests for the orb field's rules through createWorld and stepWorld, tick by tick.
 */
import { describe, expect, it } from "vitest";
import { EventLog, TICK_DT } from "../kit/core/index.ts";
import type { GameEvent } from "./events.ts";
import { ARENA, createWorld as create, stepWorld, type TickInput, type World } from "./world.ts";

const still: TickInput = { move: { x: 0, y: 0 }, jumpPressed: false };

function createWorld(seed = 1, collected: number[] = []) {
  const log = new EventLog<GameEvent>();
  return Object.assign(create(log, { seed, collected }), { log });
}

function play(world: World, input: Partial<TickInput>, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    const jumpPressed = Boolean(input.jumpPressed) && i === 0;
    stepWorld(world, { ...still, ...input, jumpPressed }, TICK_DT);
  }
}

describe("orb field", () => {
  it("lays out the same orbs for the same seed and different ones for another", () => {
    expect(createWorld(7).orbs).toEqual(createWorld(7).orbs);
    expect(createWorld(7).orbs).not.toEqual(createWorld(8).orbs);
  });

  it("collects the orb straight ahead of the spawn", () => {
    const world = createWorld();
    play(world, { move: { x: 0, y: -1 } }, 50);
    expect(world.log.all().filter((e) => e.type === "orb.collected")).toMatchObject([
      { index: 0, total: 1 },
    ]);
  });

  it("keeps the player inside the arena", () => {
    const world = createWorld();
    play(world, { move: { x: 1, y: 1 } }, 600);
    expect(world.player).toMatchObject({ x: ARENA, z: ARENA });
  });

  it("jumps and lands once per press", () => {
    const world = createWorld();
    play(world, { jumpPressed: true }, 3);
    play(world, { jumpPressed: true }, 1);
    play(world, {}, 60);
    expect(world.log.all().map((e) => e.type)).toEqual(["player.jumped", "player.landed"]);
  });

  it("clears the field when every orb is collected, resuming from a save", () => {
    const world = createWorld(1, [1, 2, 3, 4, 5]);
    play(world, { move: { x: 0, y: -1 } }, 50);
    expect(world.status).toBe("cleared");
    expect(world.log.all().at(-1)).toMatchObject({ type: "field.cleared" });
  });
});
