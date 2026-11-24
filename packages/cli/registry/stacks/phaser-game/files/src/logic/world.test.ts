/**
 * The platformer rules through `createWorld` and `stepWorld`, with small inline ASCII levels:
 * running, walls, variable jumps, coins, the goal, falling out and level parsing errors.
 */
import { describe, expect, it } from "vitest";
import { EventLog, TICK_DT } from "../kit/core/index.ts";
import type { GameEvent } from "./events.ts";
import { LEVEL_1, parseLevel } from "./level.ts";
import type { SaveData } from "./save.ts";
import { createWorld as create, stepWorld, type TickInput, toAscii, type World } from "./world.ts";

/** A world plus the event log it writes to, so tests can read what happened. */
function createWorld(level: ReturnType<typeof parseLevel>, save?: SaveData) {
  const events = new EventLog<GameEvent>();
  return Object.assign(create(level, events, save), { log: events });
}

const idle: TickInput = { move: 0, jumpPressed: false, jumpHeld: false };

/** Holds an input for `ticks`. `jumpPressed` fires only on the first tick, like a real press. */
function play(world: World, input: Partial<TickInput>, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    const jumpPressed = Boolean(input.jumpPressed) && i === 0;
    stepWorld(world, { ...idle, ...input, jumpPressed }, TICK_DT);
  }
}

const types = (world: { log: EventLog<GameEvent> }) => world.log.all().map((e) => e.type);

describe("running", () => {
  it("moves the player right along the ground", () => {
    const world = createWorld(parseLevel(LEVEL_1));
    play(world, { move: 1 }, 30);
    expect(world.player.grounded).toBe(true);
    expect(toAscii(world).split("\n")[9]).toBe("....@......o........#..............o..G.");
  });

  it("stops at a wall", () => {
    const world = createWorld(
      parseLevel(`
      .....
      P.#.G
      #####`),
    );
    play(world, { move: 1 }, 60);
    expect(toAscii(world).split("\n")[1]).toBe(".@#.G");
    expect(world.status).toBe("playing");
  });
});

describe("jumping", () => {
  it("leaves the ground and lands again", () => {
    const world = createWorld(parseLevel(LEVEL_1));
    play(world, { jumpPressed: true, jumpHeld: true }, 1);
    expect(world.player.grounded).toBe(false);
    play(world, {}, 60);
    expect(world.player.grounded).toBe(true);
    expect(types(world)).toEqual(["player.jumped", "player.landed"]);
  });

  it("jumps lower when the button is released early", () => {
    const peak = (holdTicks: number) => {
      const world = createWorld(parseLevel(LEVEL_1));
      const startY = world.player.y;
      let highest = startY;
      play(world, { jumpPressed: true, jumpHeld: true }, holdTicks);
      for (let i = 0; i < 60; i++) {
        play(world, {}, 1);
        highest = Math.min(highest, world.player.y);
      }
      return startY - highest;
    };
    expect(peak(3)).toBeLessThan(peak(30) - 10);
  });

  it("cannot jump again in mid-air", () => {
    const world = createWorld(parseLevel(LEVEL_1));
    play(world, { jumpPressed: true, jumpHeld: true }, 5);
    play(world, { jumpPressed: true, jumpHeld: true }, 1);
    expect(types(world).filter((t) => t === "player.jumped")).toHaveLength(1);
  });
});

describe("coins and goal", () => {
  it("collects a coin once and removes it from the map", () => {
    const world = createWorld(parseLevel("P.o..G\n######"));
    play(world, { move: 1 }, 40);
    expect(world.log.all().filter((e) => e.type === "coin.collected")).toMatchObject([
      { type: "coin.collected", index: 0, total: 1 },
    ]);
    expect(toAscii(world)).not.toContain("o");
  });

  it("restores collected coins from a save", () => {
    const world = createWorld(parseLevel("P.o..G\n######"), { collected: [0], completed: false });
    play(world, { move: 1 }, 40);
    expect(types(world)).not.toContain("coin.collected");
  });

  it("completes the level at the flag and then ignores input", () => {
    const world = createWorld(parseLevel("P.o..G\n######"));
    play(world, { move: 1 }, 120);
    expect(world.status).toBe("won");
    expect(world.log.all().at(-1)).toMatchObject({ type: "level.completed", coins: 1 });
    const x = world.player.x;
    play(world, { move: -1 }, 10);
    expect(world.player.x).toBe(x);
  });
});

describe("falling", () => {
  it("respawns the player after falling out of the level", () => {
    const world = createWorld(parseLevel("P..G\n#..."));
    play(world, { move: 1 }, 120);
    expect(types(world)).toContain("player.respawned");
  });
});

describe("parseLevel", () => {
  it("rejects ragged rows and missing markers with the position", () => {
    expect(() => parseLevel("P.G\n##")).toThrow("Level row 1 is 2 wide, expected 3");
    expect(() => parseLevel("...\n###")).toThrow("Level has no spawn point (P)");
    expect(() => parseLevel("P?G")).toThrow('Unknown level character "?" at 1,0');
  });
});
