/**
 * The platformer's rules: tile physics for one player, coins and the goal flag, stepped one fixed
 * tick at a time from plain input data. `summarize` and `toAscii` are the views tests, scenarios
 * and `bun run see` read.
 */
import type { EventSink } from "../kit/core/index.ts";
import type { GameEvent } from "./events.ts";
import { isSolid, type Level, TILE } from "./level.ts";
import type { SaveData } from "./save.ts";

export const PHYSICS = {
  gravity: 900,
  runSpeed: 90,
  jumpVelocity: 310,
  /** Upward speed is cut to this when jump is released early, for variable jump height. */
  jumpCutVelocity: 100,
  maxFall: 400,
  width: 10,
  height: 14,
} as const;

/** Input as plain data. The engine reads the input actions and passes this in. */
export interface TickInput {
  /** -1 left, 0 none, 1 right. */
  move: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
}

export interface World {
  level: Level;
  player: Player;
  collected: Set<number>;
  status: "playing" | "won";
  tick: number;
  events: EventSink<GameEvent>;
}

/** `events` is usually the engine's EventLog, so one stream holds menu, save and world events. */
export function createWorld(level: Level, events: EventSink<GameEvent>, save?: SaveData): World {
  return {
    level,
    player: spawnPlayer(level),
    collected: new Set(save?.collected ?? []),
    status: save?.completed ? "won" : "playing",
    tick: 0,
    events,
  };
}

function spawnPlayer(level: Level): Player {
  return {
    x: level.spawn.x * TILE + (TILE - PHYSICS.width) / 2,
    y: (level.spawn.y + 1) * TILE - PHYSICS.height,
    vx: 0,
    vy: 0,
    grounded: true,
  };
}

/** Advances the world by one fixed tick. */
export function stepWorld(world: World, input: TickInput, dt: number): void {
  world.tick++;
  if (world.status !== "playing") return;
  const p = world.player;

  p.vx = Math.sign(input.move) * PHYSICS.runSpeed;
  if (input.jumpPressed && p.grounded) {
    p.vy = -PHYSICS.jumpVelocity;
    p.grounded = false;
    world.events.emit({ type: "player.jumped" });
  }
  if (!input.jumpHeld && p.vy < -PHYSICS.jumpCutVelocity) p.vy = -PHYSICS.jumpCutVelocity;
  p.vy = Math.min(p.vy + PHYSICS.gravity * dt, PHYSICS.maxFall);

  p.x += p.vx * dt;
  resolveX(world.level, p);
  const wasGrounded = p.grounded;
  p.y += p.vy * dt;
  resolveY(world.level, p);
  if (p.grounded && !wasGrounded) world.events.emit({ type: "player.landed" });

  if (p.y > world.level.height * TILE + 32) {
    Object.assign(p, spawnPlayer(world.level));
    world.events.emit({ type: "player.respawned" });
  }

  collectCoins(world);
  if (overlapsTile(p, world.level.goal.x, world.level.goal.y)) {
    world.status = "won";
    world.events.emit({ type: "level.completed", coins: world.collected.size, ticks: world.tick });
  }
}

function tilesUnder(p: Player) {
  return {
    left: Math.floor(p.x / TILE),
    right: Math.floor((p.x + PHYSICS.width - 0.001) / TILE),
    top: Math.floor(p.y / TILE),
    bottom: Math.floor((p.y + PHYSICS.height - 0.001) / TILE),
  };
}

function resolveX(level: Level, p: Player): void {
  const t = tilesUnder(p);
  for (let ty = t.top; ty <= t.bottom; ty++) {
    if (p.vx > 0 && isSolid(level, t.right, ty)) {
      p.x = t.right * TILE - PHYSICS.width;
      p.vx = 0;
    } else if (p.vx < 0 && isSolid(level, t.left, ty)) {
      p.x = (t.left + 1) * TILE;
      p.vx = 0;
    }
  }
}

function resolveY(level: Level, p: Player): void {
  const t = tilesUnder(p);
  p.grounded = false;
  for (let tx = t.left; tx <= t.right; tx++) {
    if (p.vy >= 0 && isSolid(level, tx, t.bottom)) {
      p.y = t.bottom * TILE - PHYSICS.height;
      p.vy = 0;
      p.grounded = true;
    } else if (p.vy < 0 && isSolid(level, tx, t.top)) {
      p.y = (t.top + 1) * TILE;
      p.vy = 0;
    }
  }
}

function overlapsTile(p: Player, tx: number, ty: number): boolean {
  return (
    p.x < (tx + 1) * TILE &&
    p.x + PHYSICS.width > tx * TILE &&
    p.y < (ty + 1) * TILE &&
    p.y + PHYSICS.height > ty * TILE
  );
}

function collectCoins(world: World): void {
  world.level.coins.forEach((coin, index) => {
    if (!world.collected.has(index) && overlapsTile(world.player, coin.x, coin.y)) {
      world.collected.add(index);
      world.events.emit({ type: "coin.collected", index, total: world.collected.size });
    }
  });
}

export function toSave(world: World): SaveData {
  return {
    collected: [...world.collected].sort((a, b) => a - b),
    completed: world.status === "won",
  };
}

/** Small, stable view for the `see` summary and quick assertions. */
export function summarize(world: World) {
  const p = world.player;
  return {
    tick: world.tick,
    status: world.status,
    coins: `${world.collected.size}/${world.level.coins.length}`,
    player: {
      tile: [
        Math.floor((p.x + PHYSICS.width / 2) / TILE),
        Math.floor((p.y + PHYSICS.height / 2) / TILE),
      ],
      grounded: p.grounded,
    },
  };
}

/** The level as text with the player (@) and remaining coins. Readable in test failures. */
export function toAscii(world: World): string {
  const [px, py] = summarize(world).player.tile as [number, number];
  const remaining = new Set(
    world.level.coins.flatMap((c, i) => (world.collected.has(i) ? [] : [`${c.x},${c.y}`])),
  );
  const cell = (solid: boolean, x: number, y: number) => {
    if (x === px && y === py) return "@";
    if (solid) return "#";
    if (remaining.has(`${x},${y}`)) return "o";
    if (x === world.level.goal.x && y === world.level.goal.y) return "G";
    return ".";
  };
  return world.level.solid
    .map((row, y) => row.map((solid, x) => cell(solid, x, y)).join(""))
    .join("\n");
}
