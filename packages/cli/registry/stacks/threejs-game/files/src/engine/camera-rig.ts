/**
 * Third-person follow camera. Smoothing is visual only and never feeds back into game logic. It
 * advances once per logic tick, so the framing at a given tick is the same on a 60 Hz or 120 Hz
 * screen and in test mode, where advance(n) runs n ticks and renders once.
 */
import * as THREE from "three";
import { TICK_DT } from "../kit/core/index.ts";

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly offset = new THREE.Vector3(0, 6, 9);
  private readonly goal = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  /** Higher follows more tightly. ~10 settles in about a third of a second. */
  private readonly lambda = 10;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 200);
  }

  /** Call once per logic tick with the player's position. */
  tick(position: THREE.Vector3): void {
    this.goal.copy(position).add(this.offset);
    this.camera.position.lerp(this.goal, 1 - Math.exp(-this.lambda * TICK_DT));
    this.look.set(position.x, position.y + 0.5, position.z);
    this.camera.lookAt(this.look);
  }

  snapTo(position: THREE.Vector3): void {
    this.camera.position.copy(position).add(this.offset);
    this.look.set(position.x, position.y + 0.5, position.z);
    this.camera.lookAt(this.look);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
