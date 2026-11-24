/**
 * Scenarios: a start state, an input script and expectations. The same file runs as a Playwright
 * test (`tests/scenarios.spec.ts`) and as `bun run see --scenario <name>`.
 *
 * `scenarios/kit.ts` makes a typed kit once so action names are checked:
 *   export const { scenario, hold, tap, wait } = scenarioKit<Action>();
 */

/** One step of input. `ticks` is in fixed logic ticks (1/60 s), never rendered frames. */
export interface InputStep<A extends string = string> {
  /** Actions held for the whole step. Empty means nothing pressed (a wait). */
  actions: A[];
  ticks: number;
}

/** Where a scenario starts. */
export interface ScenarioStart {
  /** Save fixture (the full save envelope) applied through the game's loadState. */
  save?: unknown;
  /** Launch parameter `?scene=`. */
  scene?: string;
  seed?: number;
  /** Extra launch parameters, e.g. `{ stage: "near-goal" }` for the debug-gated `?stage=`. */
  query?: Record<string, string>;
}

/** What a scenario's `expect` gets to assert on. */
export interface ScenarioResult {
  /** The game's debugSummary() after the input finished. */
  summary: Record<string, unknown>;
  /** The game's debugState() after the input finished. */
  state: unknown;
  /** Every event emitted during the scenario, in order. */
  events: { type: string; tick: number; [key: string]: unknown }[];
}

/** A scenario file's default export. */
export interface Scenario<A extends string = string> {
  /** Short sentence naming the behavior, used as the test title. */
  description: string;
  start?: ScenarioStart;
  input: InputStep<A>[];
  /** Assert on observable results only: summary, state and events. */
  expect?(result: ScenarioResult): void | Promise<void>;
  /** A known bug. Runs and must still fail; make it a normal scenario once fixed. */
  todo?: boolean;
  /** Plays a long stretch, so its test gets Playwright's `test.slow()` budget (triple timeout). */
  slow?: boolean;
}

/** Scenario builders typed against a game's action names. */
export function scenarioKit<A extends string>() {
  return {
    scenario: (s: Scenario<A>): Scenario<A> => s,
    /** Hold one or more actions together for `ticks`. */
    hold: (actions: A | A[], ticks: number): InputStep<A> => ({
      actions: Array.isArray(actions) ? actions : [actions],
      ticks,
    }),
    /** Press and release within one tick. */
    tap: (action: A): InputStep<A> => ({ actions: [action], ticks: 1 }),
    /** Press nothing for `ticks`. */
    wait: (ticks: number): InputStep<A> => ({ actions: [], ticks }),
  };
}

/**
 * Command-line shorthand to steps. Space-separated tokens:
 *   jump          tap (1 tick)
 *   right*30      hold for 30 ticks
 *   right+jump*10 hold both for 10 ticks
 *   _*20          wait 20 ticks
 *
 * @throws {Error} When a token is malformed or names an action outside `knownActions`.
 */
export function parseInput<A extends string>(
  text: string,
  knownActions?: readonly A[],
): InputStep<A>[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => parseToken(token, knownActions));
}

function parseToken<A extends string>(token: string, knownActions?: readonly A[]): InputStep<A> {
  const match = /^([\w+]+?)(?:\*(\d+))?$/.exec(token);
  if (!match?.[1]) {
    throw new Error(`Bad input token "${token}". Use action, action*ticks, a+b*ticks or _*ticks.`);
  }
  const ticks = match[2] ? Number(match[2]) : 1;
  if (match[1] === "_") return { actions: [], ticks };
  const actions = match[1].split("+") as A[];
  for (const action of actions) {
    if (knownActions && !knownActions.includes(action)) {
      throw new Error(
        `Unknown action "${action}" in "${token}". Known actions: ${knownActions.join(", ")}`,
      );
    }
  }
  return { actions, ticks };
}

/** The total ticks a list of steps plays. */
export function totalTicks(steps: readonly InputStep[]): number {
  return steps.reduce((sum, s) => sum + s.ticks, 0);
}
