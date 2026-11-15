import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { makeFixture } from "./helpers/dev";

function freePort(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("No TCP port"));
        return;
      }
      server.close(() => resolve(String(address.port)));
    });
  });
}

it("starts a background dev server and stops its processes", async () => {
  const project = makeFixture("dev.ts", "dev-bg.ts", "dev-pid.ts", "dev-logs.ts", "dev-status.ts");
  const env = { ...process.env, PORT_API: await freePort(), PORT_WEB: await freePort() };
  const server = (port: string) =>
    `bun -e 'Bun.serve({port:Number(process.env.${port}),fetch:()=>new Response("ok")})'`;
  writeFileSync(
    join(project.dir, "package.json"),
    JSON.stringify({ private: true, scripts: { "dev:server": server("PORT_API") } }),
  );
  let groups: number[] = [];
  let owner: number | undefined;
  const run = (command: string) =>
    spawnSync("bun", ["scripts/dev-bg.ts", command], {
      cwd: project.dir,
      env,
      encoding: "utf8",
      timeout: 20_000,
    });
  try {
    const start = run("start");
    const pidFile = join(project.dir, "logs/dev.pid");
    const recorded = existsSync(pidFile)
      ? readFileSync(pidFile, "utf8").trim().split(/\s+/).map(Number)
      : [];
    owner = recorded[0];
    groups = recorded.slice(2);
    expect(start.status, start.stdout + start.stderr).toBe(0);
    expect(start.stderr).toBe("");
    expect(start.stdout).toContain(`http://localhost:${env.PORT_API}`);
    expect(groups).toHaveLength(1);
    const status = run("status");
    expect(status.status, status.stdout + status.stderr).toBe(0);
    expect(status.stderr).toBe("");
    expect(status.stdout).toContain(env.PORT_API);
  } finally {
    try {
      const stop = run("stop");
      expect(stop.status, stop.stdout + stop.stderr).toBe(0);
      expect(stop.stderr).toBe("");
      expect(stop.stdout).toContain("Stopped");
      await vi.waitFor(() => {
        expect(existsSync(join(project.dir, "logs/dev.pid"))).toBe(false);
        for (const group of groups) expect(() => process.kill(-group, 0)).toThrow(/ESRCH/);
      });
    } finally {
      for (const pid of [...groups.map((group) => -group), ...(owner ? [owner] : [])]) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
            console.error("Cannot clean up dev fixture process", pid, error);
        }
      }
      project.cleanup();
    }
  }
}, 30_000);
