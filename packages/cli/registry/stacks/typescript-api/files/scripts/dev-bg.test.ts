/**
 * Exercises background development startup and shutdown with temporary servers.
 * These smoke tests check that the process wrapper manages only this checkout's processes.
 */

import { type SpawnSyncReturns, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { makeFixture } from "./helpers/dev";

const SCRIPTS = ["dev.ts", "dev-bg.ts", "dev-pid.ts", "dev-logs.ts", "dev-status.ts"];

type Run = SpawnSyncReturns<string>;

/** Whether `port` can be bound on all IPv4 interfaces right now (Bun.serve's default). */
function bindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "0.0.0.0", () => server.close(() => resolve(true)));
  });
}

// A free port below every OS's ephemeral range (Linux starts at 32768, macOS at 49152), so the
// port-0 listeners other test files open in parallel can't be handed it between this check and
// dev.ts binding it.
async function quietPort(): Promise<string> {
  for (let tries = 0; tries < 50; tries++) {
    const port = 20_000 + Math.floor(Math.random() * 10_000);
    if (await bindable(port)) return String(port);
  }
  throw new Error("No free port in 20000-29999");
}

// A dev:server that serves /healthz on PORT_API.
const SERVER = `Bun.serve({ port: Number(process.env.PORT_API), fetch: () => new Response("ok") });\n`;

// A dev:server that answers 503 while a file named "unhealthy" exists in the project.
const FLAKY_SERVER = `import { existsSync } from "node:fs";
Bun.serve({
  port: Number(process.env.PORT_API),
  fetch: () => (existsSync("unhealthy") ? new Response("down", { status: 503 }) : new Response("ok")),
});
`;

// A dev:server whose listener is a child that doesn't hold dev.ts's pipes and takes a second to
// exit after SIGINT or SIGTERM, so it outlives dev.ts. stop must wait for it.
const PARENT = `import { spawn } from "node:child_process";
spawn(process.execPath, ["slow-server.ts"], { stdio: "ignore" });
setInterval(() => {}, 1 << 30);
`;
const SLOW_CHILD = `const server = Bun.serve({ port: Number(process.env.PORT_API), fetch: () => new Response("ok") });
// Once the listener and the signal handlers are gone, nothing keeps the process alive.
const stopSoon = () => setTimeout(() => {
  server.stop(true);
  process.removeAllListeners("SIGINT");
  process.removeAllListeners("SIGTERM");
}, 1000);
process.on("SIGINT", stopSoon);
process.on("SIGTERM", stopSoon);
`;

function project(files: Record<string, string>) {
  const fixture = makeFixture(...SCRIPTS);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(fixture.dir, name), text);
  writeFileSync(
    join(fixture.dir, "package.json"),
    JSON.stringify({ private: true, scripts: { "dev:server": "bun server.ts" } }),
  );
  return fixture;
}

type Recorded = { owner?: number; groups: number[] };

function recorded(dir: string): Recorded {
  const file = join(dir, "logs/dev.pid");
  if (!existsSync(file)) return { groups: [] };
  const record = JSON.parse(readFileSync(file, "utf8")) as {
    pid: number;
    groups: { pid: number }[];
  };
  return { owner: record.pid, groups: record.groups.map((group) => group.pid) };
}

// SIGKILL what a failed test left behind. Only called when stop didn't succeed, so a pid that
// was already stopped (and may be reused) is never signaled.
function kill({ owner, groups }: Recorded): void {
  for (const pid of [...groups.map((group) => -group), ...(owner ? [owner] : [])]) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

type Cycle = {
  start: Run;
  during: Run[];
  stop?: Run;
  started: Recorded;
  pidFileLeft: boolean;
  portFree: boolean;
};

/** Starts, runs `during` while the server is up, stops, and reports; asserts nothing. */
async function cycle(
  files: Record<string, string>,
  during: (run: (command: string, env?: NodeJS.ProcessEnv) => Run, dir: string) => Run[] = () => [],
): Promise<Cycle & { port: string }> {
  const fixture = project(files);
  const port = await quietPort();
  const env = { ...process.env, PORT_API: port };
  const run = (command: string, extra: NodeJS.ProcessEnv = {}) =>
    spawnSync("bun", ["scripts/dev-bg.ts", command], {
      cwd: fixture.dir,
      env: { ...env, ...extra },
      encoding: "utf8",
      timeout: 110_000,
    });
  let result: (Cycle & { port: string }) | undefined;
  try {
    const start = run("start");
    const started = recorded(fixture.dir);
    const extra = start.status === 0 ? during(run, fixture.dir) : [];
    const stop = run("stop");
    result = {
      port,
      start,
      during: extra,
      stop,
      started,
      portFree: await bindable(Number(port)),
      pidFileLeft: existsSync(join(fixture.dir, "logs/dev.pid")),
    };
    return result;
  } finally {
    if (result?.stop?.status !== 0) kill(recorded(fixture.dir));
    fixture.cleanup();
  }
}

const output = (run: Run | undefined) => `${run?.stdout ?? ""}${run?.stderr ?? ""}`;

it("starts a background dev server, refuses another port, and stops its processes", async () => {
  // An empty PORT_API asks for the default port, 3000, which the recorded server isn't on.
  const result = await cycle({ "server.ts": SERVER }, (run) => [
    run("status"),
    run("start", { PORT_API: "1" }),
    run("start", { PORT_API: "" }),
  ]);
  const [status, otherPort, defaultPort] = result.during;
  expect(result.start.status, output(result.start)).toBe(0);
  expect(result.start.stderr).toBe("");
  expect(result.start.stdout).toContain(`http://localhost:${result.port}`);
  expect(result.started.groups).toHaveLength(1);
  expect(status?.status, output(status)).toBe(0);
  expect(status?.stdout).toContain(result.port);
  expect(otherPort?.status, output(otherPort)).toBe(1);
  expect(otherPort?.stderr).toContain(`running on port ${result.port}`);
  expect(defaultPort?.status, output(defaultPort)).toBe(1);
  expect(defaultPort?.stderr).toContain(`running on port ${result.port}, not 3000`);
  expect(result.stop?.status, output(result.stop)).toBe(0);
  expect(result.stop?.stderr).toBe("");
  expect(result.stop?.stdout).toContain("Stopped");
  expect(result.pidFileLeft).toBe(false);
  for (const group of result.started.groups) {
    expect(() => process.kill(-group, 0)).toThrow(/ESRCH/);
  }
}, 240_000);

it("returns from stop only once a server process that outlives dev.ts has freed the port", async () => {
  const result = await cycle({ "server.ts": PARENT, "slow-server.ts": SLOW_CHILD });
  expect(result.start.status, output(result.start)).toBe(0);
  expect(result.stop?.status, output(result.stop)).toBe(0);
  expect(result.portFree).toBe(true);
}, 240_000);

it("fails at once when the recorded server doesn't answer, naming the stop command", async () => {
  let elapsed = Number.POSITIVE_INFINITY;
  const result = await cycle({ "server.ts": FLAKY_SERVER }, (run, dir) => {
    writeFileSync(join(dir, "unhealthy"), "");
    const began = Date.now();
    const again = run("start");
    elapsed = Date.now() - began;
    return [again];
  });
  const [again] = result.during;
  expect(result.start.status, output(result.start)).toBe(0);
  expect(again?.status, output(again)).toBe(1);
  expect(again?.stderr).toContain("HTTP 503");
  expect(again?.stderr).toContain("bun run dev:stop");
  expect(elapsed).toBeLessThan(10_000);
  expect(result.stop?.status, output(result.stop)).toBe(0);
}, 240_000);

it("stops the server it was starting when interrupted", async () => {
  const fixture = project({ "server.ts": PARENT, "slow-server.ts": SLOW_CHILD });
  const port = await quietPort();
  let started: Recorded = { groups: [] };
  let exit: number | null | undefined;
  try {
    // A health URL that never answers keeps start waiting: the child serves PORT_API, but start
    // polls PORT_API too, so make the server listen elsewhere.
    writeFileSync(
      join(fixture.dir, "slow-server.ts"),
      SLOW_CHILD.replace("process.env.PORT_API", "process.env.OTHER_PORT"),
    );
    const otherPort = await quietPort();
    const starter = spawn("bun", ["scripts/dev-bg.ts", "start"], {
      cwd: fixture.dir,
      env: { ...process.env, PORT_API: port, OTHER_PORT: otherPort },
      stdio: "ignore",
    });
    const exited = new Promise<number | null>((resolve) => starter.on("exit", resolve));
    await vi.waitFor(
      () => {
        started = recorded(fixture.dir);
        expect(started.groups).toHaveLength(1);
      },
      { timeout: 30_000, interval: 100 },
    );
    starter.kill("SIGTERM");
    exit = await exited;
    expect(exit).toBe(130);
    expect(existsSync(join(fixture.dir, "logs/dev.pid"))).toBe(false);
    for (const group of started.groups) {
      expect(() => process.kill(-group, 0)).toThrow(/ESRCH/);
    }
    expect(await bindable(Number(otherPort))).toBe(true);
  } finally {
    if (exit !== 130) kill(started);
    fixture.cleanup();
  }
}, 120_000);
