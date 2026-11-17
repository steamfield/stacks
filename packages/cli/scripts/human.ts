#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AGENT_MARKER_NAMES } from "../src/config";
import { shellArg } from "../src/core/text/shell";

export type HumanPlan = { argv: string[]; env: Record<string, string> } | { error: string };

export function humanPlan(options: {
  args: ReadonlyArray<string>;
  command: ReadonlyArray<string>;
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
}): HumanPlan {
  const { command, platform } = options;
  const args = options.args.filter((arg) => arg !== "--allow-launch");
  const sub = args.find((arg) => !arg.startsWith("-"));
  const launchAllowed =
    options.args.includes("--allow-launch") ||
    args.some(
      (arg) =>
        ["--no-launch", "--dry-run", "--json", "--help", "-h"].includes(arg) ||
        arg.startsWith("--launch"),
    );
  if ((sub === "new" || sub === "add") && !launchAllowed) {
    return {
      error:
        "human: new and add launch your coding agent in a terminal; add --no-launch to QA the output, or pass --launch <agent> or --allow-launch to test the launch on purpose.",
    };
  }
  let argv: string[];
  switch (platform) {
    case "darwin":
      argv = ["script", "-q", "/dev/null", ...command, ...args];
      break;
    case "linux":
      argv = ["script", "-qec", [...command, ...args].map(shellArg).join(" "), "/dev/null"];
      break;
    default:
      return { error: "human: needs script(1) on macOS or Linux." };
  }
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.env)) {
    if (value !== undefined && !AGENT_MARKER_NAMES.includes(name)) env[name] = value;
  }
  return { argv, env };
}

if (import.meta.main) {
  const binary = join(import.meta.dirname, "..", "dist", "stacks");
  if (!existsSync(binary)) {
    console.error("human: dist/stacks is missing; run bun run build first.");
    process.exit(2);
  }
  const node = Bun.which("node");
  if (!node) {
    console.error("human: node is not on PATH; Node 22 or newer is required.");
    process.exit(2);
  }
  const plan = humanPlan({
    command: [node, binary],
    args: process.argv.slice(2),
    platform: process.platform,
    env: process.env,
  });
  if ("error" in plan) {
    console.error(plan.error);
    process.exit(2);
  }
  const caller =
    process.env.INIT_CWD || process.env.npm_config_local_prefix || process.env.PWD || process.cwd();
  const child = Bun.spawn(plan.argv, {
    env: plan.env,
    cwd: caller,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      if (child.exitCode === null) child.kill(signal);
    });
  }
  process.exit(await child.exited);
}
