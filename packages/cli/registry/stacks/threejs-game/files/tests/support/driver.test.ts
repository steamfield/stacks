/**
 * Tests for GameDriver against a fake slice of Playwright's Page: how it reports a failed error
 * read, and how it presses and lifts a touch button around the ticks it advances.
 */
import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { GameDriver } from "./driver.ts";

type Handler = (arg: never) => void;
type Evaluate = (fn: (...args: never[]) => unknown, arg?: unknown) => Promise<unknown>;

/**
 * The slice of Playwright's Page that GameDriver touches: listeners are recorded as they attach,
 * and `locator(...).dispatchEvent` is written to `log` next to each tick advance.
 */
function fakePage(options: { closed: boolean; evaluate: Evaluate }) {
  const handlers = new Map<string, Handler>();
  const log: string[] = [];
  let evaluateCalls = 0;
  const page = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    isClosed: () => options.closed,
    evaluate: (fn: (...args: never[]) => unknown, arg?: unknown) => {
      evaluateCalls++;
      return options.evaluate(fn, arg);
    },
    locator: (selector: string) => ({
      dispatchEvent: async (type: string, init: unknown) => {
        log.push(`${type} ${selector} ${JSON.stringify(init)}`);
      },
    }),
  };
  return {
    page: page as unknown as Page,
    log,
    emit: (event: string, arg: unknown) => handlers.get(event)?.(arg as never),
    evaluateCalls: () => evaluateCalls,
  };
}

/** A game page that runs every tick asked of it and has no events to drain. */
function playablePage() {
  const fake = fakePage({
    closed: false,
    evaluate: async (fn, arg) => {
      if (!String(fn).includes("advance")) return null;
      fake.log.push(`advance ${String(arg)}`);
      return arg;
    },
  });
  return fake;
}

describe("GameDriver.problems", () => {
  it("reports a failed read of the game errors instead of an empty list", async () => {
    const fake = fakePage({
      closed: false,
      evaluate: () => Promise.reject(new Error("Execution context destroyed")),
    });
    const problems = await new GameDriver(fake.page).problems();
    expect(problems).toEqual([
      {
        kind: "game-error",
        message: "could not read window.__game.errors: Execution context destroyed",
      },
    ]);
  });

  it("skips the read on a closed page and keeps what was already collected", async () => {
    const fake = fakePage({ closed: true, evaluate: () => Promise.reject(new Error("closed")) });
    const driver = new GameDriver(fake.page);
    fake.emit("console", { type: () => "error", text: () => "boom" });
    expect(await driver.problems()).toEqual([{ kind: "console-error", message: "boom" }]);
    expect(fake.evaluateCalls()).toBe(0);
  });
});

describe("GameDriver.touch", () => {
  const jumpButton = '[data-testid="touch-overlay"] button[data-action="jump"]';
  const finger = JSON.stringify({ pointerId: 1, isPrimary: true });

  it("presses the action's on-screen button, holds it for the ticks, then lifts the finger", async () => {
    const fake = playablePage();
    await new GameDriver(fake.page).touch("jump", 3);
    expect(fake.log).toEqual([
      `pointerdown ${jumpButton} ${finger}`,
      "advance 3",
      `pointerup ${jumpButton} ${finger}`,
    ]);
  });

  it("lifts the finger and passes the error on when the game fails to advance", async () => {
    const fake = fakePage({
      closed: false,
      evaluate: () => Promise.reject(new Error("Target page closed")),
    });
    await expect(new GameDriver(fake.page).touch("jump", 3)).rejects.toThrow("Target page closed");
    expect(fake.log).toEqual([
      `pointerdown ${jumpButton} ${finger}`,
      `pointerup ${jumpButton} ${finger}`,
    ]);
  });
});
