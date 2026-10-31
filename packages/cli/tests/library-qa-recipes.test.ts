import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { VerifyEvent, VerifyResult } from "../src/schemas/verify";
import { quiet, runCli } from "./helpers/cli";
import { adapterWorkspace, scaffoldAdapters } from "./helpers/native-adapters";
import { readManifestAt, readRecord, recordPath, stateEnv } from "./helpers/verify";

const space = adapterWorkspace();
afterEach(() => space.cleanup());

function shim(dir: string, name: string, body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

test("Astro check refuses missing checker dependencies without an installation prompt", async () => {
  const home = space.temp();
  const { project } = await scaffoldAdapters({ home, stack: "astro-blog", agents: ["codex"] });
  const bin = join(home, "bin");
  shim(bin, "bunx", 'echo "Would you like to install @astrojs/check?"; exit 0');
  const env = { HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}` };
  const run = () =>
    spawnSync("make", ["check"], {
      cwd: project,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
  const missing = run();
  expect(missing.error).toBeUndefined();
  expect(missing.status).not.toBe(0);
  expect(missing.stderr).toContain("bun add -d @astrojs/check typescript");
  expect(missing.stdout).not.toContain("Would you like");
  for (const name of ["@astrojs/check", "typescript"]) {
    const pkg = join(project, "node_modules", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name, main: "index.js" }));
    writeFileSync(join(pkg, "index.js"), "module.exports = {};\n");
  }
  shim(bin, "bunx", 'echo "checker ran: $*"; exit 7');
  const installed = run();
  expect(installed.error).toBeUndefined();
  expect(installed.status).not.toBe(0);
  expect(installed.stdout).toContain("checker ran: --no-install astro check");
  expect(installed.stderr).not.toContain("bun add");
  shim(bin, "bunx", 'echo "checker ran: $*"');
  const success = run();
  expect(success.error).toBeUndefined();
  expect(success.status).toBe(0);
  expect(success.stderr).toBe("");
});

test("Astro preview explicitly stays foreground and has a documented stop command", async () => {
  const home = space.temp();
  const { project } = await scaffoldAdapters({ home, stack: "astro-blog", agents: ["codex"] });
  const bin = join(home, "bin");
  shim(bin, "bunx", 'echo "astro invocation: $*"');
  const result = spawnSync("make", ["preview", "PORT_WEB=4567"], {
    cwd: project,
    env: { HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}` },
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("astro invocation: astro preview --port 4567 --ignore-lock");
  expect(readFileSync(join(project, ".stacks/BRIEF.md"), "utf8")).toContain("astro preview stop");
});

test("Tauri install disables rustup self-update for this invocation", async () => {
  const home = space.temp();
  const { project } = await scaffoldAdapters({ home, stack: "tauri-react", agents: ["codex"] });
  const bin = join(home, "bin");
  for (const name of ["bun", "bunx", "cargo", "rustup"]) shim(bin, name, `echo '${name}' "$@"`);
  const result = spawnSync("make", ["install"], {
    cwd: project,
    env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.split("\n")).toContain("rustup toolchain install --no-self-update");
});

test("adding CLI chat supplies a helper accepted by the prescribed base formatter", async () => {
  const home = space.temp();
  const { project } = await scaffoldAdapters({
    home,
    stack: "typescript-cli",
    agents: ["codex"],
    fragments: ["openrouter-chat-cli"],
  });
  const config = join(project, "biome.json");
  const file = join(project, "scripts/lib/stub-pid.ts");
  const source = readFileSync(file, "utf8");
  const formatted = spawnSync(
    join(import.meta.dirname, "../node_modules/.bin/biome"),
    ["format", `--config-path=${config}`, `--stdin-file-path=${file}`],
    { input: source, encoding: "utf8", timeout: 10_000 },
  );
  expect(formatted.error).toBeUndefined();
  expect(formatted.status).toBe(0);
  expect(formatted.stderr).toBe("");
  expect(formatted.stdout).toBe(source);
});

test("absent optional hook tests cannot set the first test milestone", async () => {
  const home = space.temp();
  const env = stateEnv(home);
  const { project } = await scaffoldAdapters({
    home,
    stack: "react-router",
    agents: ["cursor"],
    without: ["git-hooks"],
    env,
  });
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "qa-project", private: true }),
  );
  const before = readManifestAt(project);
  const result = await runCli(["verify", "--only", "harness-hooks", "--json"], {
    home,
    env: { ...quiet, ...env, PATH: process.env.PATH ?? "" },
    host: { cwd: project },
  });
  expect(result.status, result.stderr).toBe(0);
  const events = result.stderr
    .trim()
    .split("\n")
    .map((line) => Schema.decodeUnknownSync(VerifyEvent)(JSON.parse(line)));
  expect(events.length).toBeGreaterThanOrEqual(2);
  expect(Schema.decodeUnknownSync(VerifyResult)(JSON.parse(result.stdout)).steps).toContainEqual(
    expect.objectContaining({ name: "harness-hooks", layer: "check", status: "passed" }),
  );
  expect(readRecord(recordPath(home, before.projectId)).firstTestPassAt).toBeNull();
  expect(readManifestAt(project)).toEqual(before);
});

test("real passing tests still set the test-command milestone without changing the manifest", async () => {
  const home = space.temp();
  const env = stateEnv(home);
  const { project } = await scaffoldAdapters({
    home,
    stack: "react-router",
    agents: ["cursor"],
    without: ["git-hooks"],
    env,
  });
  const runner = join(import.meta.dirname, "../node_modules/vitest/vitest.mjs");
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({
      name: "qa-project",
      private: true,
      type: "module",
      scripts: { test: `node ${JSON.stringify(runner)} run tests/health.test.ts --maxWorkers 1` },
    }),
  );
  symlinkSync(join(import.meta.dirname, "../node_modules"), join(project, "node_modules"), "dir");
  mkdirSync(join(project, "tests"));
  writeFileSync(
    join(project, "tests/health.test.ts"),
    `import { createServer } from "node:http";
import { test, expect } from "vitest";
test("HTTP health response is observable", async () => {
  const server = createServer((_, response) => response.end(JSON.stringify({ status: "ok" })));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  } finally { await new Promise(resolve => server.close(resolve)); }
});\n`,
  );
  const before = readManifestAt(project);
  const result = await runCli(["verify", "--only", "test", "--json"], {
    home,
    env: { ...quiet, ...env, PATH: process.env.PATH ?? "" },
    host: { cwd: project },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(Schema.decodeUnknownSync(VerifyResult)(JSON.parse(result.stdout)).steps).toContainEqual(
    expect.objectContaining({
      name: "test",
      layer: "test",
      status: "passed",
    }),
  );
  expect(readRecord(recordPath(home, before.projectId)).firstTestPassAt).not.toBeNull();
  expect(readManifestAt(project)).toEqual(before);
}, 20_000);
