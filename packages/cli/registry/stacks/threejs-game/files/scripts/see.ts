/**
 * `bun run see`: plays the built game headlessly to exact ticks and writes what an agent needs to
 * judge it (a frame per `--at` tick, summary, state, events, console) to a run folder. Prints the
 * summary on stderr and the run folder's path on stdout.
 *
 *   bun run build
 *   bun run see --scenario collect-first-orb --at 0,end
 *   bun run see --input "forward*50 right*40 jump _*30" --at 50,120 --mobile
 *
 * Runs under Node (type stripping), serves dist/ with Vite's preview server on a free port and
 * drives Chromium with the same flags and driver as the Playwright tests.
 * Exit status: 0 when the run is clean, 1 when a scenario failed or the game reported problems,
 * 2 for a usage error.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type Browser, chromium, devices } from "@playwright/test";
import { preview } from "vite";
import { game } from "../src/game.ts";
import { CHROMIUM_ARGS } from "../tests/support/chromium-args.ts";
import { GameDriver } from "../tests/support/driver.ts";
import { freePort } from "../tests/support/ports.ts";
import {
  type InputStep,
  parseInput,
  type Scenario,
  type ScenarioResult,
} from "../tests/support/scenario.ts";

const ROOT = resolve(import.meta.dirname, "..");
const DESKTOP = { width: 960, height: 540 };
const KEEP_RUNS = 30;

class UsageError extends Error {}

interface Options {
  scenario?: string;
  input?: string;
  at?: string;
  seed?: string;
  query: string[];
  debug: boolean;
  mobile: boolean;
  out?: string;
}

/** The input to play and the ticks to stop and capture at. */
interface RunPlan {
  steps: InputStep[];
  /** Ascending and unique. */
  captures: number[];
  inputTicks: number;
  /** Idle ticks added after the input to reach the last `--at`. */
  padded: number;
}

interface Frame {
  tick: number;
  summary: Record<string, unknown>;
}

function readOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      scenario: { type: "string" },
      input: { type: "string" },
      at: { type: "string" },
      seed: { type: "string" },
      query: { type: "string", multiple: true, default: [] },
      debug: { type: "boolean", default: false },
      mobile: { type: "boolean", default: false },
      out: { type: "string" },
    },
    strict: true,
  });
  if (!values.scenario && !values.input) {
    throw new UsageError("Pass --scenario <name>, --input <steps>, or both.");
  }
  return {
    ...values,
    query: values.query ?? [],
    debug: values.debug ?? false,
    mobile: values.mobile ?? false,
  };
}

/**
 * Loads scenarios/<name>.ts.
 *
 * @throws {UsageError} When the file doesn't exist or has no default export.
 */
async function loadScenario(name: string): Promise<Scenario> {
  const dir = join(ROOT, "scenarios");
  const file = join(dir, `${name.replace(/\.ts$/, "")}.ts`);
  if (!existsSync(file)) {
    const known = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "kit.ts")
      .map((f) => f.replace(/\.ts$/, ""));
    throw new UsageError(`No scenario "${name}". Known: ${known.join(", ") || "(none)"}`);
  }
  const mod = (await import(pathToFileURL(file).href)) as { default?: Scenario };
  if (!mod.default) throw new UsageError(`${file} must default-export a scenario(...)`);
  return mod.default;
}

/**
 * The scenario's input then `--input`, the `--at` capture ticks, and idle padding so a capture
 * past the input waits for it with nothing pressed.
 *
 * @throws {UsageError} When an `--at` tick isn't a non-negative integer or "end".
 */
function planRun(scenario: Scenario | undefined, opts: Options): RunPlan {
  const steps: InputStep[] = [
    ...(scenario?.input ?? []),
    ...(opts.input ? parseInput(opts.input) : []),
  ];
  const inputTicks = steps.reduce((n, s) => n + s.ticks, 0);
  const at = opts.at
    ? opts.at.split(",").map((t) => (t.trim() === "end" ? inputTicks : Number(t)))
    : [inputTicks];
  if (at.some((t) => !Number.isInteger(t) || t < 0)) {
    throw new UsageError('--at ticks must be non-negative integers, or "end"');
  }
  const captures = [...new Set(at)].sort((a, b) => a - b);
  const padded = Math.max(0, (captures.at(-1) ?? 0) - inputTicks);
  if (padded > 0) steps.push({ actions: [], ticks: padded });
  return { steps, captures, inputTicks, padded };
}

/** `["stage=nearly-cleared"]` as `{ stage: "nearly-cleared" }`. */
function parseQuery(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new UsageError(`--query takes key=value, got "${pair}"`);
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

/** `--out <dir>`, emptied first, or a new timestamped folder under .runs/ (the last few are kept). */
function makeRunDir(out: string | undefined): string {
  if (out) {
    const dir = resolve(out);
    if (existsSync(dir) && readdirSync(dir).length > 0 && !existsSync(join(dir, "summary.txt"))) {
      throw new UsageError(`--out ${out} holds files that aren't a see run; pick an empty folder`);
    }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  const runs = join(ROOT, ".runs");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
  const dir = join(runs, stamp);
  mkdirSync(dir, { recursive: true });
  const all = readdirSync(runs).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_RUNS))) {
    rmSync(join(runs, old), { recursive: true, force: true });
  }
  return dir;
}

/** Plays the plan, stopping at each capture tick to screenshot and read the summary. */
async function captureFrames(driver: GameDriver, plan: RunPlan, runDir: string): Promise<Frame[]> {
  const captures = [...plan.captures];
  const frames: Frame[] = [];
  let tick = 0;
  const capture = async () => {
    captures.shift();
    await driver.screenshot(join(runDir, `frame-${tick}.png`));
    frames.push({ tick, summary: await driver.summary() });
  };
  for (const step of plan.steps) {
    await driver.press(step.actions, true);
    let left = step.ticks;
    while (left > 0) {
      while (captures[0] === tick) await capture();
      const nextCapture = captures[0];
      const run =
        nextCapture !== undefined && nextCapture < tick + left ? nextCapture - tick : left;
      await driver.advance(run);
      tick += run;
      left -= run;
    }
    await driver.press(step.actions, false);
  }
  while (captures.length > 0) await capture();
  return frames;
}

/** Runs a scenario's expectations, reading a `todo` scenario's result the other way round. */
async function judge(
  scenario: Scenario,
  result: ScenarioResult,
): Promise<{ text: string; failed: boolean }> {
  if (!scenario.expect) return { text: "ran (no expectations)", failed: false };
  try {
    await scenario.expect(result);
    return scenario.todo
      ? { text: "PASSED, but it is marked todo: remove `todo` if the bug is fixed", failed: false }
      : { text: "PASSED", failed: false };
  } catch (err) {
    if (scenario.todo) return { text: "failed as expected (todo)", failed: false };
    const message = err instanceof Error ? err.message : String(err);
    return { text: `FAILED\n${message.replace(/^/gm, "    ")}`, failed: true };
  }
}

function countEvents(events: { type: string }[]): string {
  if (events.length === 0) return "(none)";
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return [...counts].map(([t, n]) => (n > 1 ? `${t} x${n}` : t)).join(", ");
}

async function main(argv: string[]): Promise<number> {
  const opts = readOptions(argv);
  if (!existsSync(join(ROOT, "dist", "index.html"))) {
    throw new UsageError("No build in dist/. Run bun run build first.");
  }
  const scenario = opts.scenario ? await loadScenario(opts.scenario) : undefined;
  const plan = planRun(scenario, opts);
  const query = { ...scenario?.start?.query, ...parseQuery(opts.query) };
  const seed = opts.seed ?? scenario?.start?.seed;
  const runDir = makeRunDir(opts.out);

  const port = await freePort();
  const server = await preview({
    root: ROOT,
    logLevel: "error",
    preview: { host: "127.0.0.1", port, strictPort: true },
  });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ args: [...CHROMIUM_ARGS] });
    const phone = game.orientation === "landscape" ? "Pixel 7 landscape" : "Pixel 7";
    const context = await browser.newContext({
      ...(opts.mobile ? devices[phone] : { viewport: DESKTOP }),
      baseURL: `http://127.0.0.1:${port}`,
    });
    const driver = new GameDriver(await context.newPage());
    await driver.open({
      query,
      debug: opts.debug,
      touch: opts.mobile,
      ...(seed !== undefined && { seed: Number(seed) }),
      ...(scenario?.start?.scene !== undefined && { scene: scenario.start.scene }),
    });
    if (scenario?.start?.save !== undefined) await driver.loadState(scenario.start.save);

    const frames = await captureFrames(driver, plan, runDir);
    const state = await driver.state();
    const events = await driver.events();
    const problems = await driver.problems();
    writeFileSync(join(runDir, "state.json"), JSON.stringify(state, null, 2));
    writeFileSync(join(runDir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
    writeFileSync(join(runDir, "console.log"), driver.console.join("\n"));
    const verdict = scenario
      ? await judge(scenario, { summary: await driver.summary(), state, events })
      : undefined;

    const total = plan.inputTicks + plan.padded;
    const lines = [
      `run: ${runDir}`,
      `renderer: ${await driver.renderer()}   ticks: ${total}   seed: ${seed ?? 1}${opts.mobile ? "   device: mobile" : ""}`,
      ...(verdict ? [`scenario ${opts.scenario}: ${verdict.text}`] : []),
      ...frames.map((f) => `tick ${f.tick}: ${JSON.stringify(f.summary)}`),
      `events: ${countEvents(events)}`,
      ...(problems.length > 0
        ? ["PROBLEMS:", ...problems.map((p) => `  ${p.kind}: ${p.message.split("\n")[0]}`)]
        : []),
      `files: ${frames.map((f) => `frame-${f.tick}.png`).join(", ")}, state.json, events.jsonl, console.log`,
    ];
    const text = lines.join("\n");
    writeFileSync(join(runDir, "summary.txt"), `${text}\n`);
    process.stderr.write(`${text}\n`);
    process.stdout.write(`${runDir}\n`);
    return verdict?.failed || problems.length > 0 ? 1 : 0;
  } finally {
    await browser?.close();
    await server.close();
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  // parseArgs reports an unknown or malformed flag as a TypeError with an ERR_PARSE_ARGS_* code.
  const code = (err as { code?: unknown }).code;
  const usage =
    err instanceof UsageError || (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS"));
  if (!usage) throw err;
  process.stderr.write(`see: ${(err as Error).message}\n`);
  process.exitCode = 2;
}
