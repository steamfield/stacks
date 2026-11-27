import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { adapterWorkspace, scaffoldAdapters } from "../helpers/native-adapters";
import { bundled } from "./helpers/bundled";

const space = adapterWorkspace();
const children: ChildProcess[] = [];
const projects: string[] = [];

async function cleanupChildren() {
  const pending = children.splice(0);
  for (const child of pending) {
    if (running(child)) child.kill("SIGTERM");
  }
  await Promise.all(pending.map(waitExit));
  for (const project of projects) reapFixture(project);
  for (const child of pending) {
    if (running(child) && child.pid) killOwned(-child.pid);
  }
  await Promise.all(pending.map(waitExit));
}

function running(child: ChildProcess) {
  return child.exitCode === null && child.signalCode === null;
}

async function waitExit(child: ChildProcess) {
  if (!running(child)) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      child.removeListener("exit", done);
      resolve();
    };
    const timer = setTimeout(done, 500);
    child.once("exit", done);
  });
}

function killOwned(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    // macOS can answer EPERM while an owned group's last members are zombies.
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error.code !== "ESRCH" && error.code !== "EPERM")
    )
      throw error;
  }
}

function reapFixture(project: string) {
  for (const name of ["api", "mobile", "api-child", "mobile-child", "setup-child"]) {
    const file = join(project, `${name}.pid`);
    if (!existsSync(file)) continue;
    const pid = Number(readFileSync(file, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid fixture pid");
    if (name === "api" || name === "mobile") killOwned(-pid);
    killOwned(pid);
  }
}

afterEach(async () => {
  await cleanupChildren();
  // Emergency cleanup also protects the red/revert run of the cleanup regression.
  for (const project of projects.splice(0)) reapFixture(project);
  space.cleanup();
});

async function port() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP address");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

const fakeBun = `
import { spawn } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
const args = process.argv.slice(2);
if (args.includes("db:up") || args.includes("db:migrate")) {
  console.log(args.join(" "));
  if (args.includes(process.env.FAIL_SETUP)) {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    writeFileSync("setup-child.pid", String(child.pid));
  }
  process.exit(args.includes(process.env.FAIL_SETUP) ? 4 : 0);
}
const api = args.includes("./apps/api");
const name = api ? "api" : "mobile";
writeFileSync(name + ".pid", String(process.pid));
const childScript = process.env.RESIST_TERM && api
  ? 'const fs = require("node:fs"); process.on("SIGTERM", () => {}); fs.writeFileSync("api-child.ready", "yes"); setInterval(() => {}, 1000)'
  : "setInterval(() => {}, 1000)";
const child = spawn(process.execPath, ["-e", childScript], {
  stdio: process.env.RETAIN_OUTPUT === "1" ? "inherit" : "ignore",
});
writeFileSync(name + "-child.pid", String(child.pid));
const server = createServer();
server.listen(Number(api ? process.env.PORT_API : process.env.PORT_METRO), "127.0.0.1", () => {
  console.log(name + " ready");
  if (process.env.NO_READY !== "1") writeFileSync(name + ".ready", "yes");
});
setInterval(() => {
  if (existsSync("finish-" + name)) process.exit(api ? 7 : 0);
}, 20);
`;

async function fixture() {
  const home = space.temp();
  const { project } = await scaffoldAdapters({
    registry: bundled,
    home,
    stack: "mobile-expo",
    agents: ["codex"],
  });
  projects.push(project);
  // Never execute the unsafe historical launcher, even during revert verification.
  expect(readFileSync(join(project, "scripts/dev.sh"), "utf8")).not.toMatch(/pkill|reap_all/);
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(project, "fake-bun.mjs"), fakeBun);
  const bun = spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim();
  if (!bun) throw new Error("Bun missing");
  writeFileSync(
    join(bin, "bun"),
    `#!/bin/sh\nif [ "$1" = scripts/dev.ts ]; then exec '${bun}' "$@"; fi\nexec '${process.execPath}' '${join(project, "fake-bun.mjs")}' "$@"\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "xcrun"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const api = await port();
  let metro = await port();
  while (api === metro) metro = await port();
  const env = {
    HOME: home,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    PORT_API: String(api),
    PORT_METRO: String(metro),
  };
  return { project, env, api, metro };
}

function launch(project: string, env: Record<string, string>) {
  const child = spawn("bash", ["scripts/dev.sh"], {
    cwd: project,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (data) => {
    stdout += data.toString();
  });
  child.stderr?.on("data", (data) => {
    stderr += data.toString();
  });
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { child, finished, output: () => stdout + stderr };
}

async function ready(project: string) {
  await vi.waitFor(
    () => {
      for (const name of ["api", "mobile"])
        expect(existsSync(join(project, `${name}.ready`))).toBe(true);
    },
    { timeout: 10_000 },
  );
}

async function gone(project: string) {
  await vi.waitFor(
    () => {
      for (const name of ["api", "api-child", "mobile", "mobile-child", "setup-child"]) {
        const file = join(project, `${name}.pid`);
        if (!existsSync(file)) continue;
        expect(() => process.kill(Number(readFileSync(file, "utf8")), 0)).toThrow();
      }
    },
    { timeout: 10_000 },
  );
}

test.each(["normal", "signal", "hangup", "api-failure"] as const)(
  "mobile dev cleans owned groups after %s",
  async (mode) => {
    const f = await fixture();
    const unrelated = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)", "filter ./apps/api dev"],
      { detached: true, stdio: "ignore" },
    );
    children.push(unrelated);
    const run = launch(f.project, f.env);
    await ready(f.project);
    if (mode === "signal") run.child.kill("SIGTERM");
    else if (mode === "hangup") run.child.kill("SIGHUP");
    else writeFileSync(join(f.project, mode === "normal" ? "finish-mobile" : "finish-api"), "yes");
    const status = { normal: 0, signal: 143, hangup: 129, "api-failure": 7 };
    await vi.waitFor(() => expect(run.child.exitCode, run.output()).toBe(status[mode]), {
      timeout: 5000,
    });
    expect(await run.finished).toBe(status[mode]);
    await gone(f.project);
    expect(unrelated.exitCode).toBeNull();
    expect(unrelated.signalCode).toBeNull();
    expect(run.output()).toContain("[api] api ready");
    expect(readFileSync(join(f.project, ".logs/dev.log"), "utf8")).toContain("shutting down");
  },
  30_000,
);

test.each(["api", "metro"])(
  "mobile dev refuses occupied %s without signaling its listener",
  async (busy) => {
    const f = await fixture();
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(busy === "api" ? f.api : f.metro, "127.0.0.1", resolve),
    );
    try {
      const run = launch(f.project, f.env);
      expect(await run.finished).toBe(1);
      expect(run.output()).toContain("already in use");
      expect(server.listening).toBe(true);
      expect(existsSync(join(f.project, "api.pid")), run.output()).toBe(false);
      expect(existsSync(join(f.project, "mobile.pid"))).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  30_000,
);

test("mobile startup failure stops before launching the API or Metro", async () => {
  const f = await fixture();
  const run = launch(f.project, { ...f.env, FAIL_SETUP: "db:migrate" });
  expect(await run.finished, run.output()).toBe(4);
  expect(run.output()).toContain("db:migrate exited 4");
  await gone(f.project);
  expect(existsSync(join(f.project, "api.pid"))).toBe(false);
  expect(existsSync(join(f.project, "mobile.pid"))).toBe(false);
}, 30_000);

test("an API parent exit triggers cleanup even when its watcher retains output pipes", async () => {
  const f = await fixture();
  const run = launch(f.project, { ...f.env, RETAIN_OUTPUT: "1" });
  await ready(f.project);
  writeFileSync(join(f.project, "finish-api"), "yes");
  try {
    await vi.waitFor(() => expect(run.child.exitCode).toBe(7), { timeout: 5000 });
    expect(await run.finished).toBe(7);
    await gone(f.project);
    expect(run.output()).toContain("[api] api ready");
  } finally {
    reapFixture(f.project);
  }
}, 20_000);

test("fixture cleanup reaps owned groups after failed readiness and an unresponsive launcher", async () => {
  const f = await fixture();
  const run = launch(f.project, { ...f.env, NO_READY: "1" });
  await vi.waitFor(
    () => {
      expect(existsSync(join(f.project, "api-child.pid"))).toBe(true);
      expect(existsSync(join(f.project, "mobile-child.pid"))).toBe(true);
    },
    { timeout: 5000 },
  );
  expect(existsSync(join(f.project, "api.ready"))).toBe(false);
  run.child.kill("SIGSTOP");
  try {
    await cleanupChildren();
    await gone(f.project);
  } finally {
    reapFixture(f.project);
  }
}, 20_000);

test("a signal during child cleanup replaces the earlier failure status", async () => {
  const f = await fixture();
  const run = launch(f.project, { ...f.env, RESIST_TERM: "1" });
  await ready(f.project);
  await vi.waitFor(() => expect(existsSync(join(f.project, "api-child.ready"))).toBe(true));
  writeFileSync(join(f.project, "finish-api"), "yes");
  await vi.waitFor(() => expect(run.output()).toContain("shutting down owned processes"));
  run.child.kill("SIGTERM");
  expect(await run.finished, run.output()).toBe(143);
  await gone(f.project);
}, 20_000);
