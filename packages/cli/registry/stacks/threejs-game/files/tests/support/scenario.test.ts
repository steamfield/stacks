/**
 * Tests for the `see --input` shorthand parser.
 */
import { describe, expect, it } from "vitest";
import { parseInput } from "./scenario.ts";

describe("parseInput", () => {
  it("parses taps, holds, chords and waits", () => {
    expect(parseInput("jump right*30 right+jump*10 _*20")).toEqual([
      { actions: ["jump"], ticks: 1 },
      { actions: ["right"], ticks: 30 },
      { actions: ["right", "jump"], ticks: 10 },
      { actions: [], ticks: 20 },
    ]);
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
