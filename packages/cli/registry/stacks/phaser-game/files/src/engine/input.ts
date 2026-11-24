/**
 * Every action the game understands, with its keys, its movement vector and the touch layout.
 * Scenarios are typed against `Action`, so a misspelt action fails typecheck.
 */
import { createInput } from "../kit/input.ts";

export type Action = "left" | "right" | "up" | "down" | "jump";

export const input = createInput<Action, "move">({
  actions: {
    left: ["ArrowLeft", "KeyA"],
    right: ["ArrowRight", "KeyD"],
    up: ["ArrowUp", "KeyW"],
    down: ["ArrowDown", "KeyS"],
    jump: ["Space", "KeyZ", "Enter"],
  },
  vectors: { move: { left: "left", right: "right", up: "up", down: "down" } },
  touch: {
    dpad: { left: "left", right: "right", up: "up", down: "down" },
    buttons: [{ action: "jump", label: "A" }],
  },
});
