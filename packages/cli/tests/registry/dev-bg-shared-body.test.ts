import { execFile, spawn } from "node:child_process";
import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import { tempDir } from "../helpers/cli";
import { bundled as registry } from "./helpers/bundled";

const marker = "# --- shared body ---";

function sharedBodies() {
  const script = "files/scripts/dev-bg.sh";
  return globSync(`*/${script}`, { cwd: join(registry, "stacks") })
    .map((file) => file.slice(0, file.indexOf(sep)))
    .sort()
    .map((id) => {
      const file = join("stacks", id, script);
      // Latin-1 preserves every byte, including line endings in the body.
      const source = readFileSync(join(registry, file), "latin1");
      const parts = source.split(/(?<=^|\n)# --- shared body ---(?:\r?\n|$)/);
      return { file, markers: parts.length - 1, body: parts[1] };
    });
}

test("bundled dev-bg scripts mark one byte-identical shared body", () => {
  const scripts = sharedBodies();
  expect(scripts.length, "no bundled dev-bg.sh found").toBeGreaterThan(0);
  expect(
    scripts.filter(({ markers }) => markers !== 1).map(({ file, markers }) => ({ file, markers })),
    `Each dev-bg.sh must contain exactly one ${marker} line`,
  ).toEqual([]);
  const [first, ...rest] = scripts;
  expect(
    rest.filter(({ body }) => body !== first?.body).map(({ file }) => file),
    `Shared body differs from ${first?.file}`,
  ).toEqual([]);
});

const run = promisify(execFile);
const dirs: ReturnType<typeof tempDir>[] = [];

const groups: number[] = [];

/** Signals process group `group`; false when it doesn't exist. */
function signalGroup(group: number, signal: NodeJS.Signals | 0) {
  try {
    process.kill(-group, signal);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  // A failed assertion can leave a server or a stand-in group running.
  for (const dir of dirs.splice(0)) {
    const record = join(dir.path, "logs", "dev.pid");
    const group = Number(existsSync(record) ? readFileSync(record, "utf8").split(" ")[0] : 0);
    if (group > 1 && group !== process.pid) groups.push(group);
    dir.cleanup();
  }
  for (const group of groups.splice(0)) signalGroup(group, "SIGKILL");
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("port")),
      );
    });
  });
}

const serve =
  "require('node:http').createServer((_, res) => res.end('ok')).listen(+process.argv[1], process.argv[2])";
const probe =
  "fetch('http://' + process.argv[2] + ':' + process.argv[1] + '/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))";

/** A checkout whose scripts/dev-bg.sh is the bundled shared body around a tiny Node server. */
async function checkout() {
  const dir = tempDir();
  dirs.push(dir);
  const port = await freePort();
  const body = sharedBodies()[0]?.body ?? "";
  const header = [
    "#!/usr/bin/env bash",
    "HOST_VAR=HOST",
    "DEV_HOST=127.0.0.1",
    "PORT_VAR=PORT",
    `DEV_PORT=${port}`,
    "START_SECONDS=20",
    "STOP_SECONDS=5",
    "ABORT_SECONDS=2",
    "SERVER_LABEL=server",
    'REUSE_NOTE="Reused."',
    `launch() { exec "${process.execPath}" -e "${serve}" "$2" "$1"; }`,
    `healthy() { "${process.execPath}" -e "${probe}" "$2" "$1" >/dev/null 2>&1; }`,
    marker,
  ].join("\n");
  mkdirSync(join(dir.path, "scripts"));
  writeFileSync(join(dir.path, "scripts", "dev-bg.sh"), `${header}\n${body}`);
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir.path };
  const devBg = async (command: string) =>
    run("bash", ["scripts/dev-bg.sh", command], { cwd: dir.path, env }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        code: error.code ?? -1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      }),
    );
  return { dir: dir.path, port, devBg };
}

test("dev-bg starts, reuses, reports and stops its server's process group", async () => {
  const { dir, port, devBg } = await checkout();

  const started = await devBg("start");
  expect(started).toMatchObject({ code: 0, stderr: "" });
  expect(started.stdout).toContain(`Server running on http://127.0.0.1:${port}`);
  const group = Number(readFileSync(join(dir, "logs", "dev.pid"), "utf8").split(" ")[0]);
  expect(signalGroup(group, 0)).toBe(true);

  const reused = await devBg("start");
  expect(reused).toMatchObject({ code: 0, stderr: "" });
  expect(reused.stdout).toContain(`Reusing the server on http://127.0.0.1:${port}`);
  expect(await devBg("status")).toMatchObject({ code: 0, stderr: "" });

  expect(await devBg("stop")).toMatchObject({ code: 0, stderr: "" });
  expect(signalGroup(group, 0)).toBe(false);
  expect(existsSync(join(dir, "logs", "dev.pid"))).toBe(false);
  expect(await devBg("status")).toMatchObject({ code: 1, stderr: "" });
}, 30_000);

test("dev-stop drops a record whose leader is a different process and signals nothing", async () => {
  const { dir, devBg } = await checkout();
  // A live group leader that dev-bg didn't start: the record's start time can't match it.
  const stranger = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  stranger.unref();
  const group = stranger.pid ?? 0;
  groups.push(group);
  mkdirSync(join(dir, "logs"));
  writeFileSync(join(dir, "logs", "dev.pid"), `${group} 127.0.0.1 1 Thu Jan  1 00:00:00 1970\n`);

  const stopped = await devBg("stop");
  expect(stopped).toMatchObject({ code: 0, stderr: "" });
  expect(stopped.stdout).toContain("had already exited");
  expect(existsSync(join(dir, "logs", "dev.pid"))).toBe(false);
  expect(signalGroup(group, 0)).toBe(true);
}, 30_000);
