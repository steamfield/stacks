/**
 * The game's input map: every action it understands, its keys, the move vector and the touch
 * layout. Scenarios are typed against `Action`.
 */
import { createInput } from "../kit/input.ts";

/** Every action the game understands. Scenarios are typed against this. */
export type Action = "left" | "right" | "forward" | "back" | "jump";

export const input = createInput<Action, "move">({
  actions: {
    left: ["ArrowLeft", "KeyA"],
    right: ["ArrowRight", "KeyD"],
    forward: ["ArrowUp", "KeyW"],
    back: ["ArrowDown", "KeyS"],
    jump: ["Space"],
  },
  vectors: { move: { left: "left", right: "right", up: "forward", down: "back" } },
  touch: {
    dpad: { left: "left", right: "right", up: "forward", down: "back" },
    buttons: [{ action: "jump", label: "A" }],
  },
});
