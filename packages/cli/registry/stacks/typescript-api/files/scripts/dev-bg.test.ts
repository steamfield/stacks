import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fixture, makeFixture, REPO } from "./helpers/dev";

// A server stand-in that runs until signaled.
const STUB = `bun -e "setInterval(() => {}, 1000)"`;

let project: Fixture;
let groups: number[] = [];

const freePort = () =>
  new Promise<string>((resolve) => {
    const server = createServer().listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(String(port)));
    });
  });

const groupAlive = (pgid: number) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  project = makeFixture();
  mkdirSync(join(project.dir, "scripts"));
  for (const file of ["dev.ts", "dev-bg.ts", "dev-pid.ts", "dev-logs.ts", "dev-status.ts"]) {
    copyFileSync(join(REPO, "scripts", file), join(project.dir, "scripts", file));
  }
  writeFileSync(
    join(project.dir, "package.json"),
    JSON.stringify({ private: true, scripts: { "dev:server": STUB } }),
  );
});
afterEach(() => {
  for (const pgid of groups) if (groupAlive(pgid)) process.kill(-pgid, "SIGKILL");
  groups = [];
  project.cleanup();
});

describe("dev:stop", { timeout: 30_000 }, () => {
  it("stops the server a SIGKILLed dev session left running", async () => {
    const env = { ...process.env, PORT_API: await freePort() };
    const dev = spawn("bun", ["scripts/dev.ts"], {
      cwd: project.dir,
      env,
      detached: true,
      stdio: "ignore",
    });
    const pidFile = join(project.dir, "logs/dev.pid");
    // dev.ts rewrites the pid file with the server's group once it has spawned it.
    await vi.waitFor(() => {
      groups = readFileSync(pidFile, "utf8").trim().split(/\s+/).slice(2).map(Number);
      expect(groups).toHaveLength(1);
    });
    expect(groups.every(groupAlive)).toBe(true);

    process.kill(dev.pid as number, "SIGKILL");
    await vi.waitFor(() => expect(dev.exitCode ?? dev.signalCode).toBe("SIGKILL"));
    // Its exit handler never ran: the server lives on and the pid file names a dead pid.
    expect(groups.every(groupAlive)).toBe(true);

    const stop = spawnSync("bun", ["scripts/dev-bg.ts", "stop"], {
      cwd: project.dir,
      env,
      encoding: "utf8",
    });
    expect(stop.stderr).toBe("");
    expect(stop.stdout).toContain("Stopped the dev server a killed dev session left running");
    expect(stop.status).toBe(0);
    await vi.waitFor(() => expect(groups.some(groupAlive)).toBe(false));
    expect(existsSync(pidFile)).toBe(false);
  });
});

it("status reports a stopped checkout and points to its readable logs", () => {
  const result = spawnSync("bun", ["scripts/dev-bg.ts", "status"], {
    cwd: project.dir,
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("No dev servers are running from this checkout");
  expect(result.stdout).toContain("bun run logs");
});
