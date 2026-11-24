/**
 * The three.js scene for the field: lights, floor, the player, the orbs and the crates. It only
 * draws what it is handed (logic world, crate positions from physics) and never changes either.
 */
import * as THREE from "three";
import type { World } from "../logic/world.ts";
import { CRATE_SPAWNS } from "./physics.ts";

/** Height of the capsule's centre above the player's feet. */
const PLAYER_CENTRE_HEIGHT = 0.8;

/** The scene plus the calls that keep it in step with the game. */
export interface WorldView {
  scene: THREE.Scene;
  /** Where the camera should look: the player's centre, updated by `sync`. */
  playerCentre: THREE.Vector3;
  /** Rebuilds the orb meshes for a replaced world (a loaded save). */
  rebuildOrbs(world: World): void;
  /** Moves the meshes to the world's state and the crates' physics positions. */
  sync(world: World, crates: { x: number; y: number; z: number }[] | undefined): void;
}

/** Builds the scene for `world`. */
export function createWorldView(world: World): WorldView {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5e5);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(5, 10, 4);
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x5f9e4a }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const playerMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 0.8, 4, 12),
    new THREE.MeshStandardMaterial({ color: 0x4fc3f7 }),
  );
  scene.add(playerMesh);

  // One geometry and material shared by every crate and every orb.
  const crateGeometry = new THREE.BoxGeometry(1, 1, 1);
  const crateMaterial = new THREE.MeshStandardMaterial({ color: 0xa1673a });
  const crateMeshes = CRATE_SPAWNS.map(() => {
    const mesh = new THREE.Mesh(crateGeometry, crateMaterial);
    scene.add(mesh);
    return mesh;
  });

  const orbGeometry = new THREE.SphereGeometry(0.3, 16, 12);
  const orbMaterial = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x996600 });
  let orbMeshes: THREE.Mesh[] = [];
  const rebuildOrbs = (from: World) => {
    for (const mesh of orbMeshes) scene.remove(mesh);
    orbMeshes = from.orbs.map((orb) => {
      const mesh = new THREE.Mesh(orbGeometry, orbMaterial);
      mesh.position.set(orb.x, orb.y, orb.z);
      scene.add(mesh);
      return mesh;
    });
  };
  rebuildOrbs(world);

  const playerCentre = new THREE.Vector3();
  return {
    scene,
    playerCentre,
    rebuildOrbs,
    sync(current, crates) {
      playerCentre.set(current.player.x, current.player.y + PLAYER_CENTRE_HEIGHT, current.player.z);
      playerMesh.position.copy(playerCentre);
      orbMeshes.forEach((mesh, index) => {
        mesh.visible = !current.collected.has(index);
      });
      crates?.forEach((crate, index) => {
        crateMeshes[index]?.position.set(crate.x, crate.y, crate.z);
      });
    },
  };
}
