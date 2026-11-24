/**
 * `bun run see`: plays the built game headlessly to exact ticks and writes what you need to judge
 * it to a run folder: `frame-<tick>.png` per capture, `summary.txt`, `state.json`,
 * `events.jsonl` and `console.log`. Prints the summary, whose first line is `run: <folder>`.
 *
 *   bun run see --scenario collect-first-coin
 *   bun run see --input "jump _*2 right*60" --at 0,30,end
 *   bun run see --scene play --query stage=near-goal --debug --ascii
 *
 * It serves `dist/` with `vite preview` on a free port and never builds: run `bun run build` after
 * a change first (it refuses a `dist/` older than `src/`). Exit 0 when the run is clean, 1 when a
 * scenario expectation failed or the page reported a problem, 2 for a usage error.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type BrowserContextOptions, chromium, devices } from "@playwright/test";
import { preview } from "vite";
import { input as gameInput } from "../src/engine/input.ts";
import { GAME } from "../src/game.ts";
import { CHROMIUM_ARGS } from "../tests/support/chromium-args.ts";
import { GameDriver, type Problem } from "../tests/support/driver.ts";
import { type InputStep, parseInput, type Scenario } from "../tests/support/scenario.ts";
import { loadScenarioFile, scenarioFiles } from "../tests/support/scenario-files.ts";

const ROOT = resolve(import.meta.dirname, "..");
const RUNS_DIR = join(ROOT, ".runs");
const KEEP_RUNS = 20;
const DESKTOP_VIEWPORT = { width: 960, height: 540 };

const USAGE = `Usage: bun run see [options]
  --scenario <name>   play scenarios/<name>.ts and check its expectations
  --input "<steps>"   input after the scenario: jump, right*30, right+jump*10, _*20 (wait)
  --at <ticks>        capture ticks, comma-separated; "end" is the last input tick (default: end)
  --seed <n>          launch seed (default 1)
  --scene <name>      launch ?scene=
  --query k=v         extra launch parameter, repeatable (e.g. stage=near-goal)
  --debug             launch with ?debug=1
  --mobile            a Pixel 7 held the game's way, with touch controls
  --ascii             print the world's ASCII view
  --out <dir>         write the run here instead of .runs/<timestamp>`;

/** A mistake in how see was called. Printed with the usage; exit 2. */
class UsageError extends Error {}

interface Options {
  scenario?: string;
  input?: string;
  at?: string;
  seed?: string;
  scene?: string;
  query: string[];
  debug: boolean;
  mobile: boolean;
  ascii: boolean;
  out?: string;
}

/** The input to play and the ticks to stop and capture at. */
interface RunPlan {
  steps: InputStep[];
  /** Ticks to capture at, ascending and unique. */
  captures: number[];
  inputTicks: number;
}

interface Frame {
  tick: number;
  file: string;
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
      scene: { type: "string" },
      query: { type: "string", multiple: true, default: [] },
      debug: { type: "boolean", default: false },
      mobile: { type: "boolean", default: false },
      ascii: { type: "boolean", default: false },
      out: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!values.scenario && !values.input && !values.scene) {
    throw new UsageError("Name a --scenario, an --input or a --scene to look at.");
  }
  return values as Options;
}

/** Refuses a missing `dist/` or one older than the newest file under `src/`. */
function checkBuild(): void {
  const built = join(ROOT, "dist", "index.html");
  if (!existsSync(built)) throw new UsageError("No build in dist/. Run `bun run build` first.");
  const builtAt = statSync(built).mtimeMs;
  if (newestMtime(join(ROOT, "src")) > builtAt) {
    throw new UsageError("dist/ is older than src/. Run `bun run build` first.");
  }
}

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile())
      newest = Math.max(newest, statSync(join(entry.parentPath, entry.name)).mtimeMs);
  }
  return newest;
}

async function loadScenario(name: string): Promise<Scenario> {
  const file = `${name.replace(/\.ts$/, "")}.ts`;
  const known = scenarioFiles();
  if (!known.includes(file)) {
    const names = known.map((f) => f.replace(/\.ts$/, "")).join(", ");
    throw new UsageError(`No scenario "${name}". Known: ${names || "(none)"}`);
  }
  return loadScenarioFile(file);
}

/**
 * The scenario's input then `--input`, the `--at` capture ticks, and an idle wait so a capture past
 * the input still happens.
 */
function planRun(scenario: Scenario | undefined, options: Options): RunPlan {
  const extra = options.input ? parseInput(options.input, gameInput.actions) : [];
  const steps: InputStep[] = [...(scenario?.input ?? []), ...extra];
  const inputTicks = steps.reduce((n, s) => n + s.ticks, 0);
  const asked = options.at ? options.at.split(",") : ["end"];
  const ticks = asked.map((t) => (t.trim() === "end" ? inputTicks : Number(t)));
  if (ticks.some((t) => !Number.isInteger(t) || t < 0)) {
    throw new UsageError('--at takes non-negative whole ticks or "end", comma-separated');
  }
  const captures = [...new Set(ticks)].sort((a, b) => a - b);
  const last = captures.at(-1) ?? 0;
  if (last > inputTicks) steps.push({ actions: [], ticks: last - inputTicks });
  return { steps, captures, inputTicks };
}

function parseQuery(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new UsageError(`--query takes key=value, got "${pair}"`);
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

/** `--out` emptied (only if it is empty or an earlier run), or a dated folder under `.runs/`. */
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
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
  const dir = join(RUNS_DIR, stamp);
  mkdirSync(dir, { recursive: true });
  const runs = readdirSync(RUNS_DIR).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) {
    rmSync(join(RUNS_DIR, old), { recursive: true, force: true });
  }
  return dir;
}

/** A TCP port on 127.0.0.1 that nothing was listening on a moment ago. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address
          ? done(address.port)
          : fail(new Error("the OS opened a socket but reported no port")),
      );
    });
  });
}

function contextFor(mobile: boolean): BrowserContextOptions {
  if (!mobile) return { viewport: DESKTOP_VIEWPORT };
  return GAME.orientation === "landscape" ? devices["Pixel 7 landscape"] : devices["Pixel 7"];
}

/** Plays the plan's input, stopping at each capture tick to screenshot and read the summary. */
async function captureFrames(driver: GameDriver, plan: RunPlan, runDir: string): Promise<Frame[]> {
  const pending = [...plan.captures];
  const frames: Frame[] = [];
  let tick = 0;
  const captureDue = async () => {
    while (pending[0] === tick) {
      pending.shift();
      const file = join(runDir, `frame-${tick}.png`);
      await driver.screenshot(file);
      frames.push({ tick, file, summary: await driver.summary() });
    }
  };
  for (const step of plan.steps) {
    await driver.inject(step.actions, true);
    let left = step.ticks;
    while (left > 0) {
      await captureDue();
      const next = pending[0] !== undefined && pending[0] < tick + left ? pending[0] - tick : left;
      await driver.advance(next);
      tick += next;
      left -= next;
    }
    await driver.inject(step.actions, false);
  }
  await captureDue();
  return frames;
}

/** Runs a scenario's expectations, reading a `todo` scenario's result the other way round. */
async function judge(
  scenario: Scenario,
  driver: GameDriver,
  events: Awaited<ReturnType<GameDriver["events"]>>,
): Promise<{ text: string; failed: boolean }> {
  if (!scenario.expect) return { text: "ran (no expectations)", failed: false };
  try {
    await scenario.expect({ summary: await driver.summary(), state: await driver.state(), events });
    return scenario.todo
      ? { text: "PASSED, but it is marked todo: remove `todo` if the bug is fixed", failed: false }
      : { text: "PASSED", failed: false };
  } catch (error) {
    if (scenario.todo) return { text: "failed as expected (todo)", failed: false };
    const message = error instanceof Error ? error.message : String(error);
    return { text: `FAILED\n${indent(message)}`, failed: true };
  }
}

function summarizeEvents(events: { type: string }[]): string {
  if (events.length === 0) return "(none)";
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return [...counts].map(([type, n]) => (n > 1 ? `${type} x${n}` : type)).join(", ");
}

const indent = (text: string) =>
  text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

function problemLines(problems: Problem[]): string[] {
  if (problems.length === 0) return [];
  const lines = problems.map((p) => `  ${p.kind}: ${p.message.split("\n")[0]}`);
  return [`PROBLEMS:\n${lines.join("\n")}`];
}

async function run(options: Options): Promise<number> {
  checkBuild();
  const scenario = options.scenario ? await loadScenario(options.scenario) : undefined;
  const plan = planRun(scenario, options);
  const query = { ...scenario?.start?.query, ...parseQuery(options.query) };
  const seed = options.seed ?? scenario?.start?.seed;
  const scene = options.scene ?? scenario?.start?.scene;
  const runDir = makeRunDir(options.out);

  const port = await freePort();
  const server = await preview({
    root: ROOT,
    logLevel: "error",
    preview: { host: "127.0.0.1", port, strictPort: true },
  });
  const browser = await chromium.launch({ args: [...CHROMIUM_ARGS] });
  try {
    const context = await browser.newContext({
      ...contextFor(options.mobile),
      baseURL: `http://127.0.0.1:${port}`,
    });
    const driver = new GameDriver(await context.newPage(), "/");
    await driver.open({
      query,
      debug: options.debug,
      touch: options.mobile,
      ...(seed !== undefined && { seed: Number(seed) }),
      ...(scene !== undefined && { scene }),
    });
    if (scenario?.start?.save !== undefined) await driver.loadState(scenario.start.save);
    const before = (await driver.events()).length;
    const frames = await captureFrames(driver, plan, runDir);

    const state = await driver.state();
    const events = await driver.events();
    const verdict = scenario ? await judge(scenario, driver, events.slice(before)) : undefined;
    const problems = await driver.problems();
    writeFileSync(join(runDir, "state.json"), JSON.stringify(state, null, 2));
    writeFileSync(join(runDir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
    writeFileSync(join(runDir, "console.log"), driver.console.join("\n"));

    const ascii = (state as { ascii?: string } | null)?.ascii;
    const lines = [
      `run: ${runDir}`,
      `renderer: ${await driver.renderer()}   ticks: ${plan.inputTicks}   seed: ${seed ?? 1}${options.mobile ? "   device: mobile" : ""}`,
      ...(scenario && verdict ? [`scenario ${options.scenario}: ${verdict.text}`] : []),
      ...frames.map((f) => `tick ${f.tick}: ${JSON.stringify(f.summary)}`),
      `events: ${summarizeEvents(events)}`,
      ...problemLines(problems),
      ...(options.ascii ? [`ascii:\n${ascii ?? "(no world yet)"}`] : []),
      `files: ${frames.map((f) => `frame-${f.tick}.png`).join(", ")}, state.json, events.jsonl, console.log`,
    ];
    const text = lines.join("\n");
    writeFileSync(join(runDir, "summary.txt"), `${text}\n`);
    console.log(text);
    return verdict?.failed || problems.length > 0 ? 1 : 0;
  } finally {
    await browser.close();
    await server.close();
  }
}

try {
  process.exitCode = await run(readOptions(process.argv.slice(2)));
} catch (error) {
  if (
    error instanceof UsageError ||
    (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
  ) {
    console.error(`see: ${(error as Error).message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
