import { execFile } from "node:child_process";
import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import { tempDir } from "./helpers/cli";

const registry = join(import.meta.dirname, "..", "registry");
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

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    // A failed assertion can leave the server running; kill its group before removing the dir.
    const record = join(dir.path, "logs", "dev.pid");
    const group = existsSync(record) ? readFileSync(record, "utf8").split(" ")[0] : undefined;
    if (group && group !== String(process.pid))
      await run("kill", ["-KILL", `-${group}`]).catch(() => undefined);
    dir.cleanup();
  }
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
      ({ stdout }) => ({ code: 0, stdout }),
      (error: { code?: number; stdout?: string }) => ({
        code: error.code ?? -1,
        stdout: error.stdout ?? "",
      }),
    );
  return { dir: dir.path, port, devBg };
}

async function groupAlive(group: string) {
  return run("kill", ["-0", `-${group}`]).then(
    () => true,
    () => false,
  );
}

test("dev-bg starts, reuses, reports and stops its server's process group", async () => {
  const { dir, port, devBg } = await checkout();

  const started = await devBg("start");
  expect(started).toMatchObject({ code: 0 });
  expect(started.stdout).toContain(`Server running on http://127.0.0.1:${port}`);
  const group = readFileSync(join(dir, "logs", "dev.pid"), "utf8").split(" ")[0] ?? "";
  expect(await groupAlive(group)).toBe(true);

  const reused = await devBg("start");
  expect(reused).toMatchObject({ code: 0 });
  expect(reused.stdout).toContain(`Reusing the server on http://127.0.0.1:${port}`);
  expect((await devBg("status")).code).toBe(0);

  expect(await devBg("stop")).toMatchObject({ code: 0 });
  expect(await groupAlive(group)).toBe(false);
  expect(existsSync(join(dir, "logs", "dev.pid"))).toBe(false);
  expect((await devBg("status")).code).toBe(1);
}, 30_000);

test("dev-stop drops a record whose leader is a different process and signals nothing", async () => {
  const { dir, devBg } = await checkout();
  mkdirSync(join(dir, "logs"));
  // This test's own pid is alive, but its start time can't match the recorded one.
  writeFileSync(
    join(dir, "logs", "dev.pid"),
    `${process.pid} 127.0.0.1 1 Thu Jan  1 00:00:00 1970\n`,
  );

  const stopped = await devBg("stop");
  expect(stopped).toMatchObject({ code: 0 });
  expect(stopped.stdout).toContain("had already exited");
  expect(existsSync(join(dir, "logs", "dev.pid"))).toBe(false);
}, 30_000);
