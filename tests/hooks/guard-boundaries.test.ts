import { describe, expect, it } from "vitest";
import { denyReason, REPO, runHook, write } from "../helpers/hooks";

const check = (path: string, content: string) =>
  runHook("PreToolUse", "guard-boundaries", write(`${REPO}/${path}`, content));
describe("CLI platform boundaries", () => {
  it.each([
    ["packages/cli/src/core/doctor.ts", 'import { $ } from "bun";'],
    ["packages/cli/src/services/Host.ts", "const p = Bun.argv;"],
    ["packages/cli/src/main.ts", "process.stdout.write('x');"],
    ["packages/cli/src/core/doctor.ts", "process.env.SECRET;"],
    ["packages/cli/src/main.ts", "console.log('x');"],
    ["packages/cli/src/services/Output.ts", "process.stderr.write('x');"],
    ["packages/cli/src/core/doctor.ts", 'process.kill(1, "SIGTERM");'],
    ["packages/cli/src/services/processes.ts", 'process.on("SIGINT", () => {});'],
    ["packages/cli/src/main.ts", "process.exit(1);"],
    ["packages/cli/src/main.ts", 'process.once("exit", () => {});'],
    ["packages/cli/src/main.ts", "process.removeListener('SIGINT', f);"],
    ["packages/cli/src/core/doctor.ts", 'import { spawn } from "node:child_process";'],
    ["packages/cli/src/core/doctor.ts", 'import { spawn } from "child_process";'],
    ["packages/cli/src/runtime.ts", 'import { NodeServices } from "@effect/platform-node";'],
    ["packages/cli/src/core/doctor.ts", 'import { kill } from "node:process";'],
    ["packages/cli/src/core/doctor.ts", 'import { NetLayer } from "../platform/net";'],
    ["packages/cli/src/core/verify/run.ts", 'import type { root } from "../../commands/root";'],
    ["packages/cli/src/services/host.ts", 'export * from "../platform/width";'],
    ["packages/cli/src/services/processes.ts", 'export { spawnChild } from "../platform/process";'],
    ["packages/cli/src/core/doctor.ts", 'import { readFile } from "node:fs";'],
    ["packages/cli/src/core/doctor.ts", 'import { homedir } from "os";'],
    ["packages/cli/src/core/fingerprint.ts", 'import { readFile } from "node:fs/promises";'],
    ["packages/cli/src/core/scaffold/new.ts", 'import { rmdir } from "node:fs/promises";'],
  ])("denies %s: %s", async (path, content) =>
    expect(denyReason(await check(path, content))).toBeDefined(),
  );
  it.each([
    ["packages/cli/src/bin.ts", 'import { BunRuntime } from "@effect/platform-bun";'],
    ["packages/cli/src/platform/host.ts", "const p = Bun.argv;"],
    ["packages/cli/src/config.ts", "const e = process.env;"],
    ["packages/cli/src/logging.ts", "process.stderr.write('x');"],
    ["packages/cli/src/core/doctor.ts", "// console.log('example')"],
    ["packages/cli/src/platform/process.ts", 'import { spawn } from "node:child_process";'],
    ["packages/cli/src/platform/signals.ts", 'process.on("SIGINT", () => {}); process.exit(130);'],
    ["packages/cli/src/bin.ts", 'process.kill(process.pid, "SIGQUIT");'],
    ["packages/cli/src/core/doctor.ts", "const killed = processes.kill;"],
    ["packages/cli/src/core/doctor.ts", "// process.kill(1)"],
    ["packages/api/src/server.ts", "const p = Bun.serve;"],
    ["packages/shared/src/index.ts", "console.log('x');"],
    ["src/core/doctor.ts", "console.log('x');"],
    ["packages/cli/src/services/processes.ts", 'import { spawnChild } from "../platform/process";'],
    ["packages/cli/src/core/doctor.ts", 'import { Host } from "../services/host";'],
    ["packages/cli/src/core/platform/thing.ts", 'import { x } from "./helper";'],
    ["packages/cli/src/core/manifest.ts", 'import { createHash } from "node:crypto";'],
    ["packages/cli/src/services/output.ts", 'import { styleText } from "node:util";'],
    ["packages/cli/src/core/scaffold/write.ts", 'import { rmdir } from "node:fs/promises";'],
    ["packages/cli/src/commands/verify.ts", 'import { NetLayer } from "../platform/net";'],
  ])("allows %s: %s", async (path, content) =>
    expect(denyReason(await check(path, content))).toBeUndefined(),
  );
});
