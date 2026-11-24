/**
 * Unit tests for the seeded rng, the event log's cursor and drop count, the fixed step and the
 * logger's level and namespace filter.
 */
import { describe, expect, it } from "vitest";
import {
  configureLogging,
  createLogger,
  createRng,
  EventLog,
  FixedStep,
  TICK_DT,
} from "./index.ts";

describe("createRng", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.int(1, 6)]).toEqual([b.next(), b.next(), b.int(1, 6)]);
  });

  it("resumes from a stored state", () => {
    const a = createRng(7);
    a.next();
    const resumed = createRng(a.state());
    expect(resumed.next()).toBe(a.next());
  });
});

describe("EventLog", () => {
  it("drains with a cursor and reports dropped events", () => {
    const log = new EventLog<{ type: "hit" }>(2);
    log.emit({ type: "hit" });
    const first = log.drain();
    expect(first.events).toHaveLength(1);
    log.emit({ type: "hit" });
    log.emit({ type: "hit" });
    log.emit({ type: "hit" });
    const second = log.drain(first.cursor);
    expect(second.events).toHaveLength(2);
    expect(second.dropped).toBe(1);
  });
});

describe("FixedStep", () => {
  it("runs whole ticks from real time and exact ticks on advance", () => {
    const ticks: number[] = [];
    const step = new FixedStep((_dt, tick) => ticks.push(tick));
    expect(step.frame(TICK_DT * 2.5)).toBe(2);
    step.advance(3);
    expect(ticks).toEqual([0, 1, 2, 3, 4]);
  });

  it("caps ticks per frame after a stall", () => {
    const step = new FixedStep(() => {}, 5);
    expect(step.frame(10)).toBe(5);
  });
});

describe("logger", () => {
  it("filters by level and forces debug for named namespaces", () => {
    const lines: string[] = [];
    configureLogging((e) => lines.push(`${e.level} ${e.namespace} ${e.message}`), "game:battle");
    createLogger("game:battle").debug("shown");
    createLogger("game:map").debug("hidden");
    createLogger("game:map").info("shown too");
    expect(lines).toEqual(["debug game:battle shown", "info game:map shown too"]);
  });
});
