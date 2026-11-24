/** The `--input` shorthand parser `bun run see` uses. */
import { describe, expect, it } from "vitest";
import { parseInput, totalTicks } from "./scenario.ts";

describe("parseInput", () => {
  it("parses taps, holds, chords and waits", () => {
    const steps = parseInput("jump right*30 right+jump*10 _*20");
    expect(steps).toEqual([
      { actions: ["jump"], ticks: 1 },
      { actions: ["right"], ticks: 30 },
      { actions: ["right", "jump"], ticks: 10 },
      { actions: [], ticks: 20 },
    ]);
    expect(totalTicks(steps)).toBe(61);
  });

  it("names the known actions when one is misspelled", () => {
    expect(() => parseInput("jmup", ["jump", "left"])).toThrow(
      'Unknown action "jmup" in "jmup". Known actions: jump, left',
    );
  });

  it("rejects malformed tokens", () => {
    expect(() => parseInput("right*")).toThrow('Bad input token "right*"');
  });
});
