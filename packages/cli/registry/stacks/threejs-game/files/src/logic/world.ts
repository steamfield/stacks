/**
 * The game's rules: a player walking and jumping on a flat field, collecting seeded orbs. Plain
 * TypeScript with no engine, DOM or clock, stepped one fixed tick at a time.
 */
import { createRng, type EventSink } from "../kit/core/index.ts";
import type { GameEvent } from "./events.ts";
import type { SaveData } from "./save.ts";

/** Units are meters and seconds. The field spans -ARENA..ARENA on x and z; y is up. */
export const ARENA = 10;
export const PHYSICS = { speed: 5, jumpVelocity: 6, gravity: 18, orbRadius: 0.8 } as const;
export const ORB_COUNT = 6;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Input as plain data. The engine reads src/kit/input.ts and passes this in. */
export interface TickInput {
  /** Planar move, each axis -1..1. y is toward the camera (+z). */
  move: { x: number; y: number };
  jumpPressed: boolean;
}

export interface World {
  seed: number;
  player: Vec3 & { vy: number; grounded: boolean };
  orbs: Vec3[];
  collected: Set<number>;
  status: "playing" | "cleared";
  tick: number;
  events: EventSink<GameEvent>;
}

export function createWorld(
  events: EventSink<GameEvent>,
  save: Pick<SaveData, "seed"> & Partial<SaveData>,
): World {
  const rng = createRng(save.seed);
  // Orb 0 sits straight ahead of the spawn so a new player finds one immediately.
  const orbs: Vec3[] = [{ x: 0, y: 0.5, z: -4 }];
  while (orbs.length < ORB_COUNT) {
    orbs.push({ x: rng.int(-ARENA + 1, ARENA - 1), y: 0.5, z: rng.int(-ARENA + 1, ARENA - 1) });
  }
  const collected = new Set(save.collected ?? []);
  return {
    seed: save.seed,
    player: { x: 0, y: 0, z: 0, vy: 0, grounded: true },
    orbs,
    collected,
    status: collected.size === ORB_COUNT ? "cleared" : "playing",
    tick: 0,
    events,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Advance the world by one fixed tick. */
export function stepWorld(world: World, input: TickInput, dt: number): void {
  world.tick++;
  const p = world.player;
  p.x = clamp(p.x + input.move.x * PHYSICS.speed * dt, -ARENA, ARENA);
  p.z = clamp(p.z + input.move.y * PHYSICS.speed * dt, -ARENA, ARENA);

  if (input.jumpPressed && p.grounded) {
    p.vy = PHYSICS.jumpVelocity;
    p.grounded = false;
    world.events.emit({ type: "player.jumped" });
  }
  if (!p.grounded) {
    p.vy -= PHYSICS.gravity * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0;
      p.vy = 0;
      p.grounded = true;
      world.events.emit({ type: "player.landed" });
    }
  }

  world.orbs.forEach((orb, index) => {
    if (world.collected.has(index)) return;
    if (Math.hypot(orb.x - p.x, orb.z - p.z) < PHYSICS.orbRadius && p.y < 1.5) {
      world.collected.add(index);
      world.events.emit({ type: "orb.collected", index, total: world.collected.size });
    }
  });
  if (world.status === "playing" && world.collected.size === world.orbs.length) {
    world.status = "cleared";
    world.events.emit({ type: "field.cleared", ticks: world.tick });
  }
}

export function toSave(world: World): SaveData {
  return { seed: world.seed, collected: [...world.collected].sort((a, b) => a - b) };
}

const round = (v: number) => Math.round(v * 10) / 10;

/** Small, stable view for the `see` summary and quick assertions. */
export function summarize(world: World) {
  return {
    tick: world.tick,
    status: world.status,
    orbs: `${world.collected.size}/${world.orbs.length}`,
    player: {
      x: round(world.player.x),
      y: round(world.player.y),
      z: round(world.player.z),
      grounded: world.player.grounded,
    },
  };
}
