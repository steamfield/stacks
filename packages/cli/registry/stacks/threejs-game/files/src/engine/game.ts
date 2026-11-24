/**
 * The three.js engine for the game: renderer, camera, the real-time loop and the `GameHandle` the
 * shell and tests drive. Gameplay lives in `Runtime`; this file renders its state, steps Rapier
 * after each logic tick and reads input.
 */
import * as THREE from "three";
import { createLogger } from "../kit/core/index.ts";
import type { SaveStore } from "../kit/save.ts";
import { type GameContext, type GameHandle, renderPixelRatio } from "../kit/shell.ts";
import type { SaveData } from "../logic/save.ts";
import { CameraRig } from "./camera-rig.ts";
import { stageFor } from "./capture-stages.ts";
import { input } from "./input.ts";
import { loadPhysics, type Physics } from "./physics.ts";
import { Runtime } from "./runtime.ts";
import { createWorldView, type WorldView } from "./world-view.ts";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Starts the game in `ctx.container` and returns the handle the shell drives. */
export async function startThree(
  ctx: GameContext,
  saves: SaveStore<SaveData>,
): Promise<GameHandle> {
  let physics: Physics | null = null;
  const rig = new CameraRig(1);
  // The view needs the world and the runtime's hooks need the view, so the view is filled in right
  // after start.
  let worldView: WorldView | null = null;

  const runtime = await Runtime.start({
    saves,
    seed: ctx.params.seed,
    notice: ctx.notice,
    stage: stageFor(ctx.params, window.location.search, createLogger(ctx.identity.id)),
    gameId: ctx.identity.id,
    isReady: () => physics !== null,
    readInput: () => {
      input.update();
      return { move: input.vector("move"), jumpPressed: input.justPressed("jump") };
    },
    afterTick: (world) => {
      physics?.step(world.player);
      if (!worldView) return;
      worldView.sync(world, physics?.crates());
      rig.tick(worldView.playerCentre);
    },
  });
  const view = createWorldView(runtime.world);
  worldView = view;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(renderPixelRatio());
  ctx.container.append(renderer.domElement);
  renderer.domElement.addEventListener("webglcontextlost", () =>
    ctx.reportError("webgl", "WebGL context lost"),
  );

  const render = () => {
    view.sync(runtime.world, physics?.crates());
    renderer.render(view.scene, rig.camera);
  };
  const resize = () => {
    const { width, height } = ctx.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height);
    rig.resize(width, height);
    render();
  };
  new ResizeObserver(resize).observe(ctx.container);
  view.sync(runtime.world, undefined);
  rig.snapTo(view.playerCentre);

  // Physics loads after the first frame. Ticks wait for it (idle() is false until then).
  const loadingLabel = Object.assign(document.createElement("div"), {
    textContent: "Loading physics...",
  });
  loadingLabel.style.cssText =
    "position:absolute;bottom:12px;right:12px;color:#fff;font:13px system-ui";
  ctx.container.append(loadingLabel);
  loadPhysics()
    .then((loaded) => {
      physics = loaded;
      loadingLabel.remove();
      runtime.events.emit({ type: "physics.ready" });
      render();
    })
    .catch((err) => ctx.reportError("physics", err));

  // Real-time loop. In test mode the shell drives advance() instead and we render after each call.
  let running = !ctx.params.testMode;
  let last = performance.now();
  const loop = (now: number) => {
    if (!running) return;
    runtime.frame((now - last) / 1000);
    last = now;
    render();
    requestAnimationFrame(loop);
  };
  if (running) requestAnimationFrame(loop);

  return {
    events: runtime.events,
    idle: () => physics !== null && !runtime.saving,
    advance(ticks) {
      const ran = runtime.advance(ticks);
      render();
      return ran;
    },
    renderer: () => (renderer.capabilities.isWebGL2 ? "webgl2" : "webgl"),
    debugSummary: () => ({ ...runtime.summary(), physics: physics ? "ready" : "loading" }),
    debugState: () => ({
      worldHash: runtime.worldHash(),
      world: { ...runtime.world, events: undefined, collected: [...runtime.world.collected] },
      crates: physics?.crates().map((c) => ({ x: round2(c.x), y: round2(c.y), z: round2(c.z) })),
    }),
    async loadState(save) {
      await runtime.loadSave(save);
      view.rebuildOrbs(runtime.world);
      view.sync(runtime.world, physics?.crates());
      rig.snapTo(view.playerCentre);
      render();
    },
    pause() {
      running = false;
    },
    resume() {
      if (running) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(loop);
    },
    onHide: () => runtime.persist("progress on hide"),
  };
}
