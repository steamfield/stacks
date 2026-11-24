/**
 * Drives one game page through `window.__game`. The Playwright fixture and `bun run see` both use
 * it, so a run from the command line and a run in a test behave the same.
 *
 * Everything that can go wrong without throwing (console errors, failed requests, dropped events,
 * game errors) is collected here and reported by `problems()`.
 */
import type { Page } from "@playwright/test";
// Type-only import: brings in the shell's `window.__game` declaration.
import type {} from "../../src/kit/shell.ts";
import type { InputStep, Scenario, ScenarioResult } from "./scenario.ts";

/** How to open the game. */
export interface OpenOptions {
  seed?: number;
  scene?: string;
  debug?: boolean;
  /** Force the on-screen touch controls (also on automatically for touch devices). */
  touch?: boolean;
  /** Extra query parameters. */
  query?: Record<string, string>;
}

/** Something that went wrong without throwing. */
export interface Problem {
  kind: "console-error" | "page-error" | "request-failed" | "game-error" | "events-dropped";
  message: string;
}

type GameEvent = ScenarioResult["events"][number];

const IDLE_TIMEOUT_MS = 15_000;

/** The pointer a single finger reports, for touch-button presses. */
const TOUCH_POINTER = { pointerId: 1, isPrimary: true } as const;

/** A game page under test control. */
export class GameDriver {
  private cursor = 0;
  private readonly collected: GameEvent[] = [];
  private readonly found: Problem[] = [];
  readonly console: string[] = [];
  readonly page: Page;
  /** URL path of the game, `/` unless the game is served under a sub-path. */
  readonly path: string;

  constructor(page: Page, path = "/") {
    this.page = page;
    this.path = path;
    page.on("console", (msg) => {
      this.console.push(`[${msg.type()}] ${msg.text()}`);
      if (msg.type() === "error") this.found.push({ kind: "console-error", message: msg.text() });
    });
    page.on("pageerror", (err) => this.found.push({ kind: "page-error", message: err.message }));
    page.on("requestfailed", (req) =>
      this.found.push({
        kind: "request-failed",
        message: `${req.url()} ${req.failure()?.errorText ?? ""}`,
      }),
    );
    page.on("response", (res) => {
      if (res.status() >= 400) {
        this.found.push({ kind: "request-failed", message: `${res.status()} ${res.url()}` });
      }
    });
  }

  /** Loads the game in test mode, clicks the start gate, and waits until it is ready and idle. */
  async open(options: OpenOptions = {}): Promise<void> {
    await this.page.addInitScript(() => {
      window.__GAME_TEST__ = true;
    });
    const q = new URLSearchParams(options.query);
    q.set("seed", String(options.seed ?? 1));
    if (options.scene) q.set("scene", options.scene);
    if (options.debug) q.set("debug", "1");
    if (options.touch) q.set("touch", "1");
    this.cursor = 0; // a (re)loaded page starts a fresh event log
    await this.page.goto(`${this.path}?${q}`);
    await this.page.locator("[data-game-start]").click();
    await this.page.waitForFunction(
      () => window.__game?.ready === true || (window.__game?.errors.length ?? 0) > 0,
      null,
      { timeout: IDLE_TIMEOUT_MS },
    );
    await this.assertNoGameErrors("starting the game");
    await this.waitIdle();
  }

  async waitIdle(): Promise<void> {
    await this.page.waitForFunction(() => window.__game?.idle() === true, null, {
      timeout: IDLE_TIMEOUT_MS,
    });
  }

  /** Advances exactly `ticks` logic ticks, waiting out any scene loads in between. */
  async advance(ticks: number): Promise<void> {
    let remaining = ticks;
    while (remaining > 0) {
      const ran = await this.page.evaluate((n) => window.__game?.advance(n) ?? 0, remaining);
      remaining -= ran;
      if (remaining > 0) await this.waitIdle();
    }
    await this.drainEvents();
  }

  /** Holds each step's actions for its ticks, then releases them. */
  async play(steps: readonly InputStep[]): Promise<void> {
    for (const step of steps) {
      await this.inject(step.actions, true);
      await this.advance(step.ticks);
      await this.inject(step.actions, false);
    }
  }

  /** Presses or releases `actions` as injected input. */
  async inject(actions: readonly string[], down: boolean): Promise<void> {
    await this.page.evaluate(
      ([list, isDown]) => {
        for (const action of list) window.__game?.inject(action, isDown);
      },
      [actions, down] as const,
    );
  }

  /**
   * Holds the on-screen touch button for `action` for `ticks` logic ticks, through the pointer
   * events a finger sends. The touch controls must be showing (a touch device or `touch: true`).
   * The finger is lifted even when advancing fails.
   */
  async touch(action: string, ticks: number): Promise<void> {
    const button = this.page.locator(
      `[data-testid="touch-overlay"] button[data-action="${action}"]`,
    );
    await button.dispatchEvent("pointerdown", TOUCH_POINTER);
    try {
      await this.advance(ticks);
    } finally {
      await button.dispatchEvent("pointerup", TOUCH_POINTER);
    }
  }

  async loadState(save: unknown): Promise<void> {
    await this.page.evaluate(async (s) => window.__game?.loadState(s), save);
    await this.waitIdle();
  }

  async summary(): Promise<Record<string, unknown>> {
    return this.page.evaluate(() => window.__game?.debugSummary() ?? {});
  }

  async state(): Promise<unknown> {
    return this.page.evaluate(() => window.__game?.debugState() ?? null);
  }

  /** Screenshots the canvas after the next rendered frames, so it shows the last advance(). */
  async screenshot(path: string): Promise<void> {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await this.page.locator("canvas").first().screenshot({ path, scale: "css" });
  }

  async renderer(): Promise<string> {
    return this.page.evaluate(() => window.__game?.renderer() ?? "none");
  }

  /** All events seen since open(), in order. */
  async events(): Promise<GameEvent[]> {
    await this.drainEvents();
    return [...this.collected];
  }

  /** Runs a scenario from the current page state and returns what it produced. */
  async runScenario(scenario: Scenario): Promise<ScenarioResult> {
    if (scenario.start?.save !== undefined) await this.loadState(scenario.start.save);
    const before = this.collected.length;
    await this.play(scenario.input);
    return {
      summary: await this.summary(),
      state: await this.state(),
      events: (await this.events()).slice(before),
    };
  }

  /** Everything that went wrong without throwing. Tests fail when this is non-empty. */
  async problems(): Promise<Problem[]> {
    const all: Problem[] = [...(await this.readGameErrors()), ...this.found];
    // One exception surfaces as a game error, a page error and a console error. Report it once.
    const seen: string[] = [];
    return all.filter((p) => {
      const key = firstLine(p.message)
        .replace(/^(error|start|unhandledrejection|webgl|first gesture): /, "")
        .replace(/^\[[^\]]+\] (\w+: )?/, "");
      if (seen.some((s) => s.includes(key) || key.includes(s))) return false;
      seen.push(key);
      return true;
    });
  }

  /** Errors the game reported in the page. A failed read is itself a problem. */
  private async readGameErrors(): Promise<Problem[]> {
    if (this.page.isClosed()) return [];
    try {
      const errors = await this.page.evaluate(() => window.__game?.errors ?? []);
      return errors.map((e) => ({
        kind: "game-error" as const,
        message: `${e.source}: ${e.message}`,
      }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return [{ kind: "game-error", message: `could not read window.__game.errors: ${reason}` }];
    }
  }

  private async assertNoGameErrors(during: string): Promise<void> {
    const errors = await this.page.evaluate(() => window.__game?.errors ?? []);
    if (errors.length > 0) {
      const lines = errors.map((e) => `  ${e.source}: ${e.message}`).join("\n");
      throw new Error(`Game reported errors while ${during}:\n${lines}`);
    }
  }

  private async drainEvents(): Promise<void> {
    const drained = await this.page.evaluate((c) => window.__game?.events(c) ?? null, this.cursor);
    if (!drained) return;
    this.cursor = drained.cursor;
    this.collected.push(...(drained.events as GameEvent[]));
    if (drained.dropped > 0) {
      this.found.push({
        kind: "events-dropped",
        message: `${drained.dropped} events were dropped from the ring buffer. Drain more often or raise EventLog capacity.`,
      });
    }
  }
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}
