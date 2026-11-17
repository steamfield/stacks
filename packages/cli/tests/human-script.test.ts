import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, openSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { humanPlan } from "../scripts/human";
import { AGENT_MARKER_NAMES } from "../src/env-names";
import { tempDir } from "./helpers/cli";

const launchError =
  "human: new and add launch your coding agent in a terminal; add --no-launch to QA the output, or pass --launch <agent> or --allow-launch to test the launch on purpose.";

test("human output removes every agent marker and undefined values, keeping other variables", () => {
  const env: Record<string, string | undefined> = {
    ...Object.fromEntries(AGENT_MARKER_NAMES.map((name) => [name, "1"])),
    KEEP: "1",
    UNSET: undefined,
  };
  const plan = humanPlan({ args: ["guide"], command: ["stacks"], platform: "darwin", env });
  if ("error" in plan) throw new Error(plan.error);
  expect(plan.env).toEqual({ KEEP: "1" });
  for (const name of AGENT_MARKER_NAMES) expect(env[name]).toBe("1");
  expect(env).toHaveProperty("UNSET", undefined);
});

const launching = [
  ["new", "typescript-cli", "p"],
  ["add", "rr"],
];

test.each(launching)("refuses an unintended agent launch: %j", (...args) => {
  expect(humanPlan({ args, command: ["stacks"], platform: "darwin", env: {} })).toEqual({
    error: launchError,
  });
});

const safeFlags = [
  ["--no-launch"],
  ["--dry-run"],
  ["--json"],
  ["--help"],
  ["-h"],
  ["--launch", "claude"],
  ["--launch=claude"],
];

test.each(launching.flatMap((args) => safeFlags.map((flags) => [[...args, ...flags]])))(
  "allows a guarded or deliberate agent launch: %j",
  (args) => {
    expect(humanPlan({ args, command: ["stacks"], platform: "darwin", env: {} })).toEqual({
      argv: ["script", "-q", "/dev/null", "stacks", ...args],
      env: {},
    });
  },
);

test.each([["list"], ["guide"], ["show", "typescript-cli"], ["--json", "new", "x"]])(
  "allows read commands and flag-first JSON output: %j",
  (...args) => {
    expect(humanPlan({ args, command: ["stacks"], platform: "darwin", env: {} })).toEqual({
      argv: ["script", "-q", "/dev/null", "stacks", ...args],
      env: {},
    });
  },
);

test("macOS passes arguments with spaces and quotes directly to script", () => {
  expect(
    humanPlan({
      args: ["show", "it's"],
      command: ["/q s/bin"],
      platform: "darwin",
      env: {},
    }),
  ).toEqual({ argv: ["script", "-q", "/dev/null", "/q s/bin", "show", "it's"], env: {} });
});

test("Linux shell-quotes every command and argument for script", () => {
  expect(
    humanPlan({ args: ["show", "it's"], command: ["/q s/bin"], platform: "linux", env: {} }),
  ).toEqual({ argv: ["script", "-qec", "'/q s/bin' show 'it'\\''s'", "/dev/null"], env: {} });
});

test("unsupported platforms explain the script requirement", () => {
  expect(humanPlan({ args: ["guide"], command: ["stacks"], platform: "win32", env: {} })).toEqual({
    error: "human: needs script(1) on macOS or Linux.",
  });
});

const hasScript = spawnSync("which", ["script"], { encoding: "utf8" }).status === 0;

test.skipIf(!hasScript)(
  "stripping markers makes a real pseudo-terminal render the guide for a human",
  () => {
    const dir = tempDir();
    const stdin = openSync("/dev/null", "r");
    try {
      const home = realpathSync(dir.path);
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        XDG_CONFIG_HOME: join(home, "config"),
        XDG_DATA_HOME: join(home, "data"),
        XDG_STATE_HOME: join(home, "state"),
        CLAUDECODE: "1",
        CODEX_SANDBOX: "1",
      };
      const bunPath = execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
      const plan = humanPlan({
        command: [
          bunPath,
          "--no-env-file",
          "--config=/dev/null",
          join(import.meta.dirname, "../src/bin.ts"),
        ],
        args: ["guide"],
        platform: process.platform,
        env,
      });
      if ("error" in plan) throw new Error(plan.error);
      const [command, ...args] = plan.argv;
      if (command === undefined) throw new Error("missing script command");
      for (const [childEnv, human] of [
        [plan.env, true],
        [env, false],
      ] as const) {
        const result = spawnSync(command, args, {
          env: childEnv,
          cwd: home,
          stdio: [stdin, "pipe", "pipe"],
          encoding: "utf8",
          timeout: 30_000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        const stdout = result.stdout.replaceAll("\r\n", "\n").replace(/^\^D/, "");
        const lead =
          'This guide is written for coding agents. To start a project yourself, run stacks search "<what you want to build>", then stacks new <stack> <dir>; stacks --help lists every command.';
        expect(stdout.includes(lead)).toBe(human);
        expect(stdout).toContain("stacks starts projects for coding agents.");
      }
    } finally {
      closeSync(stdin);
      dir.cleanup();
    }
  },
  // Each of the two real subprocess runs has a 30 s timeout.
  65_000,
);
