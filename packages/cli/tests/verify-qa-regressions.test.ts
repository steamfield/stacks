import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runCli, terminal } from "./helpers/cli";
import {
  decodeResult,
  envelope,
  splitEvents,
  startedSteps,
  stepNamed,
  verify,
  workspace,
  writeProject,
} from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test.each([undefined, "INFO"])(
  "verify removes CLI settings but preserves manifest LOG_LEVEL=%s and general variables",
  async (level) => {
    const root = space.dir();
    writeProject(root, [{ name: "environment", run: "env > env.txt" }], {
      env: level === undefined ? {} : { LOG_LEVEL: level },
    });
    const result = await verify(["--json"], {
      cwd: root,
      env: {
        LOG_LEVEL: "info",
        STACKS_OFFLINE: "1",
        STACKS_DATA_DIR: join(root, "data"),
        STACKS_STATE_DIR: join(root, "state"),
        STACKS_REGISTRY_DIR: join(root, "registry"),
        STACKS_LOG_FORMAT: "json",
        STACKS_LOG_FILE: join(root, "logs.jsonl"),
        STACKS_TELEMETRY_DISABLED: "1",
        STACKS_TELEMETRY_DEBUG: "1",
        STACKS_TELEMETRY_URL: "http://localhost:1",
        STACKS_INDEX_URL: "http://localhost:1",
        STACKS_DEV_API_URL: "http://localhost:1",
        STACKS_PROJECT_VALUE: "keep",
        COLORTERM: "truecolor",
        FORCE_COLOR: "1",
        CI: "1",
      },
    });
    expect(result.status).toBe(0);
    expect(splitEvents(result.stderr).rest).toBe("");
    expect(decodeResult(result.stdout).totals.passed).toBe(1);
    const env = Object.fromEntries(
      readFileSync(join(root, "env.txt"), "utf8")
        .trim()
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    expect(env.LOG_LEVEL).toBe(level);
    expect(Object.keys(env).filter((name) => name.startsWith("STACKS_"))).toEqual([
      "STACKS_PROJECT_VALUE",
    ]);
    expect(env).toMatchObject({
      STACKS_PROJECT_VALUE: "keep",
      COLORTERM: "truecolor",
      NO_COLOR: "1",
      FORCE_COLOR: "1",
      CI: "1",
      PATH: process.env.PATH,
    });
    expect(env.HOME).toBeTruthy();
  },
);

test("--only explicitly runs a sandbox prod step with setup and teardown", async () => {
  const root = space.dir();
  writeProject(
    root,
    [
      { name: "setup", phase: "setup", run: "echo setup >> order" },
      { name: "prod", tags: ["prod"], skipByDefault: true, run: "echo prod >> order" },
      { name: "other", run: "exit 1" },
      { name: "teardown", phase: "teardown", run: "echo teardown >> order" },
    ],
    { preset: "sandbox" },
  );
  const result = await verify(["--only", "prod", "--json"], { cwd: root });
  expect(result.status).toBe(0);
  expect(splitEvents(result.stderr).rest).toBe("");
  expect(startedSteps(result.stderr)).toEqual(["setup", "prod", "teardown"]);
  const report = decodeResult(result.stdout);
  expect(report).toMatchObject({ outcome: "partial", totals: { passed: 3, skipped: 1 } });
  expect(stepNamed(report, "prod").status).toBe("passed");
  expect(readFileSync(join(root, "order"), "utf8")).toBe("setup\nprod\nteardown\n");
});

test("verify help explains explicit selection and lifecycle phases", async () => {
  const result = await runCli(["verify", "--help"]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.replace(/\s+/g, " ")).toContain(
    "even when the preset skips them by default; setup and teardown still run",
  );
});

test.each(["json", "agent", "human"])(
  "%s failure output strips SGR and CSI sequences without removing ordinary controls",
  async (audience) => {
    const root = space.dir();
    writeProject(root, [
      { name: "color", run: "printf '\\033[32mok\\033[0m\\033[2K\\302\\2331G\\007\\n'; exit 1" },
    ]);
    const result = await verify(audience === "json" ? ["--json"] : [], {
      cwd: root,
      env: { COLORTERM: "truecolor" },
      host: audience === "human" ? terminal : {},
    });
    expect(result.status).toBe(5);
    if (audience === "json") {
      expect(stepNamed(decodeResult(result.stdout), "color").outputTail).toBe("ok\u0007");
      expect(envelope(result.stderr)).toMatchObject({ error: { tag: "VerifyFailed" } });
    } else {
      expect(result.stdout).toContain("| ok\\u0007");
      expect(result.stdout).not.toMatch(/\\u001b|\\u009b/);
      expect(result.stderr).not.toMatch(/\\u001b|\\u009b/);
    }
  },
);

test.each(["agent", "human"])(
  "%s failed verify lists its failures and next step once, with one error line on stderr",
  async (audience) => {
    const root = space.dir();
    writeProject(root, [{ name: "check", run: "exit 1" }]);
    const result = await verify([], { cwd: root, host: audience === "human" ? terminal : {} });
    expect(result.status).toBe(5);
    expect(result.stdout.match(/verify: failed/g)).toHaveLength(1);
    expect(result.stdout.trimEnd()).toMatch(/Next: fix the code or config.*verify again\.$/);
    expect(`${result.stdout}${result.stderr}`.match(/Next:/g)).toHaveLength(1);
    expect(result.stderr.match(/Verify failed\./g)).toHaveLength(1);
    expect(result.stderr).not.toContain("Failed:");
    if (audience === "agent") expect(result.stderr).toBe("> check\nVerify failed.\n");
    else expect(result.stderr).toContain("> check: exit 1\n");
  },
);
