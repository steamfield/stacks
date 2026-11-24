/**
 * Tests for hashState: which values hash apart, which hash alike, and the pinned byte layout.
 */
import { describe, expect, it } from "vitest";
import { hashState } from "./index.ts";

describe("hashState", () => {
  it("keeps an array, an object with that index and a string apart", () => {
    const hashes = [hashState([1]), hashState({ 0: 1 }), hashState("1"), hashState(1)];
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashState([1])).not.toBe(hashState(new Set([1])));
  });

  it("keeps null, undefined and a missing array item apart", () => {
    expect(hashState(null)).not.toBe(hashState(undefined));
    expect(hashState([undefined])).not.toBe(hashState([]));
    const holed: unknown[] = [undefined, 1];
    delete holed[0];
    expect(hashState(holed)).toBe(hashState([undefined, 1]));
  });

  it("ignores the order object keys were added in", () => {
    expect(hashState({ a: 1, b: { c: 2, d: 3 } })).toBe(hashState({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("treats an undefined field as absent", () => {
    expect(hashState({ a: 1, b: undefined })).toBe(hashState({ a: 1 }));
  });

  it("tells -0 from 0 and hashes every NaN alike", () => {
    expect(hashState(-0)).not.toBe(hashState(0));
    const oddNaN = new Float64Array(new Uint32Array([1, 0x7ff80000]).buffer)[0] as number;
    expect(hashState(oddNaN)).toBe(hashState(Number.NaN));
    expect(hashState(Number.NaN)).not.toBe(hashState(0));
  });

  it("hashes sets by content, not insertion order", () => {
    expect(hashState(new Set([3, 1, 2]))).toBe(hashState(new Set([1, 2, 3])));
    expect(hashState(new Set(["b", "a"]))).toBe(hashState(new Set(["a", "b"])));
    expect(hashState(new Set([1, 2]))).not.toBe(hashState(new Set([1, 3])));
  });

  it("ignores skipped keys on the top-level object only", () => {
    const options = { skipKeys: new Set(["events"]) };
    expect(hashState({ tick: 1, events: [1] }, options)).toBe(
      hashState({ tick: 1, events: [2] }, options),
    );
    expect(hashState({ tick: 1, nested: { events: [1] } }, options)).not.toBe(
      hashState({ tick: 1, nested: { events: [2] } }, options),
    );
  });

  it("matches a pinned value so the byte layout cannot drift", () => {
    expect(hashState({ n: [1, "x", true, null], s: new Set([2]) })).toBe(1037247749);
  });

  it("throws naming the path for a value it has no rule for", () => {
    expect(() => hashState({ a: [() => 1] })).toThrow(/no rule for a function at a\.0/);
    expect(() => hashState({ a: new Map() })).toThrow(/an instance of Map at a/);
  });

  it("throws for a container that contains itself", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => hashState(loop)).toThrow(/a cycle at self/);
  });
});
