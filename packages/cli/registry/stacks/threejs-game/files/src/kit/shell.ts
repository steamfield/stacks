/**
 * Boots the game: container sizing and mobile hygiene, starting at once (audio unlocks on the first
 * gesture), pause and save on hide, error capture, and the window.__game hook that tests and
 * `bun run see` drive. It is also the log sink, the one place that writes to the console.
 *
 * In test mode (set by the harness) the shell owns time: the game must not run its own loop, and
 * only advances when __game.advance(ticks) is called.
 */
import {
  configureLogging,
  createLogger,
  type Drained,
  type EventLog,
  type LogEntry,
} from "./core/index.ts";
import type { Input } from "./input.ts";
import { createErrorReporter, type RecordedError, type ReportError } from "./report-error.ts";

export type { RecordedError, ReportError, ReportErrorOptions } from "./report-error.ts";

/** Who the game is: src/game.ts. `id` names its save database, so never change it after launch. */
export interface GameIdentity {
  id: string;
  title: string;
  orientation: "landscape" | "portrait" | "any";
}

export interface LaunchParams {
  /** Seed for createRng. Default 1 in test mode, random otherwise. */
  seed: number;
  /** Scene to start in, if the game supports jumping (?scene=). */
  scene: string | null;
  /** Show the debug overlay and allow capture stages (?debug=1). */
  debug: boolean;
  /** Harness-controlled stepping. */
  testMode: boolean;
}

export interface GameContext {
  identity: GameIdentity;
  /** The element the engine must render into. The shell owns its size; size the canvas to it. */
  container: HTMLElement;
  params: LaunchParams;
  /**
   * Route errors that aren't exceptions (loader failures, context loss) so tests fail on them. By
   * default it also shows a red banner that stays up; pass `{ fatal: false }` for a failure the game
   * shows and recovers from itself (it is still recorded in `__game.errors` and logged).
   */
  reportError: ReportError;
  /** Show a short message over the game, e.g. a storage warning. */
  notice(text: string): void;
  /** Register an AudioContext so the shell resumes it after iOS interrupts it. */
  registerAudioContext(ctx: AudioContext): void;
}

/** What a game hands back to the shell once it has started. */
export interface GameHandle {
  /**
   * Test mode only. Run up to `ticks` fixed logic ticks, stopping early if the game stops being
   * idle (something started loading), then render once. Returns how many ticks actually ran; the
   * harness waits for idle() and calls again for the rest, so load timing never changes the outcome.
   */
  advance(ticks: number): number;
  /** True when nothing is loading or decoding, so the next tick is deterministic. */
  idle(): boolean;
  /** Full state for state.json. Can be large. */
  debugState(): unknown;
  /** A few key fields for the `see` summary and quick assertions. */
  debugSummary(): Record<string, unknown>;
  events: EventLog;
  /** e.g. "webgl2", "canvas". Smoke asserts on this so a silent fallback fails. */
  renderer(): string;
  /** Apply a save fixture (validated by the game's save store). */
  loadState?(save: unknown): Promise<void>;
  pause(): void;
  resume(): void;
  /** Last reliable moment to write on mobile. */
  onHide?(): void | Promise<void>;
}

export interface BootOptions<A extends string> {
  identity: GameIdentity;
  input: Input<A, string>;
  start(ctx: GameContext): Promise<GameHandle>;
  /** Called from the player's first tap, click or key press, e.g. saves.requestPersistence(). */
  onFirstGesture?(): unknown;
}

export interface GameHook {
  ready: boolean;
  gameId: string;
  errors: RecordedError[];
  logs: LogEntry[];
  tick: number;
  /** Runs up to `ticks`; returns how many ran (fewer if a load started). */
  advance(ticks: number): number;
  idle(): boolean;
  events(cursor?: number): Drained<{ type: string }>;
  debugState(): unknown;
  debugSummary(): Record<string, unknown>;
  renderer(): string;
  loadState(save: unknown): Promise<void>;
  inject(action: string, down: boolean): void;
  start(): Promise<void>;
}

declare global {
  interface Window {
    __game?: GameHook;
    /** Set by the test harness before the page loads. */
    __GAME_TEST__?: boolean;
  }
}

const log = createLogger("kit:shell");
const MAX_LOGS = 500;

export function readLaunchParams(search = window.location.search): LaunchParams {
  const q = new URLSearchParams(search);
  const testMode = window.__GAME_TEST__ === true || q.get("test") === "1";
  const seedParam = q.get("seed");
  const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
  return {
    testMode,
    seed: seedParam ? Number(seedParam) : testMode ? 1 : randomSeed(),
    scene: q.get("scene"),
    debug: q.get("debug") === "1",
  };
}

/** Sends log entries to the console and keeps the last few hundred for `__game.logs`. */
function installLogSink(logs: LogEntry[]): void {
  configureLogging((entry) => {
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    const line = `[${entry.namespace}] ${entry.message}`;
    const method = entry.level === "debug" ? "log" : entry.level;
    if (entry.data === undefined) console[method](line);
    else console[method](line, entry.data);
  }, new URLSearchParams(window.location.search).get("log") ?? "");
}

function createHook<A extends string>(options: BootOptions<A>, logs: LogEntry[]): GameHook {
  return {
    ready: false,
    gameId: options.identity.id,
    errors: [],
    logs,
    tick: 0,
    advance: () => {
      throw new Error("Game has not started. Call __game.start() first.");
    },
    idle: () => false,
    events: () => ({ events: [], cursor: 0, dropped: 0 }),
    debugState: () => null,
    debugSummary: () => ({}),
    renderer: () => "none",
    loadState: async () => {
      throw new Error("Game has not started.");
    },
    inject: (action, down) => options.input.inject(action as A, down),
    start: async () => {},
  };
}

/** Points the hook at a started game's handle. */
function attachHandle(hook: GameHook, h: GameHandle, params: LaunchParams, id: string): void {
  Object.assign(hook, {
    advance: (ticks: number) => {
      if (!params.testMode) throw new Error("advance() only works in test mode");
      if (!h.idle()) return 0;
      const ran = h.advance(ticks);
      hook.tick += ran;
      return ran;
    },
    idle: () => h.idle(),
    events: (cursor?: number) => h.events.drain(cursor),
    debugState: () => h.debugState(),
    debugSummary: () => h.debugSummary(),
    renderer: () => h.renderer(),
    loadState: async (save: unknown) => {
      if (!h.loadState) throw new Error(`${id} does not implement loadState`);
      await h.loadState(save);
    },
  } satisfies Partial<GameHook>);
  hook.ready = true;
}

export async function bootGame<A extends string>(options: BootOptions<A>): Promise<void> {
  const params = readLaunchParams();
  const logs: LogEntry[] = [];
  installLogSink(logs);

  const root = document.getElementById("game-root") ?? document.body;
  installBaseStyles();
  const container = el("div", "game-container");
  root.append(container);

  const hook = createHook(options, logs);
  window.__game = hook;

  const banner = el("div", "game-error");
  const reportError = createErrorReporter(hook.errors, (line) => {
    banner.textContent = line;
    container.append(banner);
  });
  window.addEventListener("error", (e) => reportError("error", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reportError("unhandledrejection", e.reason));

  const audioContexts = new Set<AudioContext>();
  const resumeAudio = () => {
    for (const ac of audioContexts) if (ac.state !== "running") void ac.resume();
  };

  const noticeEl = el("div", "game-notice");
  const notice = (text: string) => {
    noticeEl.textContent = text;
    container.append(noticeEl);
  };

  mountRotatePrompt(container, options.identity.orientation);
  const forceTouch = new URLSearchParams(window.location.search).get("touch") === "1";
  options.input.mount(container, { forceTouch });

  const ctx: GameContext = {
    identity: options.identity,
    container,
    params,
    reportError,
    notice,
    registerAudioContext: (ac) => audioContexts.add(ac),
  };

  let handle: GameHandle | null = null;
  const startGame = async () => {
    if (handle) return;
    gate.remove();
    try {
      handle = await options.start(ctx);
    } catch (err) {
      reportError("start", err);
      return;
    }
    attachHandle(hook, handle, params, options.identity.id);
    log.info(`started ${options.identity.id}`, {
      renderer: handle.renderer(),
      seed: params.seed,
      testMode: params.testMode,
    });
  };
  hook.start = startGame;

  // Browsers allow audio and storage persistence only after a gesture on this page. So the game
  // starts at once, silent until the first tap or key press, which unlocks audio and runs
  // onFirstGesture.
  const gestures = ["pointerdown", "keydown", "touchend"] as const;
  const firstGesture = () => {
    for (const type of gestures) window.removeEventListener(type, firstGesture, true);
    resumeAudio();
    Promise.resolve()
      .then(() => options.onFirstGesture?.())
      .catch((err: unknown) => reportError("first gesture", err));
  };
  for (const type of gestures) window.addEventListener(type, firstGesture, true);

  // Test mode keeps a start gate so the harness decides when the game starts (after init scripts
  // and save fixtures). Players never see it.
  const gate = el("button", "game-gate");
  gate.dataset.gameStart = "";
  gate.textContent = `Play ${options.identity.title}`;
  gate.addEventListener("click", () => void startGame());
  if (params.testMode) container.append(gate);
  else void startGame();

  document.addEventListener("visibilitychange", () => {
    if (!handle) return;
    if (document.hidden) {
      handle.pause();
      void handle.onHide?.();
    } else {
      resumeAudio();
      if (!params.testMode) handle.resume();
    }
  });
  window.addEventListener("pointerdown", resumeAudio);
}

/** Device pixel ratio capped at 2: phones at 3x pay for pixels nobody can see. */
export const renderPixelRatio = (): number => Math.min(window.devicePixelRatio || 1, 2);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function mountRotatePrompt(container: HTMLElement, orientation: GameIdentity["orientation"]) {
  if (orientation === "any") return;
  const prompt = el("div", "game-rotate");
  prompt.textContent = `Rotate your device to ${orientation}`;
  const wrong = orientation === "landscape" ? "portrait" : "landscape";
  const query = window.matchMedia(`(orientation: ${wrong}) and (pointer: coarse)`);
  const sync = () => (query.matches ? container.append(prompt) : prompt.remove());
  query.addEventListener("change", sync);
  sync();
}

function installBaseStyles() {
  const style = document.createElement("style");
  style.textContent = `
html, body { margin: 0; height: 100%; background: #111; overflow: hidden; overscroll-behavior: none; }
body { position: fixed; inset: 0; }
.game-container {
  position: absolute; inset: 0;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  display: flex; align-items: center; justify-content: center;
}
.game-container canvas { display: block; touch-action: none; }
.game-gate {
  position: absolute; z-index: 20; padding: 16px 28px; font: 600 20px system-ui, sans-serif;
  border-radius: 12px; border: 0; background: #ffd23f; color: #111; cursor: pointer;
}
.game-error {
  position: absolute; z-index: 30; left: 0; right: 0; top: 0; padding: 8px 12px; background: #b00020; color: #fff;
  font: 13px ui-monospace, monospace; white-space: pre-wrap;
}
.game-notice {
  position: absolute; z-index: 15; bottom: calc(8px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%);
  padding: 6px 12px; border-radius: 8px; background: #000a; color: #fff; font: 13px system-ui, sans-serif;
}
.game-rotate {
  position: absolute; inset: 0; z-index: 25; display: grid; place-items: center; background: #111; color: #fff;
  font: 600 18px system-ui, sans-serif;
}`;
  document.head.append(style);
}
