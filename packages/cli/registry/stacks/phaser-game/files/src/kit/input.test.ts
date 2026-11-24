/**
 * Unit tests for named-action input at the action level: held and just-pressed edges, taps shorter
 * than a tick, opposite directions cancelling, and the error for an unknown action.
 */
import { describe, expect, it } from "vitest";
import { createInput } from "./input.ts";

const make = () =>
  createInput<"left" | "right" | "jump", "move">({
    actions: { left: ["ArrowLeft"], right: ["ArrowRight"], jump: ["Space"] },
    vectors: { move: { left: "left", right: "right", up: "jump", down: "jump" } },
  });

describe("createInput", () => {
  it("reports a held action as down and only the first tick as just pressed", () => {
    const input = make();
    input.inject("jump", true);
    input.update();
    expect([input.isDown("jump"), input.justPressed("jump")]).toEqual([true, true]);
    input.update();
    expect([input.isDown("jump"), input.justPressed("jump")]).toEqual([true, false]);
    input.inject("jump", false);
    input.update();
    expect(input.isDown("jump")).toBe(false);
  });

  it("does not lose a tap that starts and ends between two ticks", () => {
    const input = make();
    input.update();
    input.inject("jump", true);
    input.inject("jump", false);
    input.update();
    expect(input.justPressed("jump")).toBe(true);
    input.update();
    expect(input.isDown("jump")).toBe(false);
  });

  it("cancels opposite directions in a vector", () => {
    const input = make();
    input.inject("left", true);
    input.inject("right", true);
    input.update();
    expect(input.vector("move").x).toBe(0);
  });

  it("names the known actions when an unknown one is injected", () => {
    expect(() => make().inject("dash" as "jump", true)).toThrow(
      'Unknown action "dash". Known actions: left, right, jump',
    );
  });
});
