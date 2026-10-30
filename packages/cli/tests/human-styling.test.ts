import { realpathSync } from "node:fs";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { Command } from "effect/cli";
import { TestClock } from "effect/testing";
import { afterEach, expect, test } from "vitest";
import { cli } from "../src/cli";
import { AGENT_MARKER_NAMES } from "../src/config";
import { RESULT_SCHEMAS, type ResultName } from "../src/core/result-schemas";
import { ErrorEnvelope } from "../src/errors";
import { Output } from "../src/services/output";
import { VERSION } from "../src/version";
import { quiet, runCli, terminal } from "./helpers/cli";
import { minimal, writeEntry } from "./helpers/registry";
import { registry as registryResponse } from "./helpers/update";
import { decodeResult, splitEvents, workspace, writeProject } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const ESC = "\u001b";
const sgr = new RegExp(`${ESC}\\[[\\d;]*m`, "g");
const plain = (text: string) => text.replace(sgr, "");
const forced = { ...quiet, NO_COLOR: "", FORCE_COLOR: "1" };
const commands = [
  [],
  ["add"],
  ["create"],
  ["doctor"],
  ["guide"],
  ["list"],
  ["new"],
  ["runs"],
  ["schema"],
  ["show"],
  ["skill", "install"],
  ["update"],
  ["validate"],
  ["verify"],
];

function parserResult(result: Awaited<ReturnType<typeof runCli>>, flag: string, json: boolean) {
  expect(result.status).toBe(flag === "--help" ? 0 : 2);
  expect(result.stdout + result.stderr).not.toContain(ESC);
  if (flag === "--help") {
    expect(result.stdout).not.toBe("");
    expect(result.stderr).toBe("");
  } else {
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
    if (json)
      expect(Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(result.stderr)).error.tag).toBe(
        "Usage",
      );
  }
}

test.each(commands)(
  "help and parser errors for %j retain agent and JSON bytes under FORCE_COLOR [4.4a#1]",
  async (...command) => {
    const home = space.dir();
    for (const json of [false, true]) {
      for (const flag of ["--help", "--not-a-stacks-flag"]) {
        const args = [...command, flag, ...(json ? ["--json"] : [])];
        const run = (env: Record<string, string>) =>
          runCli(args, {
            home,
            env: { ...env, CLAUDECODE: "1" },
            host: terminal,
          });
        const off = await run({ ...quiet, NO_COLOR: "1" });
        const on = await run(forced);
        expect(on).toEqual(off);
        parserResult(on, flag, json);
      }
    }
  },
  10_000, // Eight real parser invocations per command, without child processes or network.
);

const handlerCases: ReadonlyArray<{ args: string[]; status: number; result?: ResultName }> = [
  { args: [], status: 0, result: "guide" },
  { args: ["add", "absent-fragment"], status: 2 },
  { args: ["create", "stack", "Invalid-ID"], status: 2 },
  { args: ["doctor"], status: 0, result: "doctor" },
  { args: ["guide"], status: 0, result: "guide" },
  { args: ["list"], status: 0, result: "list" },
  { args: ["new", "absent-stack", "app", "--no-launch"], status: 2 },
  { args: ["runs"], status: 0, result: "runs" },
  { args: ["schema", "error"], status: 0 },
  { args: ["show", "width-stack"], status: 0, result: "show" },
  { args: ["skill", "install", "--print"], status: 0, result: "skill" },
  { args: ["update", "--check"], status: 0, result: "update" },
  { args: ["validate", "absent-registry"], status: 2 },
  { args: ["verify"], status: 0, result: "verify" },
];

test.each(handlerCases)(
  "real handler $args keeps machine bytes unchanged [4.4a#1]",
  async (row) => {
    const { home, registry } = entry();
    writeProject(home, []);
    for (const json of [false, true]) {
      const args = [...row.args, ...(json ? ["--json"] : [])];
      // The empty verify's durations and dates are fixed; all other cases read or refuse to write.
      const program = Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2026, 9, 27));
        yield* Command.runWith(cli, { version: VERSION, renderErrors: false })(args);
      }).pipe(Effect.provide(TestClock.layer()));
      const run = (env: Record<string, string>) =>
        runCli(args, {
          home,
          program,
          env: { ...env, CLAUDECODE: "1" },
          http: registryResponse({ body: { version: VERSION } }).http,
          host: { registry, ...terminal, skill: join(import.meta.dirname, "..", "skills") },
        });
      const off = await run({ ...quiet, NO_COLOR: "1" });
      const on = await run(forced);
      expect(on).toEqual(off);
      expect(on.status).toBe(row.status);
      expect(on.stdout + on.stderr).not.toContain(ESC);
      if (row.status === 0) {
        expect(on.stderr).toBe("");
        expect(on.stdout).not.toBe("");
        if (json && row.result) {
          const schema: Schema.ConstraintDecoder<unknown> = RESULT_SCHEMAS[row.result].schema;
          Schema.decodeUnknownSync(schema)(JSON.parse(on.stdout));
        }
      } else {
        expect(on.stdout).toBe("");
        expect(on.stderr).not.toBe("");
        if (json) Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(on.stderr));
      }
    }
  },
  10_000,
); // Four real invocations per handler; update uses the existing registry boundary fake.

test("a real failing verify keeps its report and event bytes in machine modes [4.4a#1]", async () => {
  const home = realpathSync(space.dir());
  writeProject(home, [{ name: "lint", run: "printf 'child-output\\n'; exit 1" }]);
  for (const json of [false, true]) {
    const args = ["verify", ...(json ? ["--json"] : [])];
    const program = Effect.gen(function* () {
      yield* TestClock.setTime(Date.UTC(2026, 9, 27));
      yield* Command.runWith(cli, { version: VERSION, renderErrors: false })(args);
    }).pipe(Effect.provide(TestClock.layer()));
    const run = (env: Record<string, string>) =>
      runCli(args, {
        home,
        program,
        env: { ...env, CLAUDECODE: "1" },
        host: terminal,
      });
    const on = await run(forced);
    expect(on).toEqual(await run({ ...quiet, NO_COLOR: "1" }));
    expect(on.status).toBe(5);
    expect(on.stdout + on.stderr).not.toContain(ESC);
    if (json) {
      expect(decodeResult(on.stdout).totals).toEqual({ passed: 0, failed: 1, skipped: 0 });
      const { events, rest } = splitEvents(on.stderr);
      expect(events.map((event) => event.event)).toEqual(["step-started", "step-finished"]);
      expect(Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(rest)).error.tag).toBe(
        "VerifyFailed",
      );
    } else {
      expect(on.stdout).toContain("child-output");
      expect(on.stderr).toContain("> lint\n");
      expect(on.stderr).toContain("Verify failed.");
    }
  }
});

test("styling, live events and progress retain exact machine bytes [4.4a#1]", async () => {
  const home = space.dir();
  const program = Effect.gen(function* () {
    const output = yield* Output;
    const text = output.style("ok", "passed");
    yield* output.progress("writing files");
    yield* output.event({ event: "step-started", name: "lint" }, "> lint");
    yield* Effect.scoped(output.live("lint"));
    yield* output.result({ status: text }, text);
  });
  for (const json of [false, true]) {
    const args = json ? ["--json"] : [];
    const run = (env: Record<string, string>) =>
      runCli(args, {
        home,
        program,
        env,
        host: { stdoutIsTTY: false },
      });
    const on = await run(forced);
    expect(on).toEqual(await run({ ...quiet, NO_COLOR: "1" }));
    expect(on).toEqual({
      status: 0,
      stdout: json ? '{"status":"passed"}\n' : "passed\n",
      stderr: json ? '{"event":"step-started","name":"lint"}\n' : "> lint\n",
    });
    expect(on.stdout + on.stderr).not.toContain(ESC);
    if (json) expect(JSON.parse(on.stdout)).toEqual({ status: "passed" });
  }
});

test("a human's failing verify colors failed and Next, with NO_COLOR taking precedence [4.4a#2]", async () => {
  const root = realpathSync(space.dir());
  writeProject(root, [{ name: "lint", run: "exit 1" }]);
  const run = (env: Record<string, string>) =>
    runCli(["verify"], {
      home: space.dir(),
      host: { ...terminal, cwd: root },
      env: { PATH: process.env.PATH, ...env },
    });
  const colored = await run(forced);
  expect(colored.status).toBe(5);
  const row = colored.stdout
    .split("\n")
    .find((line) => plain(line).match(/^\s+failed\s+check\s+lint/));
  expect(row).toMatch(new RegExp(`${ESC}\\[[\\d;]*mfailed\\s*${ESC}\\[[\\d;]*m`));
  const next = colored.stdout.split("\n").find((line) => plain(line).startsWith("Next:"));
  expect(next).toContain(ESC);
  expect(plain(colored.stderr)).toContain("Verify failed.");
  const uncolored = await run({ ...forced, NO_COLOR: "1" });
  expect(uncolored.status).toBe(5);
  expect(uncolored.stdout).toMatch(/failed\s+check\s+lint/);
  expect(uncolored.stderr).toContain("Verify failed.");
  expect(uncolored.stdout + uncolored.stderr).not.toContain(ESC);
});

test("a pipe without FORCE_COLOR stays plain [4.4a#3]", async () => {
  const result = await runCli(["show", "missing-stack"], {
    home: space.dir(),
    host: { stdoutIsTTY: false },
    env: { ...quiet, NO_COLOR: "" },
  });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Next:");
  expect(result.stderr).not.toContain(ESC);
});

const kinds = ["error", "warn", "ok", "skip", "dim", "next"] as const;
const styledProgram = Effect.gen(function* () {
  const output = yield* Output;
  const words = kinds.map((kind) => output.style(kind, kind));
  yield* output.result({ words }, words.join(" "));
});

test("a human terminal colors automatically without FORCE_COLOR [4.4a#2] [4.4a#8]", async () => {
  const result = await runCli([], {
    program: styledProgram,
    host: terminal,
    env: { ...quiet, NO_COLOR: "", FORCE_COLOR: undefined },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(plain(result.stdout)).toBe(`${kinds.join(" ")}\n`);
  expect(result.stdout).toContain(ESC);
});

test("empty NO_COLOR allows all styles and each invocation makes its own decision [4.4a#8]", async () => {
  const run = (env: Record<string, string | undefined>) =>
    runCli([], {
      program: styledProgram,
      host: terminal,
      env: { ...quiet, ...env },
    });
  for (const noColor of [undefined, "", "1", "0", " ", ""]) {
    const result = await run({ NO_COLOR: noColor, FORCE_COLOR: "1" });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(plain(result.stdout)).toBe(`${kinds.join(" ")}\n`);
    if (noColor) expect(result.stdout).not.toContain(ESC);
    else
      for (const kind of kinds)
        expect(result.stdout).toMatch(new RegExp(`\\u001b\\[[\\d;]*m${kind}\\u001b\\[[\\d;]*m`));
  }
});

test.each(AGENT_MARKER_NAMES)(
  "inherited %s suppresses all forced styles even on a TTY [4.4a#8]",
  async (marker) => {
    const value = marker === "CURSOR_EXTENSION_HOST_ROLE" ? "agent-exec" : "1";
    const result = await runCli([], {
      program: styledProgram,
      host: terminal,
      env: { ...forced, [marker]: value },
    });
    expect(result).toEqual({ status: 0, stdout: `${kinds.join(" ")}\n`, stderr: "" });
  },
);

const paragraph = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";
function entry() {
  const home = realpathSync(space.dir());
  const registry = join(home, "registry");
  writeEntry({
    root: registry,
    kind: "stack",
    dir: "width-stack",
    frontmatter: minimal("stack", "width-stack").replace("width-stack description.", paragraph),
    body: `${paragraph}\n\n  indented code stays on its own long line\n- a list item stays on its own long line\n`,
  });
  return { home, registry };
}

test.each([["guide"], ["show", "width-stack"], ["list"]])(
  "%j wraps human prose at injected columns and leaves agent bytes alone [4.4a#10]",
  async (...args) => {
    const { home, registry } = entry();
    const run = (columns: Option.Option<number>, human = true) =>
      runCli(args, {
        home,
        env: quiet,
        host: {
          registry,
          stdoutIsTTY: human,
          columns,
          stringWidth: (s: string) => plain(s).length,
        },
      });
    const narrow = await run(Option.some(28));
    const unknown = await run(Option.none());
    expect(narrow.status).toBe(0);
    expect(narrow.stderr).toBe("");
    expect(unknown.status).toBe(0);
    expect(unknown.stderr).toBe("");
    expect(narrow.stdout).not.toBe(unknown.stdout);
    expect(narrow.stdout.split(/\s+/)).toEqual(unknown.stdout.split(/\s+/));
    const prose = renderedProse(args[0], narrow.stdout);
    expect(prose.length).toBeGreaterThan(1);
    for (const line of prose) {
      if (line.length > 28) expect(line.trim().split(/\s+/)).toHaveLength(1);
    }
    const agent = await run(Option.some(28), false);
    expect(agent.status).toBe(0);
    expect(agent.stderr).toBe("");
    expect(agent).toEqual(await run(Option.none(), false));
    expect(unknown).toEqual(
      await runCli(args, { home, env: quiet, host: { registry, ...terminal } }),
    );
  },
);

function renderedProse(command: string | undefined, text: string): string[] {
  if (command === "list") return text.split("\n").filter((line) => line.startsWith("    "));
  if (command === "show") {
    const guidance = text.split("--- guidance ---\n")[1];
    if (guidance === undefined) throw new Error("show omitted its guidance");
    return (guidance.split("\n\n")[0] ?? "").split("\n");
  }
  return text.split("\n").filter((line) => line && !/^(?:\s|-|\d+\.)/.test(line));
}

test("list accounts for indentation and injected Unicode display width [4.4a#10]", async () => {
  const { home, registry } = entry();
  const description = "界界界 界界界 é é 界界界 界界界";
  writeEntry({
    root: registry,
    kind: "stack",
    dir: "width-stack",
    frontmatter: minimal("stack", "width-stack").replace("width-stack description.", description),
  });
  const measure = (s: string) =>
    Array.from(plain(s).replaceAll("界", "xx").replaceAll("\u0301", "")).length;
  const result = await runCli(["list"], {
    home,
    env: quiet,
    host: { registry, ...terminal, columns: Option.some(20), stringWidth: measure },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const rows = renderedProse("list", result.stdout);
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.join(" ").trim().split(/\s+/)).toEqual(description.split(" "));
  for (const row of rows) expect(measure(row)).toBeLessThanOrEqual(20);
});
