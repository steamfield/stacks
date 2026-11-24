/**
 * Rapier world for the crates. Loaded lazily after the first frame so the WASM download doesn't
 * delay first paint. The player is a kinematic body driven by game logic; crates are dynamic bodies
 * it can shove.
 */
import type RAPIER_NS from "@dimforge/rapier3d-compat";
import { TICK_DT } from "../kit/core/index.ts";

type Rapier = typeof RAPIER_NS;

export interface Physics {
  step(player: { x: number; y: number; z: number }): void;
  crates(): { x: number; y: number; z: number }[];
}

export const CRATE_SPAWNS = [
  { x: 3, y: 0.5, z: 0 },
  { x: -3, y: 0.5, z: -2 },
  { x: -3, y: 1.5, z: -2 },
];

export async function loadPhysics(): Promise<Physics> {
  const RAPIER: Rapier = (await import("@dimforge/rapier3d-compat")).default;
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = TICK_DT;

  world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10).setTranslation(0, -0.1, 0));
  const player = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.5, 0),
  );
  world.createCollider(RAPIER.ColliderDesc.capsule(0.4, 0.4), player);
  const crates = CRATE_SPAWNS.map((s) => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(s.x, s.y, s.z),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setDensity(0.5), body);
    return body;
  });

  return {
    step(p) {
      player.setNextKinematicTranslation({ x: p.x, y: p.y + 0.8, z: p.z });
      world.step();
    },
    crates: () => crates.map((c) => c.translation()),
  };
}
