/**
 * Runs the development wrapper and log reader against temporary output.
 * These smoke tests check saved terminal output and the text and JSON log views.
 */

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { makeFixture } from "./helpers/dev";

it("writes dev output to logs and reads it as text and JSON", async () => {
  const project = makeFixture("dev.ts", "dev-pid.ts", "dev-logs.ts", "logs.ts");
  const print = `bun -e 'console.log("smoke output");setInterval(()=>{},1000)'`;
  writeFileSync(
    join(project.dir, "package.json"),
    JSON.stringify({ private: true, scripts: { "dev:server": print } }),
  );
  const dev = spawn("bun", ["scripts/dev.ts"], {
    cwd: project.dir,
    stdio: "ignore",
    env: { ...process.env, PORT_API: "0", PORT_WEB: "0" },
  });
  try {
    await vi.waitFor(
      () =>
        expect(readFileSync(join(project.dir, "logs/dev.log"), "utf8")).toContain("smoke output"),
      { timeout: 10_000 },
    );
    for (const args of [[], ["--json"]]) {
      const logs = spawnSync("bun", ["scripts/logs.ts", ...args], {
        cwd: project.dir,
        encoding: "utf8",
      });
      expect(logs.status, logs.stderr).toBe(0);
      expect(logs.stderr).toBe("");
      expect(logs.stdout).toContain("smoke output");
      if (args.length) {
        const records = logs.stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(records).toContainEqual(expect.objectContaining({ msg: "smoke output" }));
      }
    }
  } finally {
    const closed = new Promise((resolve, reject) => {
      if (dev.exitCode !== null || dev.signalCode !== null) {
        resolve(undefined);
        return;
      }
      dev.once("error", reject);
      dev.once("close", resolve);
    });
    dev.kill("SIGINT");
    try {
      await closed;
    } finally {
      project.cleanup();
    }
  }
}, 20_000);
